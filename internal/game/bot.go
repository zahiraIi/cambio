package game

import "math/rand/v2"

// NextAutomaticBotID returns a bot player ID that should act next, or "".
func (e *Engine) NextAutomaticBotID() string {
	switch e.Phase {
	case PhaseInitPeek:
		for _, p := range e.Players {
			if p.IsBot && e.InitPeekMask[p.ID] != 0b11 {
				return p.ID
			}
		}
	case PhaseTurns, PhaseFinalRound:
		if e.pendingStackGiveActor != "" {
			p := e.findPlayer(e.pendingStackGiveActor)
			if p != nil && p.IsBot {
				return p.ID
			}
		}
		if len(e.Players) > 0 && e.CurrentTurn >= 0 && e.CurrentTurn < len(e.Players) {
			cur := e.Players[e.CurrentTurn]
			if cur.IsBot && e.PendingAbility != NoAbility {
				return cur.ID
			}
		}
		if !e.stackRankClaimed && e.openStackRank != 0 && e.StackWindowReadyForBots() {
			for _, p := range e.Players {
				if !p.IsBot {
					continue
				}
				for s := 0; s < HandSize; s++ {
					if c := p.Hand[s]; c != nil && c.Rank == e.openStackRank {
						return p.ID
					}
				}
			}
		}
		if len(e.Players) == 0 || e.CurrentTurn < 0 || e.CurrentTurn >= len(e.Players) {
			return ""
		}
		cur := e.Players[e.CurrentTurn]
		if cur.IsBot {
			return cur.ID
		}
	}
	return ""
}

// BotChooseAction picks an action for the given bot using the loaded policy or heuristics.
func (e *Engine) BotChooseAction(botID string) (Action, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	bot := e.findPlayer(botID)
	if bot == nil || !bot.IsBot {
		return Action{}, false
	}

	if PolicyIsLoaded() && e.PendingAbility != LookAndSwitch {
		obs := e.BuildBotObservation(botID)
		valid := e.ValidBotActionIndices(botID)
		if idx, ok := ChoosePolicyAction(obs, valid); ok {
			if act, ok2 := e.ActionFromPolicyIndex(botID, idx); ok2 {
				return act, true
			}
		}
	}

	return e.botChooseHeuristic(botID, bot)
}

func (e *Engine) botChooseHeuristic(botID string, bot *Player) (Action, bool) {
	if e.Phase == PhaseInitPeek {
		mask := e.InitPeekMask[botID]
		if mask == 0b11 {
			return Action{}, false
		}
		slots := initPeekSlotsRemaining(mask)
		if len(slots) == 0 {
			return Action{}, false
		}
		slot := slots[rand.IntN(len(slots))]
		return Action{Type: ActionInitPeek, PlayerID: botID, Slot: slot}, true
	}

	if e.pendingStackGiveActor == botID {
		slots := slotsWithCards(bot)
		if len(slots) == 0 {
			return Action{}, false
		}
		return Action{Type: ActionStackGive, PlayerID: botID, Slot: slots[rand.IntN(len(slots))]}, true
	}

	if e.PendingAbility != NoAbility {
		if len(e.Players) == 0 || e.CurrentTurn >= len(e.Players) {
			return Action{}, false
		}
		if e.Players[e.CurrentTurn].ID != botID {
			return Action{}, false
		}
		return e.botResolveAbility(botID, bot)
	}

	if !e.stackRankClaimed && e.openStackRank != 0 && e.StackWindowReadyForBots() {
		for s := 0; s < HandSize; s++ {
			if c := bot.Hand[s]; c != nil && c.Rank == e.openStackRank {
				return Action{Type: ActionSnapMatch, PlayerID: botID, Slot: s}, true
			}
		}
	}

	if e.Phase != PhaseTurns && e.Phase != PhaseFinalRound {
		return Action{}, false
	}
	if len(e.Players) == 0 || e.CurrentTurn >= len(e.Players) {
		return Action{}, false
	}
	if e.Players[e.CurrentTurn].ID != botID {
		return Action{}, false
	}

	if e.DrawnCard != nil {
		if e.DrawnCard.Ability() != NoAbility && rand.Float32() < 0.82 {
			return Action{Type: ActionDiscard, PlayerID: botID}, true
		}
		if rand.IntN(2) == 0 {
			return Action{Type: ActionDiscard, PlayerID: botID}, true
		}
		slots := slotsWithCards(bot)
		if len(slots) == 0 {
			return Action{Type: ActionDiscard, PlayerID: botID}, true
		}
		return Action{Type: ActionSwapCard, PlayerID: botID, Slot: slots[rand.IntN(len(slots))]}, true
	}

	if e.Phase == PhaseTurns && rand.Float32() < 0.1 && bot.Score() <= 14 {
		return Action{Type: ActionCallCambio, PlayerID: botID}, true
	}

	if len(e.DiscardPile) > 0 && rand.IntN(4) != 0 {
		return Action{Type: ActionDrawDiscard, PlayerID: botID}, true
	}
	return Action{Type: ActionDrawDeck, PlayerID: botID}, true
}

func initPeekSlotsRemaining(mask uint8) []int {
	var slots []int
	if mask&1 == 0 {
		slots = append(slots, 0)
	}
	if mask&2 == 0 {
		slots = append(slots, 1)
	}
	return slots
}

func (e *Engine) botResolveAbility(botID string, bot *Player) (Action, bool) {
	switch e.PendingAbility {
	case PeekOpponent:
		return botPickPeekOpponent(e, botID)
	case PeekOwn:
		slots := slotsWithCards(bot)
		if len(slots) == 0 {
			return Action{}, false
		}
		return Action{Type: ActionPeekOwn, PlayerID: botID, Slot: slots[rand.IntN(len(slots))]}, true
	case BlindSwitch:
		return botPickBlindSwitch(e, botID, bot)
	case LookAndSwitch:
		return botPickLookSwitch(e, botID, bot)
	default:
		return Action{}, false
	}
}

func botPickPeekOpponent(e *Engine, botID string) (Action, bool) {
	var candidates []*Player
	for _, p := range e.Players {
		if p.ID != botID && p.ActiveCardCount() > 0 {
			candidates = append(candidates, p)
		}
	}
	if len(candidates) == 0 {
		return Action{}, false
	}
	target := candidates[rand.IntN(len(candidates))]
	slots := slotsWithCards(target)
	if len(slots) == 0 {
		return Action{}, false
	}
	ts := slots[rand.IntN(len(slots))]
	return Action{Type: ActionPeekOpponent, PlayerID: botID, TargetID: target.ID, TargetSlot: ts}, true
}

func botPickBlindSwitch(e *Engine, botID string, bot *Player) (Action, bool) {
	mySlots := slotsWithCards(bot)
	if len(mySlots) == 0 {
		return Action{}, false
	}
	var oppCandidates []struct {
		p *Player
		s []int
	}
	for _, p := range e.Players {
		if p.ID == botID {
			continue
		}
		ss := slotsWithCards(p)
		if len(ss) > 0 {
			oppCandidates = append(oppCandidates, struct {
				p *Player
				s []int
			}{p, ss})
		}
	}
	if len(oppCandidates) == 0 {
		return Action{}, false
	}
	ch := oppCandidates[rand.IntN(len(oppCandidates))]
	ms := mySlots[rand.IntN(len(mySlots))]
	ts := ch.s[rand.IntN(len(ch.s))]
	return Action{
		Type: ActionBlindSwitch, PlayerID: botID,
		Slot: ms, TargetID: ch.p.ID, TargetSlot: ts,
	}, true
}

func botPickLookSwitch(e *Engine, botID string, bot *Player) (Action, bool) {
	if e.lookSwitchMySlot < 0 {
		mySlots := slotsWithCards(bot)
		if len(mySlots) == 0 {
			return Action{}, false
		}
		ms := mySlots[rand.IntN(len(mySlots))]
		return Action{Type: ActionLookSwitchOwn, PlayerID: botID, Slot: ms}, true
	}
	if !e.lookSwitchPeekDone {
		var oppCandidates []struct {
			p *Player
			s []int
		}
		for _, p := range e.Players {
			if p.ID == botID {
				continue
			}
			ss := slotsWithCards(p)
			if len(ss) > 0 {
				oppCandidates = append(oppCandidates, struct {
					p *Player
					s []int
				}{p, ss})
			}
		}
		if len(oppCandidates) == 0 {
			return Action{}, false
		}
		ch := oppCandidates[rand.IntN(len(oppCandidates))]
		ts := ch.s[rand.IntN(len(ch.s))]
		return Action{
			Type: ActionLookSwitchPeek, PlayerID: botID,
			TargetID: ch.p.ID, TargetSlot: ts,
		}, true
	}
	if rand.IntN(2) == 0 {
		return Action{
			Type: ActionLookAndSwitch, PlayerID: botID,
			Slot: e.lookSwitchMySlot, TargetID: e.lookSwitchTargetID, TargetSlot: e.lookSwitchTargetSlot,
		}, true
	}
	return Action{Type: ActionDeclineSwitch, PlayerID: botID}, true
}

func slotsWithCards(p *Player) []int {
	var out []int
	for i := 0; i < HandSize; i++ {
		if p.Hand[i] != nil {
			out = append(out, i)
		}
	}
	return out
}
