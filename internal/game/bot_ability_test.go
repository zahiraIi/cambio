package game

import "testing"

// Bot with pending peek ability must resolve it before attempting stack snap.
func TestBotChoosesAbilityOverSnap(t *testing.T) {
	e := NewEngine("test", 3)
	_ = e.AddBot("bot1", "Bot 1", 2)
	_ = e.AddPlayer("human", "Human")

	e.mu.Lock()
	e.Phase = PhaseTurns
	e.CurrentTurn = 0
	e.Players[0].SetCard(0, Card{Rank: Seven, Suit: Hearts})
	e.Players[0].SetCard(1, Card{Rank: Seven, Suit: Spades})
	e.Players[1].SetCard(0, Card{Rank: King, Suit: Clubs})
	e.PendingAbility = PeekOpponent
	e.PeekOpponentRemaining = 1
	e.openStackWindow(Seven)
	e.stackWindowOpenedAtMs = 1 // past human reaction window for bots
	e.mu.Unlock()

	act, ok := e.BotChooseAction("bot1")
	if !ok {
		t.Fatal("expected bot action")
	}
	if act.Type == ActionSnapMatch {
		t.Fatalf("bot chose snap while pending ability %v", PeekOpponent)
	}
	if act.Type != ActionPeekOpponent {
		t.Fatalf("expected peek opponent, got action type %d", act.Type)
	}
}
