package game

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPolicyObsSize(t *testing.T) {
	e := NewEngine("test", 4)
	_ = e.AddBot("b1", "Bot 1", 2)
	_ = e.AddBot("b2", "Bot 2", 2)
	_ = e.AddPlayer("p1", "Human")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.RLock()
	obs := e.BuildBotObservation("b1")
	e.mu.RUnlock()
	if len(obs) != PolicyObsSize {
		t.Fatalf("obs size %d want %d", len(obs), PolicyObsSize)
	}
}

func TestLoadPolicyAndChoose(t *testing.T) {
	prefix := filepath.Join("..", "..", "models", "cambio")
	if _, err := os.Stat(prefix + "_policy.json"); err != nil {
		t.Skip("trained model not present")
	}
	if err := LoadPolicy(prefix); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("test", 2)
	_ = e.AddBot("b1", "Bot 1", 2)
	_ = e.AddPlayer("p1", "Human")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	e.mu.RLock()
	valid := e.ValidBotActionIndices("b1")
	obs := e.BuildBotObservation("b1")
	e.mu.RUnlock()
	if len(valid) == 0 {
		t.Fatal("expected valid init peek actions")
	}
	idx, ok := ChoosePolicyAction(obs, valid)
	if !ok {
		t.Fatal("ChoosePolicyAction failed")
	}
	if idx < PolicyActPeekOwnBase || idx > PolicyActPeekOwnBase+1 {
		t.Fatalf("unexpected init peek action %d", idx)
	}
}

func TestBotChooseWithPolicy(t *testing.T) {
	prefix := filepath.Join("..", "..", "models", "cambio")
	if _, err := os.Stat(prefix + "_policy.json"); err != nil {
		t.Skip("trained model not present")
	}
	if err := LoadPolicy(prefix); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("test", 2)
	_ = e.AddBot("b1", "Bot 1", 2)
	_ = e.AddPlayer("p1", "Human")
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	act, ok := e.BotChooseAction("b1")
	if !ok {
		t.Fatal("expected bot action")
	}
	if act.Type != ActionInitPeek {
		t.Fatalf("expected init peek, got %v", act.Type)
	}
}
