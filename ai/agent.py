"""Cambio RL agent using REINFORCE with baseline, trained from scratch."""

import numpy as np
from neural_net import NeuralNet, ActivationFn
from policy_spec import NUM_ACTIONS, OBS_SIZE, HIDDEN_SIZE, VALUE_HIDDEN


class CambioAgent:
    def __init__(self, lr=1e-3, gamma=0.99, entropy_coef=0.01):
        self.policy_net = NeuralNet(
            [OBS_SIZE, HIDDEN_SIZE, HIDDEN_SIZE, NUM_ACTIONS],
            ["relu", "relu", "softmax"],
        )
        self.value_net = NeuralNet(
            [OBS_SIZE, HIDDEN_SIZE, VALUE_HIDDEN, 1],
            ["relu", "relu", "linear"],
        )
        self.lr = lr
        self.gamma = gamma
        self.entropy_coef = entropy_coef

        self.saved_log_probs = []
        self.saved_values = []
        self.saved_rewards = []
        self.saved_entropies = []

    def select_action(self, obs, valid_actions, explore=True):
        obs_arr = np.array(obs, dtype=np.float64)

        probs = self.policy_net.forward(obs_arr)
        value = self.value_net.forward(obs_arr)[0]

        # Mask invalid actions
        mask = np.full(NUM_ACTIONS, -1e9)
        for a in valid_actions:
            mask[a] = 0.0
        masked_logits = np.log(probs + 1e-10) + mask
        masked_probs = ActivationFn.softmax(masked_logits)

        if explore:
            action = np.random.choice(NUM_ACTIONS, p=masked_probs)
        else:
            action = valid_actions[np.argmax([masked_probs[a] for a in valid_actions])]

        log_prob = np.log(masked_probs[action] + 1e-10)
        entropy = -np.sum(masked_probs * np.log(masked_probs + 1e-10))

        self.saved_log_probs.append((log_prob, action, obs_arr, masked_probs))
        self.saved_values.append((value, obs_arr))
        self.saved_entropies.append(entropy)

        return action

    def store_reward(self, reward):
        self.saved_rewards.append(reward)

    def finish_episode(self):
        if not self.saved_rewards:
            self.clear()
            return 0.0

        # Compute discounted returns
        returns = []
        R = 0.0
        for r in reversed(self.saved_rewards):
            R = r + self.gamma * R
            returns.insert(0, R)
        returns = np.array(returns)

        if len(returns) > 1:
            returns = (returns - returns.mean()) / (returns.std() + 1e-8)

        total_loss = 0.0

        # Update policy
        for t, (ret, (log_prob, action, obs, probs)) in enumerate(
            zip(returns, self.saved_log_probs)
        ):
            value = self.saved_values[t][0]
            advantage = ret - value
            entropy = self.saved_entropies[t]

            # Policy gradient
            self.policy_net.zero_grad()
            _ = self.policy_net.forward(obs)
            policy_grad = probs.copy()
            policy_grad[action] -= 1.0
            policy_grad *= -advantage
            policy_grad -= self.entropy_coef * (-np.log(probs + 1e-10) - 1)
            self.policy_net.backward(policy_grad)
            self.policy_net.update(self.lr)

            # Value function update
            self.value_net.zero_grad()
            v_pred = self.value_net.forward(obs)
            v_grad = np.array([2.0 * (v_pred[0] - ret)])
            self.value_net.backward(v_grad)
            self.value_net.update(self.lr * 0.5)

            total_loss += abs(advantage)

        avg_loss = total_loss / len(returns) if returns.size > 0 else 0.0
        self.clear()
        return avg_loss

    def clear(self):
        self.saved_log_probs = []
        self.saved_values = []
        self.saved_rewards = []
        self.saved_entropies = []

    def save(self, path_prefix):
        self.policy_net.save(f"{path_prefix}_policy.json")
        self.value_net.save(f"{path_prefix}_value.json")

    def load(self, path_prefix):
        self.policy_net.load(f"{path_prefix}_policy.json")
        self.value_net.load(f"{path_prefix}_value.json")
