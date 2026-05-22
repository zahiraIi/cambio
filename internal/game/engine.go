package game

import (
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"
)

// ErrPlayerAlreadyInGame is returned when joining with an ID already seated.
var ErrPlayerAlreadyInGame = errors.New("player already in game")

type Phase int

const (
	PhaseWaiting    Phase = iota // waiting for players
	PhaseInitPeek                // players peek at 2 of their 4 starting cards
	PhaseTurns                   // main gameplay
	PhaseFinalRound              // one more turn per player after cambio called
	PhaseScoring                 // game over, tally scores
)

type ActionType int

const (
	ActionDrawDeck      ActionType = iota // draw from deck
	ActionDrawDiscard                     // draw from discard pile
	ActionSwapCard                        // swap drawn card with one in hand
	ActionDiscard                         // discard drawn card (may trigger ability)
	ActionReturnDrawn                     // return drawn card to discard without using ability
	ActionPeekOwn                         // ability: peek at own card (9/10)
	ActionPeekOpponent                    // ability: peek at opponent's card (7/8)
	ActionBlindSwitch                     // ability: swap cards blind (J/Q)
	ActionLookAndSwitch                   // ability: confirm swap after looking (Black King)
	ActionLookSwitchOwn                   // black king step 1: peek own card
	ActionLookSwitchPeek                  // black king step 2: peek opponent card
	ActionDeclineSwitch                   // black king step 3: keep without swapping
	ActionCallCambio                      // call cambio to end round
	ActionInitPeek                        // peek at starting cards
	ActionSnapMatch                       // snap matching cards to discard pile
	ActionStackOpponent                   // stack opponent card matching discard (requires prior peek memory)
	ActionStackGive                       // give one of your cards after a successful opponent stack
)

type Action struct {
	Type       ActionType
	PlayerID   string
	Slot       int    // card slot in player's hand
	TargetID   string // target player for abilities
	TargetSlot int    // target card slot
}

type Event struct {
	Type      string      `json:"type"`
	PlayerID  string      `json:"playerId,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Private   bool        `json:"private"`
	VisibleTo []string    `json:"visibleTo,omitempty"`
}

type Engine struct {
	mu                  sync.RWMutex
	ID                  string
	Players             []*Player
	Deck                *Deck
	DiscardPile         []Card
	Phase               Phase
	CurrentTurn         int
	DrawnCard           *Card
	PendingAbility      Ability
	CambioCallerIdx     int
	TurnsAfterCambio    int
	skipFinalRoundCount bool
	InitPeekMask        map[string]uint8 // bit0=slot0 peeked, bit1=slot1 peeked
	TurnCounter         int
	Events              []Event
	maxPlayers          int

	// Peek opponent ability (7 or 8): one peek at one opponent card before advancing turn.
	PeekOpponentRemaining int

	// peekKnowledge[viewer][target:slot] = remembered card with decaying strength
	peekKnowledge map[string]map[string]memoryEntry

	// Stack race: when a player discards/swaps to discard, others may snap matching rank once.
	openStackRank         Rank
	stackRankClaimed      bool
	stackWindowOpenedAtMs int64

	// After a successful opponent stack, the actor must give one of their cards to the target slot.
	pendingStackGiveActor     string
	pendingStackGiveTargetID  string
	pendingStackGiveTargetSlot int

	// Black king look-and-switch: peek own, peek opponent, then optional swap.
	lookSwitchMySlot     int
	lookSwitchTargetID   string
	lookSwitchTargetSlot int
	lookSwitchPeekDone   bool
}

type memoryEntry struct {
	Rank     Rank
	Strength float64
}

func NewEngine(id string, maxPlayers int) *Engine {
	if maxPlayers < 2 {
		maxPlayers = 2
	}
	if maxPlayers > 6 {
		maxPlayers = 6
	}
	return &Engine{
		ID:                         id,
		maxPlayers:                 maxPlayers,
		Phase:                      PhaseWaiting,
		CambioCallerIdx:            -1,
		InitPeekMask:               make(map[string]uint8),
		peekKnowledge:              make(map[string]map[string]memoryEntry),
		lookSwitchMySlot:           -1,
		lookSwitchTargetSlot:       -1,
		pendingStackGiveTargetSlot: -1,
	}
}

const (
	// InitPeekSlotMin and InitPeekSlotMax inclusive — only these dealt positions may be viewed at game start.
	InitPeekSlotMin = 0
	InitPeekSlotMax = 1
)

func (e *Engine) AddPlayer(id, name string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	for _, p := range e.Players {
		if p.ID == id {
			return ErrPlayerAlreadyInGame
		}
	}
	if e.Phase != PhaseWaiting {
		return fmt.Errorf("game already started")
	}
	if len(e.Players) >= e.maxPlayers {
		return fmt.Errorf("game is full")
	}
	e.Players = append(e.Players, NewPlayer(id, name))
	e.emit(Event{Type: "player_joined", PlayerID: id, Data: map[string]string{"name": name}})
	return nil
}

// AddBot registers a CPU player before Start(). difficulty: 1 easy, 2 medium, 3 hard.
func (e *Engine) AddBot(id, name string, difficulty int) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.Phase != PhaseWaiting {
		return fmt.Errorf("game already started")
	}
	if len(e.Players) >= e.maxPlayers {
		return fmt.Errorf("game is full")
	}
	for _, p := range e.Players {
		if p.ID == id {
			return ErrPlayerAlreadyInGame
		}
	}
	p := NewBotPlayer(id, name)
	ApplyBotDifficulty(p, difficulty)
	e.Players = append(e.Players, p)
	e.emit(Event{Type: "player_joined", PlayerID: id, Data: map[string]string{"name": name}})
	return nil
}

// RemovePlayer removes a player before the game starts (e.g. disconnect from lobby).
func (e *Engine) RemovePlayer(id string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.Phase != PhaseWaiting {
		return fmt.Errorf("cannot remove player after game started")
	}
	for i, p := range e.Players {
		if p.ID == id {
			e.Players = append(e.Players[:i], e.Players[i+1:]...)
			return nil
		}
	}
	return fmt.Errorf("player not found")
}

// ForceSkipStackGive auto-completes a stuck opponent stack give (bot fallback).
func (e *Engine) ForceSkipStackGive() []Event {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.pendingStackGiveActor == "" {
		return nil
	}
	start := len(e.Events)
	e.forceCompleteStackGiveLocked()
	newEvents := make([]Event, len(e.Events)-start)
	copy(newEvents, e.Events[start:])
	e.Events = e.Events[:0]
	return newEvents
}

// ForceSkipAbility clears a stuck pending ability and advances turn (bot fallback).
func (e *Engine) ForceSkipAbility() []Event {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.PendingAbility == NoAbility {
		return nil
	}
	start := len(e.Events)
	e.PendingAbility = NoAbility
	e.PeekOpponentRemaining = 0
	e.clearLookSwitchState()
	e.advanceTurn()
	newEvents := make([]Event, len(e.Events)-start)
	copy(newEvents, e.Events[start:])
	e.Events = e.Events[:0]
	return newEvents
}

// ForceAdvanceBotTurn completes the current bot's turn when normal actions fail (bot fallback).
func (e *Engine) ForceAdvanceBotTurn() []Event {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.Phase != PhaseTurns && e.Phase != PhaseFinalRound {
		return nil
	}
	if len(e.Players) == 0 || e.CurrentTurn < 0 || e.CurrentTurn >= len(e.Players) {
		return nil
	}
	cur := e.Players[e.CurrentTurn]
	if !cur.IsBot {
		return nil
	}
	start := len(e.Events)

	if e.pendingStackGiveActor != "" {
		e.forceCompleteStackGiveLocked()
	}
	if e.PendingAbility != NoAbility {
		e.PendingAbility = NoAbility
		e.PeekOpponentRemaining = 0
		e.clearLookSwitchState()
	}
	if e.DrawnCard != nil {
		returned := *e.DrawnCard
		e.DiscardPile = append(e.DiscardPile, returned)
		e.DrawnCard = nil
		e.emit(Event{
			Type: "card_returned", PlayerID: cur.ID,
			Data: map[string]interface{}{"card": returned.String(), "auto": true},
		})
		e.openStackWindow(returned.Rank)
		e.advanceTurn()
		newEvents := make([]Event, len(e.Events)-start)
		copy(newEvents, e.Events[start:])
		e.Events = e.Events[:0]
		return newEvents
	}

	card, ok := e.Deck.Draw()
	if !ok {
		e.reshuffleDiscard()
		card, ok = e.Deck.Draw()
	}
	if !ok {
		e.advanceTurn()
		e.emit(Event{
			Type: "bot_turn_skipped", PlayerID: cur.ID,
			Data: map[string]string{"message": "Bot turn auto-skipped (no cards left)"},
		})
		newEvents := make([]Event, len(e.Events)-start)
		copy(newEvents, e.Events[start:])
		e.Events = e.Events[:0]
		return newEvents
	}
	e.DrawnCard = &card
	returned := *e.DrawnCard
	e.DiscardPile = append(e.DiscardPile, returned)
	e.DrawnCard = nil
	e.emit(Event{
		Type: "card_returned", PlayerID: cur.ID,
		Data: map[string]interface{}{"card": returned.String(), "auto": true},
	})
	e.openStackWindow(returned.Rank)
	e.advanceTurn()

	newEvents := make([]Event, len(e.Events)-start)
	copy(newEvents, e.Events[start:])
	e.Events = e.Events[:0]
	return newEvents
}

func (e *Engine) forceCompleteStackGiveLocked() {
	if e.pendingStackGiveActor == "" {
		return
	}
	actor := e.findPlayer(e.pendingStackGiveActor)
	target := e.findPlayer(e.pendingStackGiveTargetID)
	if actor == nil || target == nil {
		e.pendingStackGiveActor = ""
		e.pendingStackGiveTargetID = ""
		e.pendingStackGiveTargetSlot = -1
		return
	}
	ts := e.pendingStackGiveTargetSlot
	giveSlot := -1
	for s := 0; s < HandSize; s++ {
		if actor.Hand[s] != nil {
			giveSlot = s
			break
		}
	}
	if giveSlot < 0 || ts < 0 || ts >= HandSize || target.Hand[ts] != nil {
		e.pendingStackGiveActor = ""
		e.pendingStackGiveTargetID = ""
		e.pendingStackGiveTargetSlot = -1
		return
	}
	given := *actor.Hand[giveSlot]
	e.invalidateKnowledgeForSlot(e.pendingStackGiveActor, giveSlot)
	actor.Hand[giveSlot] = nil
	actor.Known[giveSlot] = false
	target.Hand[ts] = &given
	target.Known[ts] = false
	e.recordPeekKnowledge(e.pendingStackGiveActor, e.pendingStackGiveTargetID, ts, given.Rank)
	e.pendingStackGiveActor = ""
	e.pendingStackGiveTargetID = ""
	e.pendingStackGiveTargetSlot = -1
	e.emit(Event{
		Type: "stack_give_complete", PlayerID: actor.ID,
		Data: map[string]interface{}{
			"mySlot": giveSlot, "targetPlayer": target.ID, "targetSlot": ts, "auto": true,
		},
	})
}

func (e *Engine) Start() error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if len(e.Players) < 2 {
		return fmt.Errorf("need at least 2 players")
	}
	if e.Phase != PhaseWaiting {
		return fmt.Errorf("game already started")
	}

	e.Deck = NewDeck()
	e.Deck.Shuffle()

	for _, p := range e.Players {
		for i := 0; i < HandSize; i++ {
			card, ok := e.Deck.Draw()
			if !ok {
				return fmt.Errorf("not enough cards in deck")
			}
			p.SetCard(i, card)
		}
		e.InitPeekMask[p.ID] = 0
	}

	topCard, _ := e.Deck.Draw()
	e.DiscardPile = []Card{topCard}

	e.Phase = PhaseInitPeek
	e.emit(Event{Type: "game_started", Data: map[string]int{"playerCount": len(e.Players)}})
	return nil
}

func (e *Engine) Execute(action Action) ([]Event, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	startIdx := len(e.Events)

	var err error
	switch action.Type {
	case ActionInitPeek:
		err = e.handleInitPeek(action)
	case ActionDrawDeck:
		err = e.handleDrawDeck(action)
	case ActionDrawDiscard:
		err = e.handleDrawDiscard(action)
	case ActionSwapCard:
		err = e.handleSwapCard(action)
	case ActionDiscard:
		err = e.handleDiscard(action)
	case ActionReturnDrawn:
		err = e.handleReturnDrawn(action)
	case ActionPeekOwn:
		err = e.handlePeekOwn(action)
	case ActionPeekOpponent:
		err = e.handlePeekOpponent(action)
	case ActionBlindSwitch:
		err = e.handleBlindSwitch(action)
	case ActionLookAndSwitch:
		err = e.handleLookAndSwitch(action)
	case ActionLookSwitchOwn:
		err = e.handleLookSwitchOwn(action)
	case ActionLookSwitchPeek:
		err = e.handleLookSwitchPeek(action)
	case ActionDeclineSwitch:
		err = e.handleDeclineSwitch(action)
	case ActionCallCambio:
		err = e.handleCallCambio(action)
	case ActionSnapMatch:
		err = e.handleSnapMatch(action)
	case ActionStackOpponent:
		err = e.handleStackOpponent(action)
	case ActionStackGive:
		err = e.handleStackGive(action)
	default:
		err = fmt.Errorf("unknown action type")
	}

	if err != nil {
		return nil, err
	}

	newEvents := make([]Event, len(e.Events)-startIdx)
	copy(newEvents, e.Events[startIdx:])
	e.Events = e.Events[:0]
	return newEvents, nil
}

func (e *Engine) handleInitPeek(a Action) error {
	if e.Phase != PhaseInitPeek {
		return fmt.Errorf("not in init peek phase")
	}
	player := e.findPlayer(a.PlayerID)
	if player == nil {
		return fmt.Errorf("player not found")
	}
	if a.Slot < InitPeekSlotMin || a.Slot > InitPeekSlotMax {
		return fmt.Errorf("you may only peek your first two dealt cards (slots %d–%d)", InitPeekSlotMin, InitPeekSlotMax)
	}
	bit := uint8(1 << a.Slot)
	if e.InitPeekMask[a.PlayerID]&bit != 0 {
		return fmt.Errorf("you already peeked that card")
	}
	card, err := player.PeekCard(a.Slot)
	if err != nil {
		return err
	}
	e.InitPeekMask[a.PlayerID] |= bit
	e.recordPeekKnowledge(a.PlayerID, a.PlayerID, a.Slot, card.Rank)

	e.emit(Event{
		Type: "card_peeked", PlayerID: a.PlayerID, Private: true,
		VisibleTo: []string{a.PlayerID},
		Data:      map[string]interface{}{"slot": a.Slot, "card": card.String(), "points": card.Points(), "rank": int(card.Rank)},
	})

	allDone := true
	for _, p := range e.Players {
		if e.InitPeekMask[p.ID] != 0b11 {
			allDone = false
			break
		}
	}
	if allDone {
		for _, pl := range e.Players {
			for s := InitPeekSlotMin; s <= InitPeekSlotMax && s < HandSize; s++ {
				pl.Known[s] = false
			}
		}
		e.Phase = PhaseTurns
		e.CurrentTurn = 0
		e.emit(Event{Type: "turns_begin", Data: map[string]string{"firstPlayer": e.Players[0].ID}})
	}
	return nil
}

func (e *Engine) handleDrawDeck(a Action) error {
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if err := e.rejectIfPendingAbility(); err != nil {
		return err
	}
	if err := e.rejectIfPendingStackGive(a.PlayerID); err != nil {
		return err
	}
	if e.DrawnCard != nil {
		return fmt.Errorf("already holding a drawn card")
	}
	card, ok := e.Deck.Draw()
	if !ok {
		e.reshuffleDiscard()
		card, ok = e.Deck.Draw()
		if !ok {
			return fmt.Errorf("no cards available")
		}
	}
	e.DrawnCard = &card
	e.emit(Event{
		Type: "card_drawn", PlayerID: a.PlayerID, Private: true,
		VisibleTo: []string{a.PlayerID},
		Data:      map[string]interface{}{"source": "deck", "card": card.String(), "points": card.Points()},
	})
	return nil
}

func (e *Engine) handleDrawDiscard(a Action) error {
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if err := e.rejectIfPendingAbility(); err != nil {
		return err
	}
	if err := e.rejectIfPendingStackGive(a.PlayerID); err != nil {
		return err
	}
	if e.DrawnCard != nil {
		return fmt.Errorf("already holding a drawn card")
	}
	if len(e.DiscardPile) == 0 {
		return fmt.Errorf("discard pile is empty")
	}
	card := e.DiscardPile[len(e.DiscardPile)-1]
	e.DiscardPile = e.DiscardPile[:len(e.DiscardPile)-1]
	e.DrawnCard = &card
	e.emit(Event{
		Type: "card_drawn", PlayerID: a.PlayerID,
		Data: map[string]interface{}{"source": "discard", "card": card.String()},
	})
	return nil
}

func (e *Engine) handleSwapCard(a Action) error {
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if e.DrawnCard == nil {
		return fmt.Errorf("no card drawn")
	}
	player := e.findPlayer(a.PlayerID)
	old, err := player.SwapCard(a.Slot, *e.DrawnCard)
	if err != nil {
		return err
	}
	e.DiscardPile = append(e.DiscardPile, old)
	e.DrawnCard = nil
	e.PendingAbility = NoAbility

	e.emit(Event{
		Type: "card_swapped", PlayerID: a.PlayerID,
		Data: map[string]interface{}{"slot": a.Slot, "discarded": old.String()},
	})

	e.invalidateKnowledgeForSlot(a.PlayerID, a.Slot)
	e.openStackWindow(old.Rank)
	e.advanceTurn()
	return nil
}

func (e *Engine) handleDiscard(a Action) error {
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if e.DrawnCard == nil {
		return fmt.Errorf("no card drawn")
	}
	discarded := *e.DrawnCard
	e.DiscardPile = append(e.DiscardPile, discarded)
	e.DrawnCard = nil

	ability := discarded.Ability()
	e.PeekOpponentRemaining = 0
	e.emit(Event{
		Type: "card_discarded", PlayerID: a.PlayerID,
		Data: map[string]interface{}{"card": discarded.String(), "ability": abilityName(ability)},
	})
	e.openStackWindow(discarded.Rank)

	if ability != NoAbility {
		e.PendingAbility = ability
		if ability == LookAndSwitch {
			e.clearLookSwitchState()
		}
		data := map[string]interface{}{"ability": abilityName(ability)}
		if ability == PeekOpponent {
			e.PeekOpponentRemaining = 1
			data["peekOpponentRemaining"] = 1
		}
		e.emit(Event{
			Type: "ability_available", PlayerID: a.PlayerID,
			Data: data,
		})
	} else {
		e.advanceTurn()
	}
	return nil
}

func (e *Engine) handleReturnDrawn(a Action) error {
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if e.DrawnCard == nil {
		return fmt.Errorf("no card drawn")
	}
	returned := *e.DrawnCard
	e.DiscardPile = append(e.DiscardPile, returned)
	e.DrawnCard = nil
	e.PendingAbility = NoAbility
	e.PeekOpponentRemaining = 0

	e.emit(Event{
		Type: "card_returned", PlayerID: a.PlayerID,
		Data: map[string]interface{}{"card": returned.String()},
	})
	e.openStackWindow(returned.Rank)
	e.advanceTurn()
	return nil
}

func (e *Engine) handlePeekOwn(a Action) error {
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if e.PendingAbility != PeekOwn {
		return fmt.Errorf("no peek-own ability pending")
	}
	player := e.findPlayer(a.PlayerID)
	if player == nil {
		return fmt.Errorf("player not found")
	}
	card, err := player.PeekCard(a.Slot)
	if err != nil {
		return err
	}
	e.PendingAbility = NoAbility
	e.recordPeekKnowledge(a.PlayerID, a.PlayerID, a.Slot, card.Rank)
	e.emit(Event{
		Type: "peeked_own", PlayerID: a.PlayerID, Private: true,
		VisibleTo: []string{a.PlayerID},
		Data:      map[string]interface{}{"slot": a.Slot, "card": card.String(), "points": card.Points(), "rank": int(card.Rank)},
	})
	e.advanceTurn()
	return nil
}

func (e *Engine) handlePeekOpponent(a Action) error {
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if e.PendingAbility != PeekOpponent {
		return fmt.Errorf("no peek-opponent ability pending")
	}
	target := e.findPlayer(a.TargetID)
	if target == nil {
		return fmt.Errorf("target player not found")
	}
	if a.TargetID == a.PlayerID {
		return fmt.Errorf("cannot peek at your own card with this ability")
	}
	if a.TargetSlot < 0 || a.TargetSlot >= HandSize || target.Hand[a.TargetSlot] == nil {
		return fmt.Errorf("invalid target slot")
	}
	card := *target.Hand[a.TargetSlot]
	e.recordPeekKnowledge(a.PlayerID, a.TargetID, a.TargetSlot, card.Rank)

	e.emit(Event{
		Type: "peeked_opponent", PlayerID: a.PlayerID, Private: true,
		VisibleTo: []string{a.PlayerID},
		Data: map[string]interface{}{
			"targetPlayer": a.TargetID, "targetSlot": a.TargetSlot,
			"card": card.String(), "points": card.Points(), "rank": int(card.Rank),
		},
	})

	e.PeekOpponentRemaining--
	if e.PeekOpponentRemaining > 0 {
		e.emit(Event{
			Type: "ability_available", PlayerID: a.PlayerID,
			Data: map[string]interface{}{
				"ability":               abilityName(PeekOpponent),
				"peekOpponentRemaining": e.PeekOpponentRemaining,
			},
		})
		return nil
	}
	e.PendingAbility = NoAbility
	e.PeekOpponentRemaining = 0
	e.advanceTurn()
	return nil
}

func (e *Engine) handleBlindSwitch(a Action) error {
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if e.PendingAbility != BlindSwitch {
		return fmt.Errorf("no blind-switch ability pending")
	}
	player := e.findPlayer(a.PlayerID)
	target := e.findPlayer(a.TargetID)
	if player == nil || target == nil {
		return fmt.Errorf("player not found")
	}
	if a.PlayerID == a.TargetID {
		return fmt.Errorf("cannot blind switch with yourself")
	}
	if a.Slot < 0 || a.Slot >= HandSize || a.TargetSlot < 0 || a.TargetSlot >= HandSize {
		return fmt.Errorf("invalid card slots")
	}

	myCard := player.Hand[a.Slot]
	theirCard := target.Hand[a.TargetSlot]
	if myCard == nil || theirCard == nil {
		return fmt.Errorf("invalid card slots")
	}
	sentRank := myCard.Rank

	e.invalidateKnowledgeForSlot(a.PlayerID, a.Slot)
	e.invalidateKnowledgeForSlot(a.TargetID, a.TargetSlot)

	player.Hand[a.Slot] = theirCard
	player.Known[a.Slot] = false
	target.Hand[a.TargetSlot] = myCard
	target.Known[a.TargetSlot] = false

	e.recordPeekKnowledge(a.PlayerID, a.TargetID, a.TargetSlot, sentRank)

	e.PendingAbility = NoAbility
	e.emit(Event{
		Type: "blind_switched", PlayerID: a.PlayerID,
		Data: map[string]interface{}{
			"mySlot": a.Slot, "targetPlayer": a.TargetID, "targetSlot": a.TargetSlot,
		},
	})
	e.advanceTurn()
	return nil
}

func (e *Engine) clearLookSwitchState() {
	e.lookSwitchMySlot = -1
	e.lookSwitchTargetID = ""
	e.lookSwitchTargetSlot = -1
	e.lookSwitchPeekDone = false
}

func (e *Engine) handleLookSwitchOwn(a Action) error {
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if e.PendingAbility != LookAndSwitch {
		return fmt.Errorf("no look-and-switch ability pending")
	}
	if e.lookSwitchMySlot >= 0 {
		return fmt.Errorf("already picked your card to look at")
	}
	player := e.findPlayer(a.PlayerID)
	if player == nil {
		return fmt.Errorf("player not found")
	}
	if a.Slot < 0 || a.Slot >= HandSize || player.Hand[a.Slot] == nil {
		return fmt.Errorf("invalid card slot")
	}
	card, err := player.PeekCard(a.Slot)
	if err != nil {
		return err
	}
	e.recordPeekKnowledge(a.PlayerID, a.PlayerID, a.Slot, card.Rank)
	e.lookSwitchMySlot = a.Slot
	e.emit(Event{
		Type: "look_switch_own_peeked", PlayerID: a.PlayerID, Private: true,
		VisibleTo: []string{a.PlayerID},
		Data:      map[string]interface{}{"slot": a.Slot, "card": card.String(), "points": card.Points()},
	})
	return nil
}

func (e *Engine) handleLookSwitchPeek(a Action) error {
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if e.PendingAbility != LookAndSwitch {
		return fmt.Errorf("no look-and-switch ability pending")
	}
	if e.lookSwitchMySlot < 0 {
		return fmt.Errorf("pick one of your cards to look at first")
	}
	if e.lookSwitchPeekDone {
		return fmt.Errorf("already looked at an opponent card")
	}
	target := e.findPlayer(a.TargetID)
	if target == nil || a.TargetID == a.PlayerID {
		return fmt.Errorf("invalid target")
	}
	if a.TargetSlot < 0 || a.TargetSlot >= HandSize || target.Hand[a.TargetSlot] == nil {
		return fmt.Errorf("invalid target slot")
	}
	card := *target.Hand[a.TargetSlot]
	e.lookSwitchTargetID = a.TargetID
	e.lookSwitchTargetSlot = a.TargetSlot
	e.lookSwitchPeekDone = true
	e.recordPeekKnowledge(a.PlayerID, a.TargetID, a.TargetSlot, card.Rank)
	e.emit(Event{
		Type: "looked_at_card", PlayerID: a.PlayerID, Private: true,
		VisibleTo: []string{a.PlayerID},
		Data: map[string]interface{}{
			"targetPlayer": a.TargetID, "targetSlot": a.TargetSlot,
			"card": card.String(), "points": card.Points(), "rank": int(card.Rank),
		},
	})
	e.emit(Event{
		Type: "look_switch_ready", PlayerID: a.PlayerID, Private: true,
		VisibleTo: []string{a.PlayerID},
		Data: map[string]interface{}{
			"mySlot": e.lookSwitchMySlot, "targetPlayer": a.TargetID, "targetSlot": a.TargetSlot,
		},
	})
	return nil
}

func (e *Engine) handleLookAndSwitch(a Action) error {
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if e.PendingAbility != LookAndSwitch {
		return fmt.Errorf("no look-and-switch ability pending")
	}
	if !e.lookSwitchPeekDone {
		return fmt.Errorf("look at your card and an opponent card before swapping")
	}
	if a.Slot != e.lookSwitchMySlot || a.TargetID != e.lookSwitchTargetID || a.TargetSlot != e.lookSwitchTargetSlot {
		return fmt.Errorf("invalid look-and-switch selection")
	}
	player := e.findPlayer(a.PlayerID)
	target := e.findPlayer(a.TargetID)
	if player == nil || target == nil {
		return fmt.Errorf("player not found")
	}
	if player.Hand[a.Slot] == nil || target.Hand[a.TargetSlot] == nil {
		return fmt.Errorf("invalid card slots")
	}

	myCard := player.Hand[a.Slot]
	theirCard := target.Hand[a.TargetSlot]

	e.invalidateKnowledgeForSlot(a.PlayerID, a.Slot)
	e.invalidateKnowledgeForSlot(a.TargetID, a.TargetSlot)

	player.Hand[a.Slot] = theirCard
	player.Known[a.Slot] = true
	target.Hand[a.TargetSlot] = myCard
	target.Known[a.TargetSlot] = false

	e.recordPeekKnowledge(a.PlayerID, a.PlayerID, a.Slot, theirCard.Rank)
	e.recordPeekKnowledge(a.PlayerID, a.TargetID, a.TargetSlot, myCard.Rank)

	e.PendingAbility = NoAbility
	e.clearLookSwitchState()
	e.emit(Event{
		Type: "look_and_switched", PlayerID: a.PlayerID,
		Data: map[string]interface{}{
			"mySlot": a.Slot, "targetPlayer": a.TargetID, "targetSlot": a.TargetSlot,
		},
	})
	e.advanceTurn()
	return nil
}

func (e *Engine) handleDeclineSwitch(a Action) error {
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if e.PendingAbility != LookAndSwitch {
		return fmt.Errorf("no look-and-switch ability pending")
	}
	if !e.lookSwitchPeekDone {
		return fmt.Errorf("look at your card and an opponent card first")
	}
	e.PendingAbility = NoAbility
	e.clearLookSwitchState()
	e.emit(Event{
		Type: "switch_declined", PlayerID: a.PlayerID,
		Data: map[string]string{"message": "Kept cards without swapping"},
	})
	e.advanceTurn()
	return nil
}

func (e *Engine) handleCallCambio(a Action) error {
	if e.Phase != PhaseTurns {
		return fmt.Errorf("cannot call cambio now")
	}
	if e.DrawnCard != nil {
		return fmt.Errorf("must finish your draw action first")
	}
	if err := e.validateTurn(a.PlayerID); err != nil {
		return err
	}
	if err := e.rejectIfPendingAbility(); err != nil {
		return err
	}
	if err := e.rejectIfPendingStackGive(a.PlayerID); err != nil {
		return err
	}
	player := e.findPlayer(a.PlayerID)
	player.CalledCambio = true
	e.CambioCallerIdx = e.CurrentTurn
	e.Phase = PhaseFinalRound
	e.TurnsAfterCambio = 0
	e.skipFinalRoundCount = true

	e.emit(Event{
		Type: "cambio_called", PlayerID: a.PlayerID,
		Data: map[string]string{"message": fmt.Sprintf("%s called Cambio!", player.Name)},
	})
	e.advanceTurn()
	return nil
}

func (e *Engine) handleSnapMatch(a Action) error {
	if e.Phase != PhaseTurns && e.Phase != PhaseFinalRound {
		return fmt.Errorf("cannot snap now")
	}
	if e.DrawnCard != nil && e.Players[e.CurrentTurn].ID == a.PlayerID {
		return fmt.Errorf("finish your draw action first")
	}
	if err := e.rejectIfPendingAbilityFor(a.PlayerID); err != nil {
		return err
	}
	if err := e.rejectIfPendingStackGive(a.PlayerID); err != nil {
		return err
	}
	if e.openStackRank == 0 {
		e.emit(Event{
			Type: "snap_voided", PlayerID: a.PlayerID,
			Data: map[string]string{"message": "Nothing to stack right now."},
		})
		return nil
	}
	if e.stackRankClaimed {
		e.emit(Event{
			Type: "snap_voided", PlayerID: a.PlayerID,
			Data: map[string]string{"message": "Someone already stacked that discard."},
		})
		return nil
	}
	player := e.findPlayer(a.PlayerID)
	if player == nil {
		return fmt.Errorf("player not found")
	}
	handCard := player.Hand[a.Slot]
	if handCard == nil {
		return fmt.Errorf("no card in that slot")
	}
	if handCard.Rank != e.openStackRank {
		e.applyPenaltyCard(player)
		e.emit(Event{
			Type: "snap_failed", PlayerID: a.PlayerID,
			Data: map[string]string{"message": "Wrong stack! Penalty card drawn."},
		})
		return nil
	}

	e.DiscardPile = append(e.DiscardPile, *handCard)
	player.Hand[a.Slot] = nil
	player.Known[a.Slot] = false
	e.invalidateKnowledgeForSlot(a.PlayerID, a.Slot)
	e.stackRankClaimed = true
	e.emit(Event{
		Type: "snap_success", PlayerID: a.PlayerID,
		Data: map[string]interface{}{"slot": a.Slot, "card": handCard.String()},
	})
	return nil
}

func (e *Engine) handleStackOpponent(a Action) error {
	if e.Phase != PhaseTurns && e.Phase != PhaseFinalRound {
		return fmt.Errorf("cannot stack opponent now")
	}
	if e.DrawnCard != nil && e.Players[e.CurrentTurn].ID == a.PlayerID {
		return fmt.Errorf("finish your draw action first")
	}
	if err := e.rejectIfPendingAbilityFor(a.PlayerID); err != nil {
		return err
	}
	if err := e.rejectIfPendingStackGive(a.PlayerID); err != nil {
		return err
	}
	if e.openStackRank == 0 {
		e.emit(Event{
			Type: "stack_opponent_voided", PlayerID: a.PlayerID,
			Data: map[string]string{"message": "Nothing to stack right now."},
		})
		return nil
	}
	if e.stackRankClaimed {
		e.emit(Event{
			Type: "stack_opponent_voided", PlayerID: a.PlayerID,
			Data: map[string]string{"message": "Someone already stacked that discard."},
		})
		return nil
	}
	actor := e.findPlayer(a.PlayerID)
	target := e.findPlayer(a.TargetID)
	if actor == nil || target == nil || a.TargetID == a.PlayerID {
		return fmt.Errorf("invalid target")
	}
	if a.TargetSlot < 0 || a.TargetSlot >= HandSize || target.Hand[a.TargetSlot] == nil {
		return fmt.Errorf("invalid target slot")
	}

	actualCard := target.Hand[a.TargetSlot]
	memRank, memStrength, hadMemory := e.getPeekKnowledge(a.PlayerID, a.TargetID, a.TargetSlot)

	if !hadMemory || memStrength < 0.35 || memRank != actualCard.Rank || actualCard.Rank != e.openStackRank {
		e.applyPenaltyCard(actor)
		e.emit(Event{
			Type: "stack_opponent_failed", PlayerID: a.PlayerID,
			Data: map[string]string{"message": "Wrong opponent stack! Penalty card drawn."},
		})
		return nil
	}

	discarded := *actualCard
	e.DiscardPile = append(e.DiscardPile, discarded)
	target.Hand[a.TargetSlot] = nil
	target.Known[a.TargetSlot] = false
	e.invalidateKnowledgeForSlot(a.TargetID, a.TargetSlot)
	e.stackRankClaimed = true
	e.pendingStackGiveActor = a.PlayerID
	e.pendingStackGiveTargetID = a.TargetID
	e.pendingStackGiveTargetSlot = a.TargetSlot

	e.emit(Event{
		Type: "stack_opponent_success", PlayerID: a.PlayerID,
		Data: map[string]interface{}{
			"targetPlayer": a.TargetID, "targetSlot": a.TargetSlot, "card": discarded.String(),
			"needsGive": true,
		},
	})
	return nil
}

func (e *Engine) handleStackGive(a Action) error {
	if e.pendingStackGiveActor == "" {
		return fmt.Errorf("no card to give after stack")
	}
	if a.PlayerID != e.pendingStackGiveActor {
		return fmt.Errorf("not your stack give")
	}
	if err := e.rejectIfPendingAbilityFor(a.PlayerID); err != nil {
		return err
	}
	actor := e.findPlayer(a.PlayerID)
	target := e.findPlayer(e.pendingStackGiveTargetID)
	if actor == nil || target == nil {
		return fmt.Errorf("player not found")
	}
	if a.Slot < 0 || a.Slot >= HandSize || actor.Hand[a.Slot] == nil {
		return fmt.Errorf("invalid card slot")
	}
	ts := e.pendingStackGiveTargetSlot
	if ts < 0 || ts >= HandSize || target.Hand[ts] != nil {
		return fmt.Errorf("invalid target slot")
	}

	given := *actor.Hand[a.Slot]
	e.invalidateKnowledgeForSlot(a.PlayerID, a.Slot)
	actor.Hand[a.Slot] = nil
	actor.Known[a.Slot] = false
	target.Hand[ts] = &given
	target.Known[ts] = false
	e.recordPeekKnowledge(a.PlayerID, e.pendingStackGiveTargetID, ts, given.Rank)

	e.pendingStackGiveActor = ""
	e.pendingStackGiveTargetID = ""
	e.pendingStackGiveTargetSlot = -1

	e.emit(Event{
		Type: "stack_give_complete", PlayerID: a.PlayerID,
		Data: map[string]interface{}{
			"mySlot": a.Slot, "targetPlayer": target.ID, "targetSlot": ts,
		},
	})
	return nil
}

func (e *Engine) GetScores() map[string]int {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.scoresUnlocked()
}

func (e *Engine) scoresUnlocked() map[string]int {
	scores := make(map[string]int)
	for _, p := range e.Players {
		scores[p.ID] = p.Score()
	}
	return scores
}

func (e *Engine) GetState(forPlayerID string) map[string]interface{} {
	e.mu.RLock()
	defer e.mu.RUnlock()

	players := make([]map[string]interface{}, len(e.Players))
	for i, p := range e.Players {
		hand := make([]map[string]interface{}, HandSize)
		for j := 0; j < HandSize; j++ {
			slot := map[string]interface{}{"hasCard": p.Hand[j] != nil}
			if p.ID == forPlayerID && p.Known[j] && p.Hand[j] != nil {
				slot["card"] = p.Hand[j].String()
				slot["points"] = p.Hand[j].Points()
				slot["rank"] = int(p.Hand[j].Rank)
				slot["known"] = true
			}
			hand[j] = slot
		}
		players[i] = map[string]interface{}{
			"id": p.ID, "name": p.Name, "hand": hand,
			"calledCambio": p.CalledCambio, "cardCount": p.ActiveCardCount(),
			"isBot": p.IsBot,
		}
	}

	currentPlayerID := ""
	if len(e.Players) > 0 && e.CurrentTurn < len(e.Players) {
		currentPlayerID = e.Players[e.CurrentTurn].ID
	}

	state := map[string]interface{}{
		"gameId":                e.ID,
		"phase":                 phaseName(e.Phase),
		"players":               players,
		"currentTurn":           currentPlayerID,
		"hasDrawnCard":          e.DrawnCard != nil,
		"pendingAbility":        abilityName(e.PendingAbility),
		"peekOpponentRemaining": e.PeekOpponentRemaining,
	}
	if e.Deck != nil {
		state["deckRemaining"] = e.Deck.Remaining()
	} else {
		state["deckRemaining"] = 0
	}

	if len(e.DiscardPile) > 0 {
		top := e.DiscardPile[len(e.DiscardPile)-1]
		state["topDiscard"] = top.String()
		state["topDiscardRank"] = int(top.Rank)
	}
	state["openStackRank"] = int(e.openStackRank)
	state["stackRankClaimed"] = e.stackRankClaimed

	if forPlayerID != "" && e.pendingStackGiveActor == forPlayerID {
		state["pendingStackGive"] = map[string]interface{}{
			"targetId":   e.pendingStackGiveTargetID,
			"targetSlot": e.pendingStackGiveTargetSlot,
		}
	}

	if forPlayerID != "" && e.PendingAbility == LookAndSwitch && currentPlayerID == forPlayerID {
		state["lookSwitch"] = map[string]interface{}{
			"mySlot":     e.lookSwitchMySlot,
			"targetId":   e.lookSwitchTargetID,
			"targetSlot": e.lookSwitchTargetSlot,
			"peekDone":   e.lookSwitchPeekDone,
		}
	}

	if forPlayerID != "" {
		state["initPeeksLeft"] = initPeeksRemaining(e.InitPeekMask[forPlayerID])
		state["initPeekMask"] = int(e.InitPeekMask[forPlayerID])
		state["turnCounter"] = e.TurnCounter
		if mem := e.peekKnowledge[forPlayerID]; len(mem) > 0 {
			items := make([]map[string]interface{}, 0, len(mem))
			for key, entry := range mem {
				if entry.Strength < 0.12 {
					continue
				}
				items = append(items, map[string]interface{}{
					"key": key, "rank": int(entry.Rank), "strength": entry.Strength,
				})
			}
			state["memories"] = items
		}
		if e.DrawnCard != nil && currentPlayerID == forPlayerID {
			ab := e.DrawnCard.Ability()
			state["drawnCard"] = map[string]interface{}{
				"card":        e.DrawnCard.String(),
				"points":      e.DrawnCard.Points(),
				"ability":     abilityName(ab),
				"hasAbility":  ab != NoAbility,
				"abilityHint": drawnCardAbilityHint(ab),
			}
		}
	}

	if e.Phase == PhaseScoring {
		state["scores"] = e.scoresUnlocked()
	}

	return state
}

// MaxPlayers returns the room capacity.
func (e *Engine) MaxPlayers() int {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.maxPlayers
}

// PlayerCount returns seated players (humans + bots).
func (e *Engine) PlayerCount() int {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return len(e.Players)
}

// PlayerNames returns the display names of non-bot players (thread-safe).
func (e *Engine) PlayerNames() []string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	names := make([]string, 0, len(e.Players))
	for _, p := range e.Players {
		if !p.IsBot {
			names = append(names, p.Name)
		}
	}
	return names
}

// PublicPhase returns the current phase as a string.
func (e *Engine) PublicPhase() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return phaseName(e.Phase)
}

func initPeeksRemaining(mask uint8) int {
	n := 0
	if mask&1 == 0 {
		n++
	}
	if mask&2 == 0 {
		n++
	}
	return n
}

func (e *Engine) advanceTurn() {
	if len(e.Players) == 0 {
		return
	}
	e.decayMemories()
	e.TurnCounter++
	e.CurrentTurn = (e.CurrentTurn + 1) % len(e.Players)

	if e.Phase == PhaseFinalRound {
		if e.skipFinalRoundCount {
			e.skipFinalRoundCount = false
		} else {
			e.TurnsAfterCambio++
			if e.TurnsAfterCambio >= len(e.Players)-1 {
				e.Phase = PhaseScoring
				e.emit(Event{Type: "game_over", Data: e.scoresUnlocked()})
				return
			}
		}
	}

	e.emit(Event{
		Type: "turn_changed",
		Data: map[string]string{"currentPlayer": e.Players[e.CurrentTurn].ID},
	})
}

func (e *Engine) reshuffleDiscard() {
	if len(e.DiscardPile) <= 1 {
		return
	}
	top := e.DiscardPile[len(e.DiscardPile)-1]
	e.Deck.Cards = append(e.Deck.Cards, e.DiscardPile[:len(e.DiscardPile)-1]...)
	e.DiscardPile = []Card{top}
	e.Deck.Shuffle()
	e.emit(Event{Type: "deck_reshuffled"})
}

func knowledgeSlotKey(targetID string, slot int) string {
	return targetID + ":" + strconv.Itoa(slot)
}

func (e *Engine) recordPeekKnowledge(viewerID, targetPlayerID string, slot int, rank Rank) {
	if e.peekKnowledge[viewerID] == nil {
		e.peekKnowledge[viewerID] = make(map[string]memoryEntry)
	}
	key := knowledgeSlotKey(targetPlayerID, slot)
	prev := e.peekKnowledge[viewerID][key]
	strength := 1.0
	if prev.Strength > strength {
		strength = prev.Strength
	}
	e.peekKnowledge[viewerID][key] = memoryEntry{Rank: rank, Strength: strength}
}

func (e *Engine) invalidateKnowledgeForSlot(targetPlayerID string, slot int) {
	key := knowledgeSlotKey(targetPlayerID, slot)
	for vid := range e.peekKnowledge {
		delete(e.peekKnowledge[vid], key)
	}
}

func (e *Engine) getPeekKnowledge(viewerID, targetPlayerID string, slot int) (Rank, float64, bool) {
	m := e.peekKnowledge[viewerID]
	if m == nil {
		return 0, 0, false
	}
	entry, ok := m[knowledgeSlotKey(targetPlayerID, slot)]
	if !ok || entry.Strength < 0.12 {
		return 0, 0, false
	}
	return entry.Rank, entry.Strength, true
}

func (e *Engine) decayMemories() {
	const humanDecay = 0.88
	for viewerID, mem := range e.peekKnowledge {
		decay := humanDecay
		if p := e.findPlayer(viewerID); p != nil && p.IsBot {
			decay = p.MemoryDecay
		}
		for key, entry := range mem {
			entry.Strength *= decay
			if entry.Strength < 0.12 {
				delete(mem, key)
			} else {
				mem[key] = entry
			}
		}
	}
}

// CurrentBotThinkDelay returns ms to wait before the current bot acts.
func (e *Engine) CurrentBotThinkDelay() int {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.CurrentTurn < 0 || e.CurrentTurn >= len(e.Players) {
		return 2200
	}
	p := e.Players[e.CurrentTurn]
	if p.IsBot && p.ThinkDelayMs > 0 {
		return p.ThinkDelayMs
	}
	return 2200
}

func (e *Engine) applyPenaltyCard(player *Player) {
	penalty, ok := e.Deck.Draw()
	if !ok {
		e.reshuffleDiscard()
		penalty, ok = e.Deck.Draw()
	}
	if !ok {
		return
	}
	for i := 0; i < HandSize; i++ {
		if player.Hand[i] == nil {
			player.Hand[i] = &penalty
			player.Known[i] = false
			return
		}
	}
}

func (e *Engine) validateTurn(playerID string) error {
	if e.Phase != PhaseTurns && e.Phase != PhaseFinalRound {
		return fmt.Errorf("not in play phase")
	}
	if e.CurrentTurn < 0 || e.CurrentTurn >= len(e.Players) {
		return fmt.Errorf("invalid turn state")
	}
	if e.Players[e.CurrentTurn].ID != playerID {
		return fmt.Errorf("not your turn")
	}
	return nil
}

func (e *Engine) rejectIfPendingAbility() error {
	if e.PendingAbility != NoAbility {
		return fmt.Errorf("resolve your card ability first")
	}
	return nil
}

func (e *Engine) rejectIfPendingAbilityFor(playerID string) error {
	if e.PendingAbility == NoAbility {
		return nil
	}
	if len(e.Players) > 0 && e.CurrentTurn < len(e.Players) && e.Players[e.CurrentTurn].ID == playerID {
		return fmt.Errorf("resolve your card ability first")
	}
	return nil
}

func (e *Engine) rejectIfPendingStackGive(playerID string) error {
	if e.pendingStackGiveActor == "" {
		return nil
	}
	if e.pendingStackGiveActor == playerID {
		return fmt.Errorf("pick a card to give your opponent")
	}
	return nil
}

func (e *Engine) openStackWindow(rank Rank) {
	e.openStackRank = rank
	e.stackRankClaimed = false
	e.stackWindowOpenedAtMs = time.Now().UnixMilli()
}

func (e *Engine) clearStackWindow() {
	e.openStackRank = 0
	e.stackRankClaimed = false
	e.stackWindowOpenedAtMs = 0
}

// StackWindowReadyForBots returns true once humans had a brief window to react first.
func (e *Engine) StackWindowReadyForBots() bool {
	if e.openStackRank == 0 || e.stackWindowOpenedAtMs == 0 {
		return false
	}
	return time.Now().UnixMilli()-e.stackWindowOpenedAtMs >= 1400
}

func (e *Engine) findPlayer(id string) *Player {
	for _, p := range e.Players {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func (e *Engine) emit(event Event) {
	e.Events = append(e.Events, event)
}

func phaseName(p Phase) string {
	switch p {
	case PhaseWaiting:
		return "waiting"
	case PhaseInitPeek:
		return "init_peek"
	case PhaseTurns:
		return "turns"
	case PhaseFinalRound:
		return "final_round"
	case PhaseScoring:
		return "scoring"
	default:
		return "unknown"
	}
}

func abilityName(a Ability) string {
	switch a {
	case PeekOpponent:
		return "peek_opponent"
	case PeekOwn:
		return "peek_own"
	case BlindSwitch:
		return "blind_switch"
	case LookAndSwitch:
		return "look_and_switch"
	default:
		return "none"
	}
}

func drawnCardAbilityHint(a Ability) string {
	switch a {
	case PeekOpponent:
		return "Play to peek at an opponent (7/8)"
	case PeekOwn:
		return "Play to peek at your own card (9/10)"
	case BlindSwitch:
		return "Play to blind-switch with an opponent (J/Q)"
	case LookAndSwitch:
		return "Play for black king: look & optional switch"
	default:
		return ""
	}
}
