"""Self-play training loop for the Cambio AI agent."""

import argparse
import os
import time
import numpy as np
from agent import CambioAgent
from game_sim import CambioSim


class RandomAgent:
    def select_action(self, obs, valid_actions, explore=True):
        return valid_actions[np.random.randint(len(valid_actions))]

    def store_reward(self, reward):
        pass

    def finish_episode(self):
        return 0.0

    def clear(self):
        pass


def play_episode(sim, actor_agents):
    """Play one full game. actor_agents[i] selects actions for player i."""
    sim.reset()
    max_steps = 800
    steps = 0

    while not sim.is_done() and steps < max_steps:
        actor = sim.next_actor()
        if actor < 0:
            break
        valid = sim.valid_actions(actor)
        if not valid:
            break
        agent = actor_agents[actor]
        obs = sim.observe(actor)
        action = agent.select_action(obs, valid)
        reward = sim.step(actor, action)
        agent.store_reward(reward)
        steps += 1

    final = sim.final_rewards()
    for i, fr in enumerate(final):
        actor_agents[i].store_reward(fr)
    return final


def train(
    episodes=10000,
    save_every=1000,
    print_every=100,
    lr=3e-4,
    self_play=False,
    save_path="models/cambio",
    num_players=4,
    curriculum_episodes=5000,
):
    sim = CambioSim(num_players=num_players)
    learner = CambioAgent(lr=lr)
    random_opp = RandomAgent()

    win_history = []
    loss_history = []
    score_history = []
    start_time = time.time()
    learner_seat = 0

    for ep in range(1, episodes + 1):
        learner_seat = ep % num_players
        use_self_play = self_play and ep > curriculum_episodes

        actor_agents = []
        for i in range(num_players):
            if use_self_play:
                actor_agents.append(learner)
            elif i == learner_seat:
                actor_agents.append(learner)
            else:
                actor_agents.append(random_opp)

        final_rewards = play_episode(sim, actor_agents)
        loss = learner.finish_episode()

        agent_score = sim.players[learner_seat].score()
        others = [sim.players[i].score() for i in range(num_players) if i != learner_seat]
        won = agent_score <= min(others)

        win_history.append(1.0 if won else 0.0)
        loss_history.append(loss)
        score_history.append(agent_score)

        if ep % print_every == 0:
            recent_wr = np.mean(win_history[-print_every:])
            recent_loss = np.mean(loss_history[-print_every:])
            recent_score = np.mean(score_history[-print_every:])
            elapsed = time.time() - start_time
            mode = "self-play" if use_self_play else "vs-random"
            print(
                f"Ep {ep:6d} [{mode}] | "
                f"Win rate: {recent_wr:.1%} | "
                f"Avg score: {recent_score:5.1f} | "
                f"Loss: {recent_loss:.4f} | "
                f"{ep / elapsed:.0f} ep/s"
            )

        if ep % save_every == 0:
            learner.save(save_path)
            print(f"  -> Model saved to {save_path}")

    learner.save(save_path)
    total_time = time.time() - start_time
    print(f"\nTraining complete: {episodes} episodes in {total_time:.1f}s")
    print(f"Final win rate: {np.mean(win_history[-500:]):.1%}")
    print(f"Final avg score: {np.mean(score_history[-500:]):.1f}")
    return learner


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Cambio AI agent")
    parser.add_argument("--episodes", type=int, default=10000)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--self-play", action="store_true")
    parser.add_argument("--save-path", default="models/cambio")
    parser.add_argument("--save-every", type=int, default=1000)
    parser.add_argument("--num-players", type=int, default=4)
    parser.add_argument("--curriculum", type=int, default=5000)
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.save_path) or "models", exist_ok=True)

    train(
        episodes=args.episodes,
        lr=args.lr,
        self_play=args.self_play,
        save_path=args.save_path,
        save_every=args.save_every,
        num_players=args.num_players,
        curriculum_episodes=args.curriculum,
    )
