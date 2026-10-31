package game

import "math/rand/v2"

type Deck struct {
	Cards []Card
}

func NewDeck() *Deck {
	d := &Deck{}
	suits := []Suit{Hearts, Diamonds, Clubs, Spades}
	for _, suit := range suits {
		for rank := Ace; rank <= King; rank++ {
			d.Cards = append(d.Cards, Card{Rank: rank, Suit: suit})
		}
	}
	d.Cards = append(d.Cards, Card{Rank: Joker, Suit: JokerSuit})
	d.Cards = append(d.Cards, Card{Rank: Joker, Suit: JokerSuit})
	return d
}

func (d *Deck) Shuffle() {
	rand.Shuffle(len(d.Cards), func(i, j int) {
		d.Cards[i], d.Cards[j] = d.Cards[j], d.Cards[i]
	})
}

func (d *Deck) Draw() (Card, bool) {
	if len(d.Cards) == 0 {
		return Card{}, false
	}
	last := len(d.Cards) - 1
	card := d.Cards[last]
	d.Cards = d.Cards[:last]
	return card, true
}

func (d *Deck) Remaining() int {
	return len(d.Cards)
}
