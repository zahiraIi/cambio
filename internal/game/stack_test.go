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

func TestStackOpponentRequiresGiveCard(t *testing.T) {
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
	e.Players[0].SetCard(0, Card{Rank: King, Suit: Spades})
	e.Players[1].SetCard(2, Card{Rank: Seven, Suit: Clubs})
	e.recordPeekKnowledge("p1", "p2", 2, Seven)
	e.mu.Unlock()

	_, err := e.Execute(Action{Type: ActionStackOpponent, PlayerID: "p1", TargetID: "p2", TargetSlot: 2})
	if err != nil {
		t.Fatal(err)
	}

	e.mu.RLock()
	if e.pendingStackGiveActor != "p1" {
		t.Fatalf("expected pending give for p1, got %q", e.pendingStackGiveActor)
	}
	if e.Players[1].Hand[2] != nil {
		t.Fatal("target slot should be empty after stack")
	}
	e.mu.RUnlock()

	_, err = e.Execute(Action{Type: ActionDrawDeck, PlayerID: "p1"})
	if err == nil || err.Error() != "pick a card to give your opponent" {
		t.Fatalf("expected blocked draw, got %v", err)
	}

	_, err = e.Execute(Action{Type: ActionStackGive, PlayerID: "p1", Slot: 0})
	if err != nil {
		t.Fatal(err)
	}

	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.pendingStackGiveActor != "" {
		t.Fatal("pending stack give should be cleared")
	}
	if e.Players[0].Hand[0] != nil {
		t.Fatal("actor should have given away slot 0")
	}
	if e.Players[1].Hand[2] == nil || e.Players[1].Hand[2].Rank != King {
		t.Fatalf("target should have received king, got %v", e.Players[1].Hand[2])
	}
}
