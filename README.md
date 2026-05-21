# Cambio

Card game simulator and AI practice engine.

## Architecture

- **Go server** — game engine, HTTP/WebSocket API, serves the web UI
- **HTML/CSS/JS frontend** — browser-based multiplayer card game
- **Python AI** — from-scratch neural net + REINFORCE RL agent, trained via self-play
- **Kubernetes** — deployment configs for server + AI trainer

## Rules

| Card | Points | Ability |
|------|--------|---------|
| A-6 | Face value | — |
| 7, 8 | Face value | Peek at opponent's card |
| 9, 10 | Face value | Peek at your own card |
| J, Q | 10 | Blind switch with opponent |
| Black King | 10 | Look at card & switch (or decline → forced blind switch) |
| Red King | -1 | — |
| Joker | 0 | — |

**Goal:** Lowest score wins. Call "Cambio" to trigger the final round.

## Quick Start

```bash
# Run the game server
go run ./cmd/server

# Open http://localhost:8080 in your browser

# Train the AI (from scratch, no frameworks)
cd ai
pip install -r requirements.txt
python train.py --episodes 50000 --self-play

# Connect AI to a live game
python ws_client.py --game-id <id> --name CambioBot
```

## Deploy

```bash
# Docker
docker build -f deploy/Dockerfile.server -t cambio-server .
docker build -f deploy/Dockerfile.ai -t cambio-ai .

# Kubernetes
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/
```

## Project Structure

```
cmd/server/         Go server entrypoint
internal/game/      Cambio game engine (cards, deck, player, rules)
internal/server/    HTTP + WebSocket handler, game room hub
web/                HTML/CSS/JS frontend
ai/                 Python AI engine
  neural_net.py     Feedforward NN from scratch (NumPy only)
  game_sim.py       Python mirror of Go game rules
  agent.py          REINFORCE agent with value baseline
  train.py          Self-play training loop
  ws_client.py      Connects trained agent to live server
deploy/             Docker + K8s configs
```
