package game

import "testing"

func completeTurnWithReturn(t *testing.T, e *Engine, playerID string) {
	t.Helper()
	if _, err := e.Execute(Action{Type: ActionDrawDeck, PlayerID: playerID}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Execute(Action{Type: ActionReturnDrawn, PlayerID: playerID}); err != nil {
		t.Fatal(err)
	}
}

func TestCallCambioEndsAfterOtherPlayersTurn(t *testing.T) {
	e := NewEngine("test", 3)
	_ = e.AddPlayer("p1", "A")
	_ = e.AddPlayer("p2", "B")
	_ = e.AddPlayer("p3", "C")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}

	e.mu.Lock()
	e.Phase = PhaseTurns
	e.CurrentTurn = 0
	e.mu.Unlock()

	if _, err := e.Execute(Action{Type: ActionCallCambio, PlayerID: "p1"}); err != nil {
		t.Fatal(err)
	}

	e.mu.RLock()
	if e.Phase != PhaseFinalRound {
		t.Fatalf("expected final_round, got %s", phaseName(e.Phase))
	}
	if e.Players[e.CurrentTurn].ID != "p2" {
		t.Fatalf("expected p2 turn after cambio, got %s", e.Players[e.CurrentTurn].ID)
	}
	e.mu.RUnlock()

	completeTurnWithReturn(t, e, "p2")
	completeTurnWithReturn(t, e, "p3")

	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.Phase != PhaseScoring {
		t.Fatalf("expected scoring after final round, got %s", phaseName(e.Phase))
	}
}

func TestCallCambioRecoversFromStuckBotTurn(t *testing.T) {
	e := NewEngine("test", 3)
	_ = e.AddPlayer("p1", "Human")
	_ = e.AddBot("bot1", "Bot 1", 2)
	_ = e.AddBot("bot2", "Bot 2", 2)
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}

	e.mu.Lock()
	e.Phase = PhaseTurns
	e.CurrentTurn = 0
	e.mu.Unlock()

	if _, err := e.Execute(Action{Type: ActionCallCambio, PlayerID: "p1"}); err != nil {
		t.Fatal(err)
	}

	// Bot 1 stuck mid look-and-switch — recovery should still advance final round.
	e.mu.Lock()
	e.PendingAbility = LookAndSwitch
	e.lookSwitchMySlot = 0
	e.lookSwitchPeekDone = false
	e.mu.Unlock()

	if events := e.ForceAdvanceBotTurn(); len(events) == 0 {
		t.Fatal("expected bot recovery to advance turn")
	}

	completeTurnWithReturn(t, e, "bot2")

	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.Phase != PhaseScoring {
		t.Fatalf("expected scoring after final round, got %s", phaseName(e.Phase))
	}
}

func TestCallCambioTwoPlayers(t *testing.T) {
	e := NewEngine("test", 2)
	_ = e.AddPlayer("p1", "A")
	_ = e.AddPlayer("p2", "B")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}

	e.mu.Lock()
	e.Phase = PhaseTurns
	e.CurrentTurn = 0
	e.mu.Unlock()

	if _, err := e.Execute(Action{Type: ActionCallCambio, PlayerID: "p1"}); err != nil {
		t.Fatal(err)
	}
	completeTurnWithReturn(t, e, "p2")

	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.Phase != PhaseScoring {
		t.Fatalf("expected scoring, got %s", phaseName(e.Phase))
	}
}

func TestCallCambioRevealsHand(t *testing.T) {
	e := NewEngine("test", 2)
	_ = e.AddPlayer("p1", "Alice")
	_ = e.AddPlayer("p2", "Bob")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.Phase = PhaseTurns
	e.CurrentTurn = 0
	e.Players[0].SetCard(0, Card{Rank: Ace, Suit: Hearts})
	e.Players[0].SetCard(1, Card{Rank: King, Suit: Spades})
	e.Players[0].Known[0] = false
	e.Players[0].Known[1] = false
	e.mu.Unlock()

	if _, err := e.Execute(Action{Type: ActionCallCambio, PlayerID: "p1"}); err != nil {
		t.Fatal(err)
	}

	state := e.GetState("p2")
	players := state["players"].([]map[string]interface{})
	var alice map[string]interface{}
	for _, pl := range players {
		if pl["id"] == "p1" {
			alice = pl
			break
		}
	}
	if alice == nil {
		t.Fatal("alice not in state")
	}
	hand := alice["hand"].([]map[string]interface{})
	if hand[0]["card"] == nil || hand[1]["card"] == nil {
		t.Fatalf("expected all cambio caller cards revealed to opponent, got %v", hand)
	}
	if hand[0]["revealed"] != true {
		t.Fatal("expected revealed flag on cambio hand")
	}
}

func TestCallCambioDisablesStacking(t *testing.T) {
	e := NewEngine("test", 2)
	_ = e.AddPlayer("p1", "Alice")
	_ = e.AddPlayer("p2", "Bob")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.Phase = PhaseTurns
	e.CurrentTurn = 0
	e.openStackWindow(Seven)
	e.Players[1].SetCard(0, Card{Rank: Seven, Suit: Hearts})
	e.mu.Unlock()

	if _, err := e.Execute(Action{Type: ActionCallCambio, PlayerID: "p1"}); err != nil {
		t.Fatal(err)
	}

	e.mu.RLock()
	if e.openStackRank != 0 {
		t.Fatalf("expected stack window cleared, rank=%v", e.openStackRank)
	}
	e.mu.RUnlock()

	_, err := e.Execute(Action{Type: ActionSnapMatch, PlayerID: "p2", Slot: 0})
	if err == nil || err.Error() != "cannot snap now" {
		t.Fatalf("expected snap blocked after cambio, got %v", err)
	}
}
