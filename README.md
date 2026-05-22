# Cambio

Online Cambio card game — rules engine, browser UI, solo bots, and optional RL training.

## Status

| Area | Done |
|------|------|
| Game rules (Go) | Peeks, abilities, stack/snap, cambio final round |
| Web UI | Solo + online rooms, WebSocket live play |
| CPU bots | Trained policy (`models/`) with heuristic fallback |
| Deploy | Docker image, compose, K8s manifests |

## Stack

Go server · vanilla HTML/CSS/JS · Python REINFORCE trainer (NumPy)

## Run locally

```bash
docker compose up --build
# → http://localhost:8080
```

Or without Docker:

```bash
go run ./cmd/server
```

## Test

```bash
go test ./...
cd ai && python3 -m unittest sim_parity_test.py
```

## Deploy (public)

**Docker** (single instance — game state is in-memory):

```bash
docker compose up --build -d
```

**Quick public URL** (free, dev/demo):

```bash
brew install cloudflared   # once
cloudflared tunnel --url http://localhost:8080
```

Use the printed `https://*.trycloudflare.com` link. Keep Docker and the tunnel running.

For always-on production: Fly.io, Oracle Cloud free VM, or VPS + reverse proxy (HTTPS required for WSS).

## Repo

```
cmd/server/       entrypoint
internal/game/    rules engine
internal/server/  HTTP + WebSocket API
web/              frontend
ai/               training sim + REINFORCE agent
models/           exported bot weights
deploy/           Dockerfile.server, K8s
```

## Env

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAMBIO_MODEL_PATH` | `models/cambio` | Bot policy weight prefix |
