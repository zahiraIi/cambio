package game

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestSoloGameWithPolicyCompletes(t *testing.T) {
	prefix := filepath.Join("..", "..", "models", "cambio")
	if _, err := os.Stat(prefix + "_policy.json"); err != nil {
		t.Skip("trained model not present")
	}
	if err := LoadPolicy(prefix); err != nil {
		t.Fatal(err)
	}

	e := NewEngine("solo-test", 2)
	for i := 0; i < 2; i++ {
		id := fmt.Sprintf("bot-%d", i)
		if err := e.AddBot(id, "Bot", 2); err != nil {
			t.Fatal(err)
		}
	}
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}

	forcedCambio := false
	for step := 0; step < 4000; step++ {
		if !forcedCambio && step > 1200 && e.PublicPhase() == "turns" {
			e.mu.RLock()
			cur := e.Players[e.CurrentTurn]
			e.mu.RUnlock()
			if cur.IsBot {
				if _, err := e.Execute(Action{Type: ActionCallCambio, PlayerID: cur.ID}); err == nil {
					forcedCambio = true
					continue
				}
			}
		}

		botID := e.NextAutomaticBotID()
		if botID == "" {
			if e.PublicPhase() == "scoring" {
				return
			}
			continue
		}
		act, ok := e.BotChooseAction(botID)
		if !ok {
			events := e.ForceSkipStackGive()
			if len(events) == 0 {
				events = e.ForceSkipAbility()
			}
			if len(events) == 0 {
				events = e.ForceAdvanceBotTurn()
			}
			if len(events) == 0 {
				t.Fatalf("step %d: no action for %s phase=%s", step, botID, e.PublicPhase())
			}
			continue
		}
		if _, err := e.Execute(act); err != nil {
			t.Fatalf("step %d bot %s act %v: %v", step, botID, act.Type, err)
		}
	}
	t.Fatal("game did not reach scoring within step limit")
}
