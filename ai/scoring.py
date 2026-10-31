"""Game outcome scoring shared by training and evaluation."""


def outcome_score(agent_score, other_scores):
    """Lower Cambio score wins. Return 1.0 for a win, 0.5 for a tie for lowest, 0.0 otherwise."""
    best_other = min(other_scores)
    if agent_score < best_other:
        return 1.0
    if agent_score == best_other:
        return 0.5
    return 0.0
