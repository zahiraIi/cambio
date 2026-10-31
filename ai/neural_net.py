import numpy as np
import json
from pathlib import Path


class ActivationFn:
    @staticmethod
    def relu(x):
        return np.maximum(0, x)

    @staticmethod
    def relu_grad(x):
        return (x > 0).astype(np.float64)

    @staticmethod
    def softmax(x):
        shifted = x - np.max(x, axis=-1, keepdims=True)
        exp = np.exp(shifted)
        return exp / np.sum(exp, axis=-1, keepdims=True)

    @staticmethod
    def tanh(x):
        return np.tanh(x)

    @staticmethod
    def tanh_grad(x):
        return 1 - np.tanh(x) ** 2


class Layer:
    def __init__(self, in_size, out_size, activation="relu"):
        scale = np.sqrt(2.0 / in_size)
        self.weights = np.random.randn(in_size, out_size) * scale
        self.biases = np.zeros(out_size)
        self.activation = activation

        self._input = None
        self._pre_act = None
        self._weight_grad = np.zeros_like(self.weights)
        self._bias_grad = np.zeros_like(self.biases)

    def forward(self, x):
        self._input = x
        self._pre_act = x @ self.weights + self.biases

        if self.activation == "relu":
            return ActivationFn.relu(self._pre_act)
        elif self.activation == "tanh":
            return ActivationFn.tanh(self._pre_act)
        elif self.activation == "softmax":
            return ActivationFn.softmax(self._pre_act)
        elif self.activation == "linear":
            return self._pre_act
        return self._pre_act

    def backward(self, grad_output):
        if self.activation == "relu":
            grad_act = grad_output * ActivationFn.relu_grad(self._pre_act)
        elif self.activation == "tanh":
            grad_act = grad_output * ActivationFn.tanh_grad(self._pre_act)
        else:
            grad_act = grad_output

        if self._input.ndim == 1:
            self._weight_grad += np.outer(self._input, grad_act)
        else:
            self._weight_grad += self._input.T @ grad_act
        self._bias_grad += grad_act.sum(axis=0) if grad_act.ndim > 1 else grad_act

        return grad_act @ self.weights.T

    def zero_grad(self):
        self._weight_grad = np.zeros_like(self.weights)
        self._bias_grad = np.zeros_like(self.biases)


class NeuralNet:
    """Feedforward neural net built from scratch with NumPy."""

    def __init__(self, layer_sizes, activations=None):
        if activations is None:
            activations = ["relu"] * (len(layer_sizes) - 2) + ["linear"]
        self.layers = []
        for i in range(len(layer_sizes) - 1):
            self.layers.append(Layer(layer_sizes[i], layer_sizes[i + 1], activations[i]))

    def forward(self, x):
        for layer in self.layers:
            x = layer.forward(x)
        return x

    def backward(self, grad):
        for layer in reversed(self.layers):
            grad = layer.backward(grad)

    def zero_grad(self):
        for layer in self.layers:
            layer.zero_grad()

    def update(self, lr, clip_norm=1.0):
        total_norm = 0.0
        for layer in self.layers:
            total_norm += np.sum(layer._weight_grad ** 2) + np.sum(layer._bias_grad ** 2)
        total_norm = np.sqrt(total_norm)

        scale = min(1.0, clip_norm / (total_norm + 1e-8))

        for layer in self.layers:
            layer.weights -= lr * layer._weight_grad * scale
            layer.biases -= lr * layer._bias_grad * scale

    def get_params(self):
        return [(l.weights.copy(), l.biases.copy()) for l in self.layers]

    def set_params(self, params):
        for layer, (w, b) in zip(self.layers, params):
            layer.weights = w.copy()
            layer.biases = b.copy()

    def save(self, path):
        data = {
            "layers": [
                {
                    "weights": l.weights.tolist(),
                    "biases": l.biases.tolist(),
                    "activation": l.activation,
                }
                for l in self.layers
            ]
        }
        Path(path).write_text(json.dumps(data))

    def load(self, path):
        data = json.loads(Path(path).read_text())
        for layer, saved in zip(self.layers, data["layers"]):
            layer.weights = np.array(saved["weights"])
            layer.biases = np.array(saved["biases"])
            layer.activation = saved["activation"]
