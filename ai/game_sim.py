"""Pure-Python Cambio game simulator for self-play training.

Mirrors the Go engine rules exactly so the AI trains on the real game.
"""

import random
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Optional


class Suit(IntEnum):
    HEARTS = 0
    DIAMONDS = 1
    CLUBS = 2
    SPADES = 3
    JOKER_SUIT = 4


class Rank(IntEnum):
    ACE = 1
    TWO = 2
    THREE = 3
    FOUR = 4
    FIVE = 5
    SIX = 6
    SEVEN = 7
    EIGHT = 8
    NINE = 9
    TEN = 10
    JACK = 11
    QUEEN = 12
    KING = 13
    JOKER = 14


class Ability(IntEnum):
    NONE = 0
    PEEK_OPPONENT = 1  # 7, 8
    PEEK_OWN = 2       # 9, 10
    BLIND_SWITCH = 3   # J, Q
    LOOK_SWITCH = 4    # Black King


@dataclass
class Card:
    rank: Rank
    suit: Suit

    def points(self) -> int:
        if self.rank == Rank.JOKER:
            return 0
        if self.rank == Rank.KING and self.is_red():
            return -1
        if self.rank in (Rank.JACK, Rank.QUEEN, Rank.KING):
            return 10
        return int(self.rank)

    def is_red(self) -> bool:
        return self.suit in (Suit.HEARTS, Suit.DIAMONDS)

    def ability(self) -> Ability:
        if self.rank in (Rank.SEVEN, Rank.EIGHT):
            return Ability.PEEK_OPPONENT
        if self.rank in (Rank.NINE, Rank.TEN):
            return Ability.PEEK_OWN
        if self.rank in (Rank.JACK, Rank.QUEEN):
            return Ability.BLIND_SWITCH
        if self.rank == Rank.KING and not self.is_red():
            return Ability.LOOK_SWITCH
        return Ability.NONE


HAND_SIZE = 4

# Action space for the AI (discrete)
# 0: draw from deck
# 1: draw from discard
# 2-5: swap drawn card with hand slot 0-3
# 6: discard drawn card
# 7-10: peek own slot 0-3 (ability)
# 11-14: peek opponent slot 0-3 (ability, uses first non-self opponent)
# 15-18: blind switch my slot 0-3 with opponent (picks opponent slot greedily)
# 19: call cambio
# 20: decline switch (Black King)
NUM_ACTIONS = 21


@dataclass
class PlayerState:
    hand: list = field(default_factory=list)
    known: list = field(default_factory=lambda: [False] * HAND_SIZE)
    called_cambio: bool = False

    def score(self) -> int:
        return sum(c.points() for c in self.hand if c is not None)


class Phase(IntEnum):
    INIT_PEEK = 0
    TURNS = 1
    FINAL_ROUND = 2
    DONE = 3


class CambioSim:
    """Lightweight Cambio simulator for training."""

    def __init__(self, num_players=2):
        self.num_players = num_players
        self.players: list[PlayerState] = []
        self.deck: list[Card] = []
        self.discard: list[Card] = []
        self.phase = Phase.INIT_PEEK
        self.current_turn = 0
        self.drawn_card: Optional[Card] = None
        self.pending_ability = Ability.NONE
        self.cambio_caller = -1
        self.turns_after_cambio = 0
        self.init_peeks_left: list[int] = []
        self.reset()

    def reset(self):
        self.deck = []
        for suit in [Suit.HEARTS, Suit.DIAMONDS, Suit.CLUBS, Suit.SPADES]:
            for rank_val in range(1, 14):
                self.deck.append(Card(Rank(rank_val), suit))
        self.deck.append(Card(Rank.JOKER, Suit.JOKER_SUIT))
        self.deck.append(Card(Rank.JOKER, Suit.JOKER_SUIT))
        random.shuffle(self.deck)

        self.players = [PlayerState() for _ in range(self.num_players)]
        for p in self.players:
            p.hand = [self.deck.pop() for _ in range(HAND_SIZE)]
            p.known = [False] * HAND_SIZE

        self.discard = [self.deck.pop()]
        self.phase = Phase.INIT_PEEK
        self.current_turn = 0
        self.drawn_card = None
        self.pending_ability = Ability.NONE
        self.cambio_caller = -1
        self.turns_after_cambio = 0
        self.init_peeks_left = [2] * self.num_players

    def observe(self, player_idx: int):
        """Build observation vector for a player. Returns numpy-compatible list."""
        p = self.players[player_idx]
        obs = []

        # Own hand: for each slot, [known, points_if_known, has_card]
        for i in range(HAND_SIZE):
            card = p.hand[i]
            has_card = 1.0 if card is not None else 0.0
            known = 1.0 if p.known[i] and card is not None else 0.0
            pts = card.points() / 13.0 if (p.known[i] and card is not None) else 0.0
            obs.extend([has_card, known, pts])

        # Known score estimate (known cards + average estimate for unknown)
        known_total = sum(p.hand[i].points() for i in range(HAND_SIZE)
                         if p.known[i] and p.hand[i] is not None)
        known_count = sum(1 for i in range(HAND_SIZE) if p.known[i] and p.hand[i] is not None)
        unknown_count = sum(1 for i in range(HAND_SIZE) if not p.known[i] and p.hand[i] is not None)
        estimated_score = known_total + unknown_count * 5.5  # average card ~5.5
        obs.append(estimated_score / 40.0)

        # Discard top card info
        if self.discard:
            top = self.discard[-1]
            obs.append(top.points() / 13.0)
            obs.append(float(top.ability()) / 4.0)
        else:
            obs.extend([0.0, 0.0])

        # Drawn card info
        if self.drawn_card is not None:
            obs.append(1.0)
            obs.append(self.drawn_card.points() / 13.0)
        else:
            obs.extend([0.0, 0.0])

        # Game phase
        obs.append(float(self.phase) / 3.0)
        obs.append(1.0 if self.current_turn == player_idx else 0.0)
        obs.append(float(self.pending_ability) / 4.0)
        obs.append(1.0 if self.cambio_caller >= 0 else 0.0)

        # Opponent card counts
        for i in range(self.num_players):
            if i != player_idx:
                opp = self.players[i]
                card_count = sum(1 for c in opp.hand if c is not None)
                obs.append(card_count / 4.0)

        # Deck remaining (normalized)
        obs.append(len(self.deck) / 54.0)

        # Pad to fixed size
        while len(obs) < 32:
            obs.append(0.0)

        return obs[:32]

    def valid_actions(self, player_idx: int) -> list[int]:
        """Return list of valid action indices."""
        valid = []
        p = self.players[player_idx]

        if self.phase == Phase.INIT_PEEK:
            if self.init_peeks_left[player_idx] > 0:
                for i in range(HAND_SIZE):
                    if p.hand[i] is not None and not p.known[i]:
                        valid.append(7 + i)  # peek own
            return valid if valid else [7]

        if self.phase == Phase.DONE:
            return []

        if self.current_turn != player_idx:
            return []

        if self.pending_ability == Ability.PEEK_OWN:
            for i in range(HAND_SIZE):
                if p.hand[i] is not None:
                    valid.append(7 + i)
            return valid

        if self.pending_ability == Ability.PEEK_OPPONENT:
            for i in range(HAND_SIZE):
                valid.append(11 + i)
            return valid

        if self.pending_ability == Ability.BLIND_SWITCH:
            for i in range(HAND_SIZE):
                if p.hand[i] is not None:
                    valid.append(15 + i)
            return valid

        if self.pending_ability == Ability.LOOK_SWITCH:
            for i in range(HAND_SIZE):
                if p.hand[i] is not None:
                    valid.append(15 + i)
            valid.append(20)  # decline
            return valid

        if self.drawn_card is not None:
            for i in range(HAND_SIZE):
                if p.hand[i] is not None:
                    valid.append(2 + i)  # swap
            valid.append(6)  # discard
            return valid

        # No drawn card yet
        valid.append(0)  # draw deck
        if self.discard:
            valid.append(1)  # draw discard
        if self.phase == Phase.TURNS:
            valid.append(19)  # call cambio
        return valid

    def step(self, player_idx: int, action: int) -> float:
        """Execute an action. Returns immediate reward."""
        p = self.players[player_idx]

        # Init peek phase
        if self.phase == Phase.INIT_PEEK:
            slot = action - 7
            if 0 <= slot < HAND_SIZE and p.hand[slot] is not None:
                p.known[slot] = True
                self.init_peeks_left[player_idx] -= 1

            if all(left <= 0 for left in self.init_peeks_left):
                self.phase = Phase.TURNS
                self.current_turn = 0
            return 0.0

        # Draw from deck
        if action == 0:
            if self.deck:
                self.drawn_card = self.deck.pop()
            elif len(self.discard) > 1:
                top = self.discard.pop()
                self.deck = self.discard
                random.shuffle(self.deck)
                self.discard = [top]
                self.drawn_card = self.deck.pop()
            return 0.0

        # Draw from discard
        if action == 1:
            if self.discard:
                self.drawn_card = self.discard.pop()
            return 0.0

        # Swap drawn card with hand slot
        if 2 <= action <= 5:
            slot = action - 2
            if self.drawn_card and p.hand[slot] is not None:
                old = p.hand[slot]
                p.hand[slot] = self.drawn_card
                p.known[slot] = True
                self.discard.append(old)
                reward = (old.points() - self.drawn_card.points()) / 13.0
                self.drawn_card = None
                self.pending_ability = Ability.NONE
                self._advance_turn()
                return reward
            return 0.0

        # Discard drawn card
        if action == 6:
            if self.drawn_card:
                ability = self.drawn_card.ability()
                self.discard.append(self.drawn_card)
                self.drawn_card = None
                if ability != Ability.NONE:
                    self.pending_ability = ability
                else:
                    self._advance_turn()
            return 0.0

        # Peek own (ability from 9/10)
        if 7 <= action <= 10:
            slot = action - 7
            if p.hand[slot] is not None:
                p.known[slot] = True
            self.pending_ability = Ability.NONE
            self._advance_turn()
            return 0.1  # small reward for information

        # Peek opponent (ability from 7/8)
        if 11 <= action <= 14:
            self.pending_ability = Ability.NONE
            self._advance_turn()
            return 0.1

        # Blind switch / look-and-switch (J/Q or Black King)
        if 15 <= action <= 18:
            slot = action - 15
            opp_idx = (player_idx + 1) % self.num_players
            opp = self.players[opp_idx]
            opp_slot = random.randint(0, HAND_SIZE - 1)
            while opp.hand[opp_slot] is None and any(c is not None for c in opp.hand):
                opp_slot = random.randint(0, HAND_SIZE - 1)

            if p.hand[slot] is not None and opp.hand[opp_slot] is not None:
                my_pts_before = p.hand[slot].points()
                their_pts = opp.hand[opp_slot].points()
                p.hand[slot], opp.hand[opp_slot] = opp.hand[opp_slot], p.hand[slot]
                p.known[slot] = False
                opp.known[opp_slot] = False
                reward = (my_pts_before - their_pts) / 13.0

                self.pending_ability = Ability.NONE
                self._advance_turn()
                return reward
            self.pending_ability = Ability.NONE
            self._advance_turn()
            return 0.0

        # Call cambio
        if action == 19:
            p.called_cambio = True
            self.cambio_caller = player_idx
            self.phase = Phase.FINAL_ROUND
            self.turns_after_cambio = 0
            self._advance_turn()
            return 0.0

        # Decline switch (Black King)
        if action == 20:
            self.pending_ability = Ability.BLIND_SWITCH
            return -0.05  # small penalty for declining

        return 0.0

    def _advance_turn(self):
        self.current_turn = (self.current_turn + 1) % self.num_players

        if self.phase == Phase.FINAL_ROUND:
            if self.current_turn == self.cambio_caller:
                self.current_turn = (self.current_turn + 1) % self.num_players
            self.turns_after_cambio += 1
            if self.turns_after_cambio >= self.num_players - 1:
                self.phase = Phase.DONE

    def is_done(self) -> bool:
        return self.phase == Phase.DONE

    def final_rewards(self) -> list[float]:
        """Compute final reward for each player. Lower score = higher reward."""
        scores = [p.score() for p in self.players]
        min_score = min(scores)
        rewards = []
        for i, s in enumerate(scores):
            if s == min_score:
                reward = 1.0
            else:
                reward = -s / 40.0
            # Penalty if you called cambio but didn't win
            if self.cambio_caller == i and s != min_score:
                reward -= 0.5
            rewards.append(reward)
        return rewards
