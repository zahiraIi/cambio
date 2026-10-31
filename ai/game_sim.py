"""Pure-Python Cambio game simulator for self-play training.

Mirrors the Go engine rules including stack/snap and peek memory.
"""

import random
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Optional

from policy_spec import (
    HAND_SIZE,
    MAX_OPPONENTS,
    NUM_ACTIONS,
    OBS_SIZE,
    POLICY_ACT_CALL_CAMBIO,
    POLICY_ACT_DECLINE_SW,
    POLICY_ACT_DISCARD,
    POLICY_ACT_DRAW_DECK,
    POLICY_ACT_DRAW_DISCARD,
    POLICY_ACT_PEEK_OPP_BASE,
    POLICY_ACT_PEEK_OWN_BASE,
    POLICY_ACT_SNAP_BASE,
    POLICY_ACT_STACK_GIVE_BASE,
    POLICY_ACT_STACK_OPP_BASE,
    POLICY_ACT_SWAP_BASE,
    POLICY_ACT_SWITCH_BASE,
    STACK_MEMORY_MIN,
)


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
    PEEK_OPPONENT = 1
    PEEK_OWN = 2
    BLIND_SWITCH = 3
    LOOK_SWITCH = 4


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


@dataclass
class MemoryEntry:
    rank: Rank
    strength: float


@dataclass
class PlayerState:
    hand: list = field(default_factory=list)
    known: list = field(default_factory=lambda: [False] * HAND_SIZE)
    called_cambio: bool = False
    memory_decay: float = 0.85
    init_peek_mask: int = 0

    def score(self) -> int:
        return sum(c.points() for c in self.hand if c is not None)


class Phase(IntEnum):
    INIT_PEEK = 0
    TURNS = 1
    FINAL_ROUND = 2
    DONE = 3


INIT_PEEK_SLOT_MIN = 0
INIT_PEEK_SLOT_MAX = 1


class CambioSim:
    """Cambio simulator for training — mirrors Go engine stack/peek rules."""

    def __init__(self, num_players=4):
        self.num_players = num_players
        self.players: list[PlayerState] = []
        self.deck: list[Card] = []
        self.discard: list[Card] = []
        self.phase = Phase.INIT_PEEK
        self.current_turn = 0
        self.drawn_card: Optional[Card] = None
        self.pending_ability = Ability.NONE
        self.peek_opponent_remaining = 0
        self.cambio_caller = -1
        self.turns_after_cambio = 0
        self.skip_final_round_count = False
        self.peek_knowledge: dict[int, dict[str, MemoryEntry]] = {}
        self.open_stack_rank: Optional[Rank] = None
        self.stack_rank_claimed = False
        self.pending_stack_give_actor = -1
        self.pending_stack_give_target = -1
        self.pending_stack_give_target_slot = -1
        self.look_switch_my_slot = -1
        self.look_switch_target = -1
        self.look_switch_target_slot = -1
        self.look_switch_peek_done = False
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
            p.called_cambio = False
            p.init_peek_mask = 0

        self.discard = [self.deck.pop()]
        self.phase = Phase.INIT_PEEK
        self.current_turn = 0
        self.drawn_card = None
        self.pending_ability = Ability.NONE
        self.peek_opponent_remaining = 0
        self.cambio_caller = -1
        self.turns_after_cambio = 0
        self.skip_final_round_count = False
        self.peek_knowledge = {i: {} for i in range(self.num_players)}
        self.open_stack_rank = None
        self.stack_rank_claimed = False
        self.pending_stack_give_actor = -1
        self.pending_stack_give_target = -1
        self.pending_stack_give_target_slot = -1
        self.look_switch_my_slot = -1
        self.look_switch_target = -1
        self.look_switch_target_slot = -1
        self.look_switch_peek_done = False

    def _mem_key(self, target_idx: int, slot: int) -> str:
        return f"{target_idx}:{slot}"

    def _record_peek(self, viewer_idx: int, target_idx: int, slot: int, rank: Rank):
        mem = self.peek_knowledge.setdefault(viewer_idx, {})
        key = self._mem_key(target_idx, slot)
        prev = mem.get(key)
        strength = 1.0
        if prev and prev.strength > strength:
            strength = prev.strength
        mem[key] = MemoryEntry(rank=rank, strength=strength)

    def _get_peek(self, viewer_idx: int, target_idx: int, slot: int):
        mem = self.peek_knowledge.get(viewer_idx, {})
        entry = mem.get(self._mem_key(target_idx, slot))
        if not entry or entry.strength < 0.12:
            return None, 0.0, False
        return entry.rank, entry.strength, True

    def _invalidate_slot(self, target_idx: int, slot: int):
        key = self._mem_key(target_idx, slot)
        for mem in self.peek_knowledge.values():
            mem.pop(key, None)

    def _decay_memories(self):
        for viewer_idx, mem in self.peek_knowledge.items():
            decay = self.players[viewer_idx].memory_decay
            dead = []
            for key, entry in mem.items():
                entry.strength *= decay
                if entry.strength < 0.12:
                    dead.append(key)
            for key in dead:
                del mem[key]

    def _open_stack_window(self, rank: Rank):
        self.open_stack_rank = rank
        self.stack_rank_claimed = False

    def _opponent_indices(self, player_idx: int) -> list[int]:
        return [i for i in range(self.num_players) if i != player_idx]

    def _opp_rel_idx(self, player_idx: int, target_idx: int) -> int:
        opps = self._opponent_indices(player_idx)
        return opps.index(target_idx)

    def _draw_from_deck(self) -> Optional[Card]:
        if self.deck:
            return self.deck.pop()
        if len(self.discard) > 1:
            top = self.discard.pop()
            self.deck = self.discard[:]
            random.shuffle(self.deck)
            self.discard = [top]
            return self.deck.pop() if self.deck else None
        return None

    def _apply_penalty(self, player_idx: int):
        card = self._draw_from_deck()
        if card is None:
            return
        p = self.players[player_idx]
        for i in range(HAND_SIZE):
            if p.hand[i] is None:
                p.hand[i] = card
                p.known[i] = False
                return

    def observe(self, player_idx: int) -> list[float]:
        p = self.players[player_idx]
        obs: list[float] = []

        for i in range(HAND_SIZE):
            card = p.hand[i]
            has_card = 1.0 if card is not None else 0.0
            known = 1.0 if p.known[i] and card is not None else 0.0
            pts = card.points() / 13.0 if (p.known[i] and card is not None) else 0.0
            obs.extend([has_card, known, pts])

        unknown_count = sum(
            1 for i in range(HAND_SIZE) if not p.known[i] and p.hand[i] is not None
        )
        known_total = sum(
            p.hand[i].points()
            for i in range(HAND_SIZE)
            if p.known[i] and p.hand[i] is not None
        )
        obs.append((known_total + unknown_count * 5.5) / 40.0)

        if self.discard:
            top = self.discard[-1]
            obs.append(top.points() / 13.0)
            obs.append(float(top.ability()) / 4.0)
        else:
            obs.extend([0.0, 0.0])

        if self.drawn_card is not None:
            obs.extend([1.0, self.drawn_card.points() / 13.0])
        else:
            obs.extend([0.0, 0.0])

        obs.append(float(self.phase) / 3.0)
        obs.append(1.0 if self.current_turn == player_idx else 0.0)
        obs.append(float(self.pending_ability) / 4.0)
        obs.append(1.0 if self.cambio_caller >= 0 else 0.0)

        obs.append(
            float(self.open_stack_rank) / 13.0 if self.open_stack_rank else 0.0
        )
        obs.append(1.0 if self.stack_rank_claimed else 0.0)
        obs.append(1.0 if self.open_stack_rank and not self.stack_rank_claimed else 0.0)

        opps = self._opponent_indices(player_idx)
        for rel in range(MAX_OPPONENTS):
            if rel < len(opps):
                opp_idx = opps[rel]
                for slot in range(HAND_SIZE):
                    rank, strength, ok = self._get_peek(player_idx, opp_idx, slot)
                    obs.append(
                        (float(rank) / 13.0) * strength if ok else 0.0
                    )
            else:
                obs.extend([0.0] * HAND_SIZE)

        for rel in range(MAX_OPPONENTS):
            if rel < len(opps):
                opp = self.players[opps[rel]]
                count = sum(1 for c in opp.hand if c is not None)
                obs.append(count / 4.0)
            else:
                obs.append(0.0)

        obs.append(len(self.deck) / 54.0)

        while len(obs) < OBS_SIZE:
            obs.append(0.0)
        return obs[:OBS_SIZE]

    def next_actor(self) -> int:
        """Return player index that should act next, or -1."""
        if self.phase == Phase.DONE:
            return -1

        if self.phase == Phase.INIT_PEEK:
            for i, p in enumerate(self.players):
                if p.init_peek_mask != 0b11:
                    return i
            return -1

        if self.pending_stack_give_actor >= 0:
            return self.pending_stack_give_actor

        if self.pending_ability != Ability.NONE:
            return self.current_turn

        if (
            not self.stack_rank_claimed
            and self.open_stack_rank
            and self.phase in (Phase.TURNS, Phase.FINAL_ROUND)
        ):
            for i, p in enumerate(self.players):
                for s in range(HAND_SIZE):
                    c = p.hand[s]
                    if c is not None and c.rank == self.open_stack_rank:
                        return i

        if self.phase in (Phase.TURNS, Phase.FINAL_ROUND):
            return self.current_turn

        return -1

    def valid_actions(self, player_idx: int) -> list[int]:
        if player_idx < 0:
            return []

        p = self.players[player_idx]

        if self.phase == Phase.INIT_PEEK:
            valid = []
            for s in range(INIT_PEEK_SLOT_MIN, INIT_PEEK_SLOT_MAX + 1):
                bit = 1 << s
                if (p.init_peek_mask & bit) == 0 and p.hand[s] is not None:
                    valid.append(POLICY_ACT_PEEK_OWN_BASE + s)
            return valid

        if self.phase == Phase.DONE:
            return []

        if self.pending_stack_give_actor == player_idx:
            return [
                POLICY_ACT_STACK_GIVE_BASE + s
                for s in range(HAND_SIZE)
                if p.hand[s] is not None
            ]

        if self.pending_ability != Ability.NONE:
            if self.current_turn != player_idx:
                return []
            if self.pending_ability == Ability.PEEK_OWN:
                return [
                    POLICY_ACT_PEEK_OWN_BASE + s
                    for s in range(HAND_SIZE)
                    if p.hand[s] is not None
                ]
            if self.pending_ability == Ability.PEEK_OPPONENT:
                return list(range(POLICY_ACT_PEEK_OPP_BASE, POLICY_ACT_PEEK_OPP_BASE + HAND_SIZE))
            if self.pending_ability == Ability.BLIND_SWITCH:
                return [
                    POLICY_ACT_SWITCH_BASE + s
                    for s in range(HAND_SIZE)
                    if p.hand[s] is not None
                ]
            if self.pending_ability == Ability.LOOK_SWITCH:
                if self.look_switch_my_slot < 0:
                    return [
                        POLICY_ACT_SWITCH_BASE + s
                        for s in range(HAND_SIZE)
                        if p.hand[s] is not None
                    ]
                if not self.look_switch_peek_done:
                    return list(range(POLICY_ACT_PEEK_OPP_BASE, POLICY_ACT_PEEK_OPP_BASE + HAND_SIZE))
                return [POLICY_ACT_DECLINE_SW, POLICY_ACT_SWITCH_BASE + self.look_switch_my_slot]

        if (
            not self.stack_rank_claimed
            and self.open_stack_rank
            and self.phase in (Phase.TURNS, Phase.FINAL_ROUND)
        ):
            snap_valid = []
            for s in range(HAND_SIZE):
                c = p.hand[s]
                if c is not None and c.rank == self.open_stack_rank:
                    if player_idx == self.current_turn and self.drawn_card is not None:
                        continue
                    snap_valid.append(POLICY_ACT_SNAP_BASE + s)
            if snap_valid:
                return snap_valid

        if self.current_turn != player_idx:
            return []

        if self.drawn_card is not None:
            valid = [POLICY_ACT_DISCARD]
            for s in range(HAND_SIZE):
                if p.hand[s] is not None:
                    valid.append(POLICY_ACT_SWAP_BASE + s)
            return valid

        valid = [POLICY_ACT_DRAW_DECK]
        if self.discard:
            valid.append(POLICY_ACT_DRAW_DISCARD)
        if self.phase == Phase.TURNS:
            valid.append(POLICY_ACT_CALL_CAMBIO)

        if (
            not self.stack_rank_claimed
            and self.open_stack_rank
        ):
            opps = self._opponent_indices(player_idx)
            for rel, opp_idx in enumerate(opps[:MAX_OPPONENTS]):
                for slot in range(HAND_SIZE):
                    if self.players[opp_idx].hand[slot] is None:
                        continue
                    rank, strength, ok = self._get_peek(player_idx, opp_idx, slot)
                    if (
                        ok
                        and strength >= STACK_MEMORY_MIN
                        and rank == self.open_stack_rank
                    ):
                        valid.append(POLICY_ACT_STACK_OPP_BASE + rel * HAND_SIZE + slot)

        return valid

    def step(self, player_idx: int, action: int) -> float:
        p = self.players[player_idx]

        if self.phase == Phase.INIT_PEEK:
            slot = action - POLICY_ACT_PEEK_OWN_BASE
            if INIT_PEEK_SLOT_MIN <= slot <= INIT_PEEK_SLOT_MAX and p.hand[slot] is not None:
                p.known[slot] = True
                p.init_peek_mask |= 1 << slot
                self._record_peek(player_idx, player_idx, slot, p.hand[slot].rank)
            if all(pl.init_peek_mask == 0b11 for pl in self.players):
                self.phase = Phase.TURNS
                self.current_turn = 0
            return 0.0

        if POLICY_ACT_STACK_GIVE_BASE <= action < POLICY_ACT_STACK_GIVE_BASE + HAND_SIZE:
            slot = action - POLICY_ACT_STACK_GIVE_BASE
            return self._do_stack_give(player_idx, slot)

        if POLICY_ACT_SNAP_BASE <= action < POLICY_ACT_SNAP_BASE + HAND_SIZE:
            return self._do_snap(player_idx, action - POLICY_ACT_SNAP_BASE)

        if POLICY_ACT_STACK_OPP_BASE <= action < POLICY_ACT_STACK_GIVE_BASE:
            rel = (action - POLICY_ACT_STACK_OPP_BASE) // HAND_SIZE
            slot = (action - POLICY_ACT_STACK_OPP_BASE) % HAND_SIZE
            opps = self._opponent_indices(player_idx)
            if rel >= len(opps):
                return 0.0
            return self._do_stack_opponent(player_idx, opps[rel], slot)

        if self.current_turn != player_idx and self.pending_stack_give_actor != player_idx:
            return 0.0

        if action == POLICY_ACT_DRAW_DECK:
            self.drawn_card = self._draw_from_deck()
            return 0.0

        if action == POLICY_ACT_DRAW_DISCARD:
            if self.discard:
                self.drawn_card = self.discard.pop()
            return 0.0

        if POLICY_ACT_SWAP_BASE <= action < POLICY_ACT_SWAP_BASE + HAND_SIZE:
            slot = action - POLICY_ACT_SWAP_BASE
            if self.drawn_card and p.hand[slot] is not None:
                old = p.hand[slot]
                p.hand[slot] = self.drawn_card
                p.known[slot] = True
                self.discard.append(old)
                reward = (old.points() - self.drawn_card.points()) / 13.0
                self.drawn_card = None
                self.pending_ability = Ability.NONE
                self._open_stack_window(old.rank)
                self._advance_turn()
                return reward
            return 0.0

        if action == POLICY_ACT_DISCARD:
            if self.drawn_card:
                ability = self.drawn_card.ability()
                discarded = self.drawn_card
                self.discard.append(discarded)
                self.drawn_card = None
                self._open_stack_window(discarded.rank)
                if ability == Ability.PEEK_OPPONENT:
                    self.pending_ability = ability
                    self.peek_opponent_remaining = 1
                elif ability != Ability.NONE:
                    self.pending_ability = ability
                    if ability == Ability.LOOK_SWITCH:
                        self.look_switch_my_slot = -1
                        self.look_switch_target = -1
                        self.look_switch_target_slot = -1
                        self.look_switch_peek_done = False
                else:
                    self._advance_turn()
            return 0.0

        if POLICY_ACT_PEEK_OWN_BASE <= action < POLICY_ACT_PEEK_OWN_BASE + HAND_SIZE:
            slot = action - POLICY_ACT_PEEK_OWN_BASE
            if p.hand[slot] is not None:
                p.known[slot] = True
                self._record_peek(player_idx, player_idx, slot, p.hand[slot].rank)
            self.pending_ability = Ability.NONE
            self._advance_turn()
            return 0.1

        if POLICY_ACT_PEEK_OPP_BASE <= action < POLICY_ACT_PEEK_OPP_BASE + HAND_SIZE:
            if self.pending_ability == Ability.LOOK_SWITCH and self.look_switch_my_slot >= 0:
                target_slot = action - POLICY_ACT_PEEK_OPP_BASE
                opps = self._opponent_indices(player_idx)
                target_idx = opps[0] if opps else None
                if target_idx is not None and self.players[target_idx].hand[target_slot] is not None:
                    card = self.players[target_idx].hand[target_slot]
                    self._record_peek(player_idx, target_idx, target_slot, card.rank)
                    self.look_switch_target = target_idx
                    self.look_switch_target_slot = target_slot
                    self.look_switch_peek_done = True
                return 0.1
            target_slot = action - POLICY_ACT_PEEK_OPP_BASE
            opps = self._opponent_indices(player_idx)
            target_idx = opps[0] if opps else None
            if target_idx is not None and self.players[target_idx].hand[target_slot] is not None:
                card = self.players[target_idx].hand[target_slot]
                self._record_peek(player_idx, target_idx, target_slot, card.rank)
            self.peek_opponent_remaining -= 1
            if self.peek_opponent_remaining > 0:
                return 0.1
            self.pending_ability = Ability.NONE
            self.peek_opponent_remaining = 0
            self._advance_turn()
            return 0.1

        if POLICY_ACT_SWITCH_BASE <= action < POLICY_ACT_SWITCH_BASE + HAND_SIZE:
            slot = action - POLICY_ACT_SWITCH_BASE
            if self.pending_ability == Ability.LOOK_SWITCH:
                if self.look_switch_my_slot < 0:
                    if p.hand[slot] is not None:
                        p.known[slot] = True
                        self._record_peek(player_idx, player_idx, slot, p.hand[slot].rank)
                        self.look_switch_my_slot = slot
                    return 0.1
                if self.look_switch_peek_done:
                    target = self.players[self.look_switch_target]
                    ts = self.look_switch_target_slot
                    if (
                        slot == self.look_switch_my_slot
                        and p.hand[slot] is not None
                        and target.hand[ts] is not None
                    ):
                        my_pts = p.hand[slot].points()
                        their_pts = target.hand[ts].points()
                        p.hand[slot], target.hand[ts] = target.hand[ts], p.hand[slot]
                        p.known[slot] = True
                        target.known[ts] = False
                        self.pending_ability = Ability.NONE
                        self.look_switch_my_slot = -1
                        self.look_switch_peek_done = False
                        self._advance_turn()
                        return (my_pts - their_pts) / 13.0
                return 0.0
            opps = self._opponent_indices(player_idx)
            if not opps:
                return 0.0
            target_idx = random.choice(opps)
            target = self.players[target_idx]
            opp_slots = [i for i in range(HAND_SIZE) if target.hand[i] is not None]
            if not opp_slots or p.hand[slot] is None:
                self.pending_ability = Ability.NONE
                self._advance_turn()
                return 0.0
            opp_slot = random.choice(opp_slots)
            my_pts = p.hand[slot].points()
            their_pts = target.hand[opp_slot].points()
            sent_rank = p.hand[slot].rank
            self._invalidate_slot(player_idx, slot)
            self._invalidate_slot(target_idx, opp_slot)
            p.hand[slot], target.hand[opp_slot] = target.hand[opp_slot], p.hand[slot]
            p.known[slot] = False
            target.known[opp_slot] = False
            self._record_peek(player_idx, target_idx, opp_slot, sent_rank)
            self.pending_ability = Ability.NONE
            self._advance_turn()
            return (my_pts - their_pts) / 13.0

        if action == POLICY_ACT_CALL_CAMBIO:
            p.called_cambio = True
            self.cambio_caller = player_idx
            self.phase = Phase.FINAL_ROUND
            self.turns_after_cambio = 0
            self.skip_final_round_count = True
            self._advance_turn()
            return 0.0

        if action == POLICY_ACT_DECLINE_SW:
            if self.pending_ability == Ability.LOOK_SWITCH:
                if not self.look_switch_peek_done:
                    return -0.05
                self.pending_ability = Ability.NONE
                self.look_switch_my_slot = -1
                self.look_switch_peek_done = False
                self._advance_turn()
                return 0.0
            self.pending_ability = Ability.BLIND_SWITCH
            return -0.05

        return 0.0

    def _do_snap(self, player_idx: int, slot: int) -> float:
        p = self.players[player_idx]
        if not self.open_stack_rank or self.stack_rank_claimed:
            return -0.1
        card = p.hand[slot]
        if card is None or card.rank != self.open_stack_rank:
            self._apply_penalty(player_idx)
            return -0.5
        self.discard.append(card)
        p.hand[slot] = None
        p.known[slot] = False
        self._invalidate_slot(player_idx, slot)
        self.stack_rank_claimed = True
        return 0.3

    def _do_stack_opponent(self, player_idx: int, target_idx: int, slot: int) -> float:
        if not self.open_stack_rank or self.stack_rank_claimed:
            return -0.1
        target = self.players[target_idx]
        card = target.hand[slot]
        if card is None:
            return 0.0
        rank, strength, ok = self._get_peek(player_idx, target_idx, slot)
        if (
            not ok
            or strength < STACK_MEMORY_MIN
            or rank != card.rank
            or card.rank != self.open_stack_rank
        ):
            self._apply_penalty(player_idx)
            return -0.5
        self.discard.append(card)
        target.hand[slot] = None
        target.known[slot] = False
        self._invalidate_slot(target_idx, slot)
        self.stack_rank_claimed = True
        self.pending_stack_give_actor = player_idx
        self.pending_stack_give_target = target_idx
        self.pending_stack_give_target_slot = slot
        return 0.4

    def _do_stack_give(self, player_idx: int, slot: int) -> float:
        if self.pending_stack_give_actor != player_idx:
            return 0.0
        actor = self.players[player_idx]
        target = self.players[self.pending_stack_give_target]
        ts = self.pending_stack_give_target_slot
        if actor.hand[slot] is None or target.hand[ts] is not None:
            return 0.0
        given = actor.hand[slot]
        self._invalidate_slot(player_idx, slot)
        actor.hand[slot] = None
        actor.known[slot] = False
        target.hand[ts] = given
        target.known[ts] = False
        self._record_peek(player_idx, self.pending_stack_give_target, ts, given.rank)
        self.pending_stack_give_actor = -1
        self.pending_stack_give_target = -1
        self.pending_stack_give_target_slot = -1
        return 0.0

    def _advance_turn(self):
        self._decay_memories()
        self.current_turn = (self.current_turn + 1) % self.num_players

        if self.phase == Phase.FINAL_ROUND:
            if self.skip_final_round_count:
                self.skip_final_round_count = False
            else:
                self.turns_after_cambio += 1
                if self.turns_after_cambio >= self.num_players - 1:
                    self.phase = Phase.DONE

    def is_done(self) -> bool:
        return self.phase == Phase.DONE

    def final_rewards(self) -> list[float]:
        scores = [p.score() for p in self.players]
        min_score = min(scores)
        rewards = []
        for i, s in enumerate(scores):
            if s == min_score:
                reward = 1.0
            else:
                reward = -s / 40.0
            if self.cambio_caller == i and s != min_score:
                reward -= 0.5
            rewards.append(reward)
        return rewards
