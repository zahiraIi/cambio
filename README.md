# Cambio

Online Cambio card game — rules engine, browser UI, solo bots, and optional RL training.

## Status

| Area | Done |
|------|------|
| Game rules (Go) | Peeks, abilities, stack/snap, cambio final round |
| Web UI | Poker table UI, online/solo, stack/snap |
| CPU bots | Trained policy (`models/`) with heuristic fallback |
| Deploy | Docker image, compose (local); AWS EC2 via Terraform (see Deploy) |

Native iOS client parked on branch `ios-parked`; mobile is served by the web app.

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

**Production: AWS.** One EC2 instance runs the server behind Caddy (automatic HTTPS), reachable at `https://<elastic-ip>.sslip.io`. Terraform provisions it (`infra/`).

- **Deploys:** every merge to `main` that passes CI builds an arm64 image, pushes it to `ghcr.io/zahiraii/cambio`, and rolls it out over SSM. `/healthz` is the smoke test.
- **Rollback:** Actions → **Deploy** → *Run workflow* with an older commit sha.
- **Setup, costs and limits:** see [`infra/README.md`](infra/README.md). Game state is in memory on a single instance, so a redeploy ends live games.

**Quick public URL from your laptop** (free, dev/demo):

```bash
docker compose up --build -d
brew install cloudflared   # once
cloudflared tunnel --url http://localhost:8080
```

**Mobile:** open the link in Safari or Chrome, or use **Add to Home Screen** for a full-screen app icon (PWA).

## Env

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | Listen port |
| `CAMBIO_MODEL_PATH` | `models/cambio` | Bot policy weight prefix |
| `CAMBIO_ALLOWED_ORIGINS` | *(empty)* | Extra comma-separated websocket origins. Same-host pages are always allowed; requests with no `Origin` header are rejected. |

## Repo

```
cmd/server/       entrypoint
internal/game/    rules engine
internal/server/  HTTP + WebSocket API
web/              static frontend (HTML/CSS/JS)
ai/               training sim + REINFORCE agent
models/           exported bot weights
deploy/           production compose + Caddyfile, trainer Dockerfile
infra/            Terraform (AWS)
```

