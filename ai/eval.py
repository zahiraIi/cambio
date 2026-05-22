"""Evaluate a trained Cambio agent vs random opponents."""

import argparse
import numpy as np
from agent import CambioAgent
from game_sim import CambioSim
from train import RandomAgent, play_episode


def evaluate(model_path, games=200, num_players=4, seed=42):
    rng = np.random.RandomState(seed)
    agent = CambioAgent()
    agent.load(model_path)
    random_opponents = [RandomAgent() for _ in range(num_players)]
    sim = CambioSim(num_players=num_players)

    wins = 0
    scores = []
    for g in range(games):
        np.random.seed(int(rng.randint(0, 2**31)))
        episode_agents = [agent] + random_opponents[1:]
        play_episode(sim, episode_agents)
        agent_score = sim.players[0].score()
        best_other = min(sim.players[i].score() for i in range(1, num_players))
        if agent_score <= best_other:
            wins += 1
        scores.append(agent_score)

    print(f"Games: {games}")
    print(f"Win rate: {wins / games:.1%}")
    print(f"Avg score: {np.mean(scores):.1f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="models/cambio")
    parser.add_argument("--games", type=int, default=200)
    parser.add_argument("--num-players", type=int, default=4)
    args = parser.parse_args()
    evaluate(args.model, games=args.games, num_players=args.num_players)
