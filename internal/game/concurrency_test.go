package game

import (
	"sync"
	"testing"
)

// The server's bot pump calls NextAutomaticBotID from its own goroutine while
// websocket handlers mutate the engine; run with -race.
func TestNextAutomaticBotID_ConcurrentWithStart(t *testing.T) {
	e := NewEngine("race", 3)
	if err := e.AddPlayer("human", "Human"); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"b1", "b2"} {
		if err := e.AddBot(id, "Bot", 2); err != nil {
			t.Fatal(err)
		}
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			e.NextAutomaticBotID()
		}
	}()
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
}
