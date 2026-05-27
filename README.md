# Cambio

Online Cambio card game — rules engine, browser UI, solo bots, and optional RL training.

## Status

| Area | Done |
|------|------|
| Game rules (Go) | Peeks, abilities, stack/snap, cambio final round |
| Web UI | Poker table UI, online/solo, stack/snap |
| CPU bots | Trained policy (`models/`) with heuristic fallback |
| Deploy | Docker image, compose, K8s manifests |

## Stack

Go server · vanilla HTML/CSS/JS · Python REINFORCE trainer (NumPy)

## Run locally

**Recommended** — Docker (multiplayer-ready, matches production):

```bash
python3 scripts/launch.py
# → http://localhost:8080
```

Equivalent to `docker compose up --build`.

**Without Docker** (Go serves `web/` directly):

```bash
python3 scripts/launch.py --native
# → http://localhost:8080
```

Manual equivalent:

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

**Mobile:** open the link in Safari/Chrome, or **Add to Home Screen** for a full-screen app icon (PWA).

For always-on production: Fly.io, Oracle Cloud free VM, or VPS + reverse proxy (HTTPS required for WSS).

## Repo

```
cmd/server/       entrypoint
internal/game/    rules engine
internal/server/  HTTP + WebSocket API
web/              static frontend (HTML/CSS/JS)
web-legacy/       previous UI reference
ai/               training sim + REINFORCE agent
models/           exported bot weights
deploy/           Dockerfile.server, K8s
```

## Env

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAMBIO_MODEL_PATH` | `models/cambio` | Bot policy weight prefix |
