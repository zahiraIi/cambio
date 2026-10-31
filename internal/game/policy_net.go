package game

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
)

type policyLayer struct {
	weights [][]float64
	biases  []float64
	activation string
}

// PolicyNet is a feedforward network matching ai/neural_net.py format.
type PolicyNet struct {
	layers []policyLayer
}

var (
	globalPolicy *PolicyNet
	globalValue  *PolicyNet
	policyLoaded bool
)

type savedLayer struct {
	Weights    [][]float64 `json:"weights"`
	Biases     []float64   `json:"biases"`
	Activation string      `json:"activation"`
}

type savedNet struct {
	Layers []savedLayer `json:"layers"`
}

func loadNet(path string) (*PolicyNet, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var saved savedNet
	if err := json.Unmarshal(data, &saved); err != nil {
		return nil, err
	}
	net := &PolicyNet{layers: make([]policyLayer, len(saved.Layers))}
	for i, sl := range saved.Layers {
		net.layers[i] = policyLayer{
			weights:    sl.Weights,
			biases:     sl.Biases,
			activation: sl.Activation,
		}
	}
	return net, nil
}

// LoadPolicy loads policy and value networks from path prefix (e.g. models/cambio).
func LoadPolicy(pathPrefix string) error {
	policy, err := loadNet(pathPrefix + "_policy.json")
	if err != nil {
		return fmt.Errorf("policy: %w", err)
	}
	value, err := loadNet(pathPrefix + "_value.json")
	if err != nil {
		return fmt.Errorf("value: %w", err)
	}
	globalPolicy = policy
	globalValue = value
	policyLoaded = true
	return nil
}

// PolicyIsLoaded reports whether a policy is available for bot decisions.
func PolicyIsLoaded() bool {
	return policyLoaded
}

func (n *PolicyNet) forward(x []float64) []float64 {
	for _, layer := range n.layers {
		x = layer.forward(x)
	}
	return x
}

func (layer *policyLayer) forward(x []float64) []float64 {
	pre := make([]float64, len(layer.biases))
	for j := range pre {
		sum := layer.biases[j]
		for i, v := range x {
			sum += v * layer.weights[i][j]
		}
		pre[j] = sum
	}
	switch layer.activation {
	case "relu":
		for j := range pre {
			if pre[j] < 0 {
				pre[j] = 0
			}
		}
		return pre
	case "softmax":
		return softmax(pre)
	default:
		return pre
	}
}

func softmax(x []float64) []float64 {
	maxVal := x[0]
	for _, v := range x[1:] {
		if v > maxVal {
			maxVal = v
		}
	}
	out := make([]float64, len(x))
	sum := 0.0
	for i, v := range x {
		out[i] = math.Exp(v - maxVal)
		sum += out[i]
	}
	for i := range out {
		out[i] /= sum
	}
	return out
}

// ChoosePolicyAction picks the highest-probability valid action index.
func ChoosePolicyAction(obs []float64, valid []int) (int, bool) {
	if !policyLoaded || globalPolicy == nil || len(valid) == 0 {
		return 0, false
	}
	probs := globalPolicy.forward(obs)
	masked := make([]float64, PolicyNumActions)
	maxLog := -1e9
	for _, a := range valid {
		if a < 0 || a >= len(probs) {
			continue
		}
		logp := math.Log(probs[a] + 1e-10)
		if logp > maxLog {
			maxLog = logp
		}
	}
	sum := 0.0
	for i := range masked {
		masked[i] = -1e9
	}
	for _, a := range valid {
		if a < 0 || a >= len(probs) {
			continue
		}
		masked[a] = math.Exp(math.Log(probs[a]+1e-10) - maxLog)
		sum += masked[a]
	}
	if sum <= 0 {
		return valid[0], true
	}
	best := valid[0]
	bestP := -1.0
	for _, a := range valid {
		if a < 0 || a >= len(masked) {
			continue
		}
		p := masked[a] / sum
		if p > bestP {
			bestP = p
			best = a
		}
	}
	return best, true
}
