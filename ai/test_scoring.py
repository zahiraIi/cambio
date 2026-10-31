"""Outcome scoring: lower Cambio score wins; ties for lowest count as 0.5."""

import unittest

from scoring import outcome_score


class OutcomeScoreTests(unittest.TestCase):
    def test_strict_lowest_is_win(self):
        self.assertEqual(outcome_score(3, [5, 7, 9]), 1.0)

    def test_tie_for_lowest_is_half(self):
        self.assertEqual(outcome_score(5, [5, 7, 9]), 0.5)

    def test_three_way_tie_is_half(self):
        self.assertEqual(outcome_score(5, [5, 5, 9]), 0.5)

    def test_not_lowest_is_loss(self):
        self.assertEqual(outcome_score(6, [5, 7, 9]), 0.0)


if __name__ == "__main__":
    unittest.main()
