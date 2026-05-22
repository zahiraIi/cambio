"""Parity tests aligned with Go stack tests."""

import unittest

from game_sim import (
    Ability,
    CambioSim,
    Phase,
    Rank,
    Suit,
    Card,
    POLICY_ACT_PEEK_OWN_BASE,
    POLICY_ACT_SNAP_BASE,
    POLICY_ACT_STACK_GIVE_BASE,
    POLICY_ACT_STACK_OPP_BASE,
    POLICY_ACT_DRAW_DECK,
)


def card(rank, suit=Suit.HEARTS):
    return Card(rank=rank, suit=suit)


class StackParityTests(unittest.TestCase):
    def test_stack_window_survives_advance_turn(self):
        sim = CambioSim(num_players=3)
        sim.phase = Phase.TURNS
        sim.current_turn = 0
        sim._open_stack_window(Rank.SEVEN)
        sim._advance_turn()
        self.assertEqual(sim.open_stack_rank, Rank.SEVEN)
        self.assertFalse(sim.stack_rank_claimed)

    def test_snap_claims_stack_window(self):
        sim = CambioSim(num_players=2)
        sim.phase = Phase.TURNS
        sim.current_turn = 0
        sim._open_stack_window(Rank.SEVEN)
        sim.players[1].hand[0] = card(Rank.SEVEN)
        sim.step(1, POLICY_ACT_SNAP_BASE)
        self.assertTrue(sim.stack_rank_claimed)
        self.assertIsNone(sim.players[1].hand[0])

    def test_stack_opponent_requires_give_card(self):
        sim = CambioSim(num_players=2)
        sim.phase = Phase.TURNS
        sim.current_turn = 0
        sim._open_stack_window(Rank.SEVEN)
        sim.players[0].hand[0] = card(Rank.KING, Suit.SPADES)
        sim.players[1].hand[2] = card(Rank.SEVEN, Suit.CLUBS)
        sim._record_peek(0, 1, 2, Rank.SEVEN)
        sim.step(0, POLICY_ACT_STACK_OPP_BASE + 0 * 4 + 2)
        self.assertEqual(sim.pending_stack_give_actor, 0)
        self.assertIsNone(sim.players[1].hand[2])
        sim.step(0, POLICY_ACT_STACK_GIVE_BASE)
        self.assertEqual(sim.pending_stack_give_actor, -1)
        self.assertIsNone(sim.players[0].hand[0])
        self.assertEqual(sim.players[1].hand[2].rank, Rank.KING)

    def test_ability_beats_snap_in_next_actor(self):
        sim = CambioSim(num_players=2)
        sim.phase = Phase.TURNS
        sim.current_turn = 0
        sim.pending_ability = Ability.PEEK_OPPONENT
        sim._open_stack_window(Rank.SEVEN)
        sim.players[1].hand[0] = card(Rank.SEVEN)
        self.assertEqual(sim.next_actor(), 0)


if __name__ == "__main__":
    unittest.main()
