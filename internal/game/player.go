package game

import "fmt"

const HandSize = 4

type Player struct {
	ID           string
	Name         string
	Hand         [HandSize]*Card
	Known        [HandSize]bool // which cards this player has peeked at (abilities / post-swap)
	IsBot        bool
	CalledCambio bool
	MemoryDecay  float64 // bot memory retention per turn (0–1)
	ThinkDelayMs int     // bot pause before acting
}

func NewPlayer(id, name string) *Player {
	return &Player{ID: id, Name: name}
}

func NewBotPlayer(id, name string) *Player {
	return &Player{ID: id, Name: name, IsBot: true, MemoryDecay: 0.85, ThinkDelayMs: 2000}
}

func ApplyBotDifficulty(p *Player, difficulty int) {
	switch difficulty {
	case 1: // easy — forgets quickly, slow
		p.MemoryDecay = 0.72
		p.ThinkDelayMs = 2800
	case 3: // hard — strong memory, still human-paced
		p.MemoryDecay = 0.96
		p.ThinkDelayMs = 1600
	default: // medium
		p.MemoryDecay = 0.85
		p.ThinkDelayMs = 2200
	}
}

func (p *Player) Score() int {
	total := 0
	for _, card := range p.Hand {
		if card != nil {
			total += card.Points()
		}
	}
	return total
}

func (p *Player) SetCard(slot int, card Card) error {
	if slot < 0 || slot >= HandSize {
		return fmt.Errorf("invalid slot %d", slot)
	}
	p.Hand[slot] = &card
	return nil
}

func (p *Player) SwapCard(slot int, incoming Card) (Card, error) {
	if slot < 0 || slot >= HandSize {
		return Card{}, fmt.Errorf("invalid slot %d", slot)
	}
	if p.Hand[slot] == nil {
		return Card{}, fmt.Errorf("no card in slot %d", slot)
	}
	old := *p.Hand[slot]
	p.Hand[slot] = &incoming
	p.Known[slot] = false
	return old, nil
}

func (p *Player) PeekCard(slot int) (Card, error) {
	if slot < 0 || slot >= HandSize {
		return Card{}, fmt.Errorf("invalid slot %d", slot)
	}
	if p.Hand[slot] == nil {
		return Card{}, fmt.Errorf("no card in slot %d", slot)
	}
	p.Known[slot] = true
	return *p.Hand[slot], nil
}

func (p *Player) ActiveCardCount() int {
	count := 0
	for _, card := range p.Hand {
		if card != nil {
			count++
		}
	}
	return count
}
