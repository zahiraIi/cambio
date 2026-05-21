"""Self-play training loop for the Cambio AI agent."""

import argparse
import time
import numpy as np
from agent import CambioAgent
from game_sim import CambioSim


class RandomAgent:
    """Baseline opponent that picks random valid actions."""

    def select_action(self, obs, valid_actions, explore=True):
        return valid_actions[np.random.randint(len(valid_actions))]

    def store_reward(self, reward):
        pass

    def finish_episode(self):
        return 0.0

    def clear(self):
        pass


def play_episode(sim, agents, player_indices):
    """Play one full game, returning per-step rewards for each agent."""
    sim.reset()
    step_rewards = [[] for _ in agents]
    max_steps = 500

    # Init peek phase
    for pidx in range(sim.num_players):
        agent = agents[player_indices[pidx]]
        for _ in range(2):
            obs = sim.observe(pidx)
            valid = sim.valid_actions(pidx)
            if not valid:
                break
            action = agent.select_action(obs, valid)
            r = sim.step(pidx, action)
            step_rewards[player_indices[pidx]].append(r)
            agent.store_reward(r)

    # Main turns
    steps = 0
    while not sim.is_done() and steps < max_steps:
        pidx = sim.current_turn
        agent = agents[player_indices[pidx]]
        obs = sim.observe(pidx)
        valid = sim.valid_actions(pidx)

        if not valid:
            break

        action = agent.select_action(obs, valid)
        r = sim.step(pidx, action)
        step_rewards[player_indices[pidx]].append(r)
        agent.store_reward(r)
        steps += 1

    # Add final rewards
    final = sim.final_rewards()
    for pidx, fr in enumerate(final):
        aidx = player_indices[pidx]
        agents[aidx].store_reward(fr)

    return final


def train(
    episodes=10000,
    save_every=1000,
    print_every=100,
    lr=3e-4,
    self_play=False,
    save_path="models/cambio",
):
    agent = CambioAgent(lr=lr)

    if self_play:
        opponent = CambioAgent(lr=lr)
        opponent.policy_net.set_params(agent.policy_net.get_params())
        opponent.value_net.set_params(agent.value_net.get_params())
    else:
        opponent = RandomAgent()

    sim = CambioSim(num_players=2)

    win_history = []
    loss_history = []
    score_history = []

    start_time = time.time()

    for ep in range(1, episodes + 1):
        # Alternate who goes first
        if ep % 2 == 0:
            agents_list = [agent, opponent]
            player_map = {0: 0, 1: 1}
        else:
            agents_list = [opponent, agent]
            player_map = {0: 1, 1: 0}

        final_rewards = play_episode(sim, agents_list, player_map)

        loss = agent.finish_episode()
        if self_play:
            opponent.finish_episode()

        agent_pidx = 0 if player_map[0] == 0 else 1

        agent_score = sim.players[agent_pidx].score()
        opp_score = sim.players[1 - agent_pidx].score()
        won = agent_score <= opp_score

        win_history.append(1.0 if won else 0.0)
        loss_history.append(loss)
        score_history.append(agent_score)

        # Sync opponent in self-play
        if self_play and ep % 50 == 0:
            opponent.policy_net.set_params(agent.policy_net.get_params())
            opponent.value_net.set_params(agent.value_net.get_params())

        if ep % print_every == 0:
            recent_wr = np.mean(win_history[-print_every:])
            recent_loss = np.mean(loss_history[-print_every:])
            recent_score = np.mean(score_history[-print_every:])
            elapsed = time.time() - start_time
            eps_per_sec = ep / elapsed
            print(
                f"Ep {ep:6d} | "
                f"Win rate: {recent_wr:.1%} | "
                f"Avg score: {recent_score:5.1f} | "
                f"Loss: {recent_loss:.4f} | "
                f"{eps_per_sec:.0f} ep/s"
            )

        if ep % save_every == 0:
            agent.save(save_path)
            print(f"  -> Model saved to {save_path}")

    agent.save(save_path)
    total_time = time.time() - start_time
    print(f"\nTraining complete: {episodes} episodes in {total_time:.1f}s")
    print(f"Final win rate: {np.mean(win_history[-500:]):.1%}")
    print(f"Final avg score: {np.mean(score_history[-500:]):.1f}")

    return agent


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Cambio AI agent")
    parser.add_argument("--episodes", type=int, default=10000)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--self-play", action="store_true")
    parser.add_argument("--save-path", default="models/cambio")
    parser.add_argument("--save-every", type=int, default=1000)
    args = parser.parse_args()

    import os
    os.makedirs(os.path.dirname(args.save_path) or "models", exist_ok=True)

    train(
        episodes=args.episodes,
        lr=args.lr,
        self_play=args.self_play,
        save_path=args.save_path,
        save_every=args.save_every,
    )
