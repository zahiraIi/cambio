package game

import "testing"

func TestStackWindowSurvivesAdvanceTurn(t *testing.T) {
	e := NewEngine("test", 3)
	_ = e.AddPlayer("p1", "Alice")
	_ = e.AddPlayer("p2", "Bob")
	_ = e.AddPlayer("p3", "Carol")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.Phase = PhaseTurns
	e.CurrentTurn = 0
	e.openStackWindow(Seven)
	e.mu.Unlock()

	e.mu.RLock()
	if e.openStackRank != Seven {
		t.Fatalf("expected open stack rank 7, got %v", e.openStackRank)
	}
	e.mu.RUnlock()

	e.advanceTurn()

	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.openStackRank != Seven {
		t.Fatalf("stack window cleared after advanceTurn, rank=%v", e.openStackRank)
	}
	if e.stackRankClaimed {
		t.Fatal("stack should not be claimed yet")
	}
}

func TestSnapClaimsStackWindow(t *testing.T) {
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

	_, err := e.Execute(Action{Type: ActionSnapMatch, PlayerID: "p2", Slot: 0})
	if err != nil {
		t.Fatal(err)
	}

	e.mu.RLock()
	defer e.mu.RUnlock()
	if !e.stackRankClaimed {
		t.Fatal("expected stack claimed after snap")
	}
	if e.Players[1].Hand[0] != nil {
		t.Fatal("expected card removed from hand")
	}
}
