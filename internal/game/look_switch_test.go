package game

import "testing"

func TestLookSwitchOwnSlotZero(t *testing.T) {
	e := NewEngine("test", 2)
	_ = e.AddPlayer("p1", "Alice")
	_ = e.AddPlayer("p2", "Bob")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.Phase = PhaseTurns
	e.CurrentTurn = 0
	e.PendingAbility = LookAndSwitch
	e.Players[0].SetCard(0, Card{Rank: King, Suit: Spades})
	e.mu.Unlock()

	if _, err := e.Execute(Action{Type: ActionLookSwitchOwn, PlayerID: "p1", Slot: 0}); err != nil {
		t.Fatalf("slot 0 should be valid first pick: %v", err)
	}
}

func TestLookSwitchKeepWithoutSwap(t *testing.T) {
	e := NewEngine("test", 2)
	_ = e.AddPlayer("p1", "Alice")
	_ = e.AddPlayer("p2", "Bob")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.Phase = PhaseTurns
	e.CurrentTurn = 0
	e.PendingAbility = LookAndSwitch
	e.Players[0].SetCard(0, Card{Rank: King, Suit: Spades})
	e.Players[1].SetCard(1, Card{Rank: Five, Suit: Hearts})
	e.mu.Unlock()

	if _, err := e.Execute(Action{Type: ActionLookSwitchOwn, PlayerID: "p1", Slot: 0}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Execute(Action{Type: ActionLookSwitchPeek, PlayerID: "p1", TargetID: "p2", TargetSlot: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Execute(Action{Type: ActionDeclineSwitch, PlayerID: "p1"}); err != nil {
		t.Fatal(err)
	}

	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.PendingAbility != NoAbility {
		t.Fatalf("expected ability cleared, got %v", e.PendingAbility)
	}
	if e.Players[0].Hand[0].Rank != King {
		t.Fatalf("expected p1 to keep king, got %v", e.Players[0].Hand[0])
	}
	if e.Players[1].Hand[1].Rank != Five {
		t.Fatalf("expected p2 to keep five, got %v", e.Players[1].Hand[1])
	}
}
