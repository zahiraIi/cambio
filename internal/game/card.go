package game

type Suit int

const (
	Hearts Suit = iota
	Diamonds
	Clubs
	Spades
	JokerSuit
)

type Rank int

const (
	Ace Rank = iota + 1
	Two
	Three
	Four
	Five
	Six
	Seven
	Eight
	Nine
	Ten
	Jack
	Queen
	King
	Joker
)

type Card struct {
	Rank Rank
	Suit Suit
}

func (c Card) Points() int {
	switch {
	case c.Rank == Joker:
		return 0
	case c.Rank == King && c.IsRed():
		return -1
	case c.Rank == Jack || c.Rank == Queen || c.Rank == King:
		return 10
	case c.Rank >= Ace && c.Rank <= Ten:
		return int(c.Rank)
	default:
		return 0
	}
}

func (c Card) IsRed() bool {
	return c.Suit == Hearts || c.Suit == Diamonds
}

func (c Card) IsBlack() bool {
	return c.Suit == Clubs || c.Suit == Spades
}

type Ability int

const (
	NoAbility     Ability = iota
	PeekOpponent          // 7 or 8: peek one opponent card
	PeekOwn               // 9 or 10
	BlindSwitch           // Jack or Queen
	LookAndSwitch         // Black King
)

func (c Card) Ability() Ability {
	switch {
	case c.Rank == Seven || c.Rank == Eight:
		return PeekOpponent
	case c.Rank == Nine || c.Rank == Ten:
		return PeekOwn
	case c.Rank == Jack || c.Rank == Queen:
		return BlindSwitch
	case c.Rank == King && c.IsBlack():
		return LookAndSwitch
	default:
		return NoAbility
	}
}

func (c Card) String() string {
	rankNames := map[Rank]string{
		Ace: "A", Two: "2", Three: "3", Four: "4", Five: "5",
		Six: "6", Seven: "7", Eight: "8", Nine: "9", Ten: "10",
		Jack: "J", Queen: "Q", King: "K", Joker: "Joker",
	}
	suitSymbols := map[Suit]string{
		Hearts: "♥", Diamonds: "♦", Clubs: "♣", Spades: "♠", JokerSuit: "",
	}
	if c.Rank == Joker {
		return "🃏"
	}
	return rankNames[c.Rank] + suitSymbols[c.Suit]
}
