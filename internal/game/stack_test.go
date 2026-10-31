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

func TestSnapWrongRankDrawsPenalty(t *testing.T) {
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
	e.Players[0].SetCard(0, Card{Rank: Five, Suit: Hearts})
	e.mu.Unlock()

	events, err := e.Execute(Action{Type: ActionSnapMatch, PlayerID: "p1", Slot: 0})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, ev := range events {
		if ev.Type == "snap_failed" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected snap_failed event")
	}

	e.mu.RLock()
	defer e.mu.RUnlock()
	if len(e.Players[0].Extra) != 1 {
		t.Fatalf("expected one penalty card in Extra, got %d", len(e.Players[0].Extra))
	}
	if e.stackRankClaimed {
		t.Fatal("wrong snap should not claim stack window")
	}
	if e.openStackRank != Seven {
		t.Fatal("stack window should stay open after wrong snap")
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

func TestSnapBlockedWhileHoldingDrawnCard(t *testing.T) {
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
	e.Players[0].SetCard(0, Card{Rank: Seven, Suit: Hearts})
	card := Card{Rank: Ace, Suit: Spades}
	e.DrawnCard = &card
	e.mu.Unlock()

	_, err := e.Execute(Action{Type: ActionSnapMatch, PlayerID: "p1", Slot: 0})
	if err == nil || err.Error() != "finish your draw action first" {
		t.Fatalf("expected draw action block, got %v", err)
	}
}

func TestStackOpponentRequiresMemory(t *testing.T) {
	e := NewEngine("test", 2)
	_ = e.AddPlayer("p1", "Alice")
	_ = e.AddPlayer("p2", "Bob")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.Phase = PhaseTurns
	e.openStackWindow(Seven)
	e.Players[1].SetCard(0, Card{Rank: Seven, Suit: Hearts})
	e.mu.Unlock()

	_, err := e.Execute(Action{Type: ActionStackOpponent, PlayerID: "p1", TargetID: "p2", TargetSlot: 0})
	if err == nil {
		t.Fatal("expected error without opponent memory")
	}
}

func TestSnapExtraSlotNoPanic(t *testing.T) {
	e := NewEngine("test", 2)
	_ = e.AddPlayer("p1", "Alice")
	_ = e.AddPlayer("p2", "Bob")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.Phase = PhaseTurns
	e.openStackWindow(Seven)
	for i := 0; i < HandSize; i++ {
		e.Players[0].SetCard(i, Card{Rank: Five, Suit: Hearts})
	}
	card := Card{Rank: Three, Suit: Clubs}
	e.Players[0].Extra = append(e.Players[0].Extra, &card)
	e.mu.Unlock()

	events, err := e.Execute(Action{Type: ActionSnapMatch, PlayerID: "p1", Slot: HandSize})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	found := false
	for _, ev := range events {
		if ev.Type == "snap_failed" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected snap_failed for wrong extra-card stack")
	}

	e.mu.RLock()
	defer e.mu.RUnlock()
	if len(e.Players[0].Extra) != 2 {
		t.Fatalf("expected two extra cards after penalty, got %d", len(e.Players[0].Extra))
	}
	_ = e.GetState("p1")
}

func TestRepeatedWrongSnapNoPanic(t *testing.T) {
	e := NewEngine("test", 2)
	_ = e.AddPlayer("p1", "Alice")
	_ = e.AddPlayer("p2", "Bob")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.Phase = PhaseTurns
	e.openStackWindow(Seven)
	e.Players[0].SetCard(0, Card{Rank: Five, Suit: Hearts})
	e.mu.Unlock()

	for i := 0; i < 20; i++ {
		_, err := e.Execute(Action{Type: ActionSnapMatch, PlayerID: "p1", Slot: 0})
		if err != nil {
			t.Fatalf("snap %d: %v", i, err)
		}
		_ = e.GetState("p1")
	}
}

func TestSwapWithExtraSlot(t *testing.T) {
	e := NewEngine("test", 2)
	_ = e.AddPlayer("p1", "Alice")
	_ = e.AddPlayer("p2", "Bob")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.Phase = PhaseTurns
	e.CurrentTurn = 0
	for i := 0; i < HandSize; i++ {
		e.Players[0].SetCard(i, Card{Rank: Five, Suit: Hearts})
	}
	penalty := Card{Rank: Three, Suit: Clubs}
	e.Players[0].Extra = append(e.Players[0].Extra, &penalty)
	drawn := Card{Rank: Ace, Suit: Spades}
	e.DrawnCard = &drawn
	e.mu.Unlock()

	_, err := e.Execute(Action{Type: ActionSwapCard, PlayerID: "p1", Slot: HandSize})
	if err != nil {
		t.Fatalf("swap extra slot: %v", err)
	}

	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.DrawnCard != nil {
		t.Fatal("drawn card should be cleared")
	}
	if len(e.Players[0].Extra) != 1 || e.Players[0].Extra[0].Rank != Ace {
		t.Fatalf("expected ace in extra, got %v", e.Players[0].Extra)
	}
	if len(e.DiscardPile) == 0 || e.DiscardPile[len(e.DiscardPile)-1].Rank != Three {
		t.Fatal("expected discarded three from swapped extra card")
	}
}

func TestSnapLastCardEndsGame(t *testing.T) {
	e := NewEngine("test", 2)
	_ = e.AddPlayer("p1", "Alice")
	_ = e.AddPlayer("p2", "Bob")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.Phase = PhaseTurns
	e.openStackWindow(Seven)
	for i := 0; i < HandSize; i++ {
		e.Players[0].Hand[i] = nil
	}
	e.Players[0].SetCard(0, Card{Rank: Seven, Suit: Hearts})
	e.mu.Unlock()

	_, err := e.Execute(Action{Type: ActionSnapMatch, PlayerID: "p1", Slot: 0})
	if err != nil {
		t.Fatal(err)
	}

	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.Phase != PhaseScoring {
		t.Fatalf("expected scoring phase, got %v", e.Phase)
	}
	if e.Players[0].ActiveCardCount() != 0 {
		t.Fatalf("expected empty hand, got %d cards", e.Players[0].ActiveCardCount())
	}
}

func TestStackOpponentLastCardDoesNotEndBeforeGive(t *testing.T) {
	e := NewEngine("test", 2)
	_ = e.AddPlayer("p1", "Alice")
	_ = e.AddPlayer("p2", "Bob")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.Phase = PhaseTurns
	e.openStackWindow(Seven)
	for i := 0; i < HandSize; i++ {
		e.Players[0].Hand[i] = nil
	}
	e.Players[0].SetCard(0, Card{Rank: King, Suit: Spades})
	for i := 0; i < HandSize; i++ {
		e.Players[1].Hand[i] = nil
	}
	e.Players[1].SetCard(2, Card{Rank: Seven, Suit: Clubs})
	e.recordPeekKnowledge("p1", "p2", 2, Seven)
	e.mu.Unlock()

	_, err := e.Execute(Action{Type: ActionStackOpponent, PlayerID: "p1", TargetID: "p2", TargetSlot: 2})
	if err != nil {
		t.Fatal(err)
	}

	e.mu.RLock()
	if e.Phase == PhaseScoring {
		e.mu.RUnlock()
		t.Fatal("game should not end before stack give")
	}
	if e.pendingStackGiveActor != "p1" {
		e.mu.RUnlock()
		t.Fatalf("expected pending give for p1, got %q", e.pendingStackGiveActor)
	}
	if e.Players[1].ActiveCardCount() != 0 {
		e.mu.RUnlock()
		t.Fatalf("target should have no cards before give, got %d", e.Players[1].ActiveCardCount())
	}
	e.mu.RUnlock()

	_, err = e.Execute(Action{Type: ActionStackGive, PlayerID: "p1", Slot: 0})
	if err != nil {
		t.Fatal(err)
	}

	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.Phase != PhaseScoring {
		t.Fatal("actor gave their last card; game should end")
	}
	if e.Players[0].ActiveCardCount() != 0 {
		t.Fatalf("actor should have no cards after giving last one, got %d", e.Players[0].ActiveCardCount())
	}
	if e.Players[1].ActiveCardCount() != 1 {
		t.Fatalf("target should have one card after give, got %d", e.Players[1].ActiveCardCount())
	}
	if e.Players[1].Hand[2] == nil || e.Players[1].Hand[2].Rank != King {
		t.Fatal("target should have received the king")
	}
}

func TestStackOpponentLastCardResumesAfterGive(t *testing.T) {
	e := NewEngine("test", 2)
	_ = e.AddPlayer("p1", "Alice")
	_ = e.AddPlayer("p2", "Bob")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.Phase = PhaseTurns
	e.openStackWindow(Seven)
	e.Players[0].SetCard(0, Card{Rank: King, Suit: Spades})
	e.Players[0].SetCard(1, Card{Rank: Ace, Suit: Diamonds})
	for i := 0; i < HandSize; i++ {
		e.Players[1].Hand[i] = nil
	}
	e.Players[1].SetCard(2, Card{Rank: Seven, Suit: Clubs})
	e.recordPeekKnowledge("p1", "p2", 2, Seven)
	e.mu.Unlock()

	_, err := e.Execute(Action{Type: ActionStackOpponent, PlayerID: "p1", TargetID: "p2", TargetSlot: 2})
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.Execute(Action{Type: ActionStackGive, PlayerID: "p1", Slot: 0})
	if err != nil {
		t.Fatal(err)
	}

	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.Phase == PhaseScoring {
		t.Fatal("game should continue when actor still has cards after give")
	}
	if e.Players[1].ActiveCardCount() != 1 {
		t.Fatalf("target should have one card after give, got %d", e.Players[1].ActiveCardCount())
	}
	if e.Players[0].ActiveCardCount() != 3 {
		t.Fatalf("actor should still have three cards, got %d", e.Players[0].ActiveCardCount())
	}
}
