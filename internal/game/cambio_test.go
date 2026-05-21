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
