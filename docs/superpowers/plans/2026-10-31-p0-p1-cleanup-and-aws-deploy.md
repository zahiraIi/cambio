# P0 Cleanup + P1 AWS Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the repo to its real sources with honest CI, then serve the current Cambio game publicly over HTTPS from one free-tier-sized AWS EC2 instance. Terraform provisions it, and every merge to `main` redeploys it.

**Architecture:** The Go server keeps its current behaviour, plus `/healthz`, an origin check, websocket keepalive and graceful shutdown. On EC2, `docker compose` runs two containers: the server image (built for arm64, pushed to GHCR) and Caddy, which handles automatic Let's Encrypt TLS and proxies websockets. The hostname is `<elastic-ip>.sslip.io`, so no domain purchase is needed. GitHub Actions authenticates to AWS with OIDC and redeploys through SSM Run Command, so there is no SSH and no stored keys.

**Tech Stack:** Go 1.22 + gorilla/websocket, Python 3.12 + NumPy (training scripts), Docker buildx, Caddy 2, Terraform ≥ 1.6 with the AWS provider ~> 5.0, GitHub Actions.

**Spec:** `/Users/zahir/.claude/plans/i-want-to-revamp-cheeky-whale.md` (sections P0 and P1)

## Global Constraints

- Module path: `github.com/zahiraIi/cambio` (matches `git remote -v`).
- CI Go version comes from `go.mod` (`go-version-file: go.mod`). Never pin it separately.
- Budget is free tier / minimal. No ALB, no NAT gateway, no Fargate. Instance `t4g.micro` (arm64). Budget alarm defaults to `$5`/month, with notifications at 50% and 100%.
- No SSH. The security group allows inbound 80 and 443 only. Admin access goes through SSM.
- S3 bucket `cambio-artifacts-<account-id>` is versioned and has the prefixes `models/` and `games/`. A lifecycle rule expires `games/` after 180 days.
- No-Origin websocket requests are rejected, and this is documented. The iOS app is parked.
- Ties count as 0.5 in every win-rate calculation.
- Image: `ghcr.io/zahiraii/cambio` (GHCR requires lowercase), tags `:<git-sha>` and `:latest`.
- Do not change game rules or UI in this plan.

## Review Focus

1. **Behind Caddy, the browser `Origin` must match the request `Host`.** Playing at `https://<ip>.sslip.io` must not be rejected by the origin check. Caddy forwards `Host` unchanged. Pinned by the `TestOriginAllowed_SameHost` case in Task 7.
2. **Concurrent ping writes and game broadcasts on one connection must not race.** Pings use `WriteControl`, which is safe to call concurrently, and `go test -race` must stay clean. Pinned by `TestKeepalive_PingWhileBroadcasting` in Task 8.
3. **A redeploy during a live game.** Players lose their in-memory game; that is the documented limit until reconnect arrives in P5. The process must still exit cleanly within 10s on SIGTERM rather than hang. Pinned by `TestRun_ShutdownOnCancel` in Task 9.
4. **A phone that goes to the background stops answering pings.** The server must drop the connection within `pongWait` (60s) and clean up the room exactly as on a normal disconnect. Pinned by `TestKeepalive_DropsSilentPeer` in Task 8, which uses a short test-only `pongWait`.
5. **Oversized or garbage websocket frames.** A frame larger than 4096 bytes closes that one connection, and the server keeps serving everyone else. Pinned by `TestReadLimit_ClosesOversizedFrame` in Task 8.

---

## File map

| Path | Responsibility |
|---|---|
| `.gitignore` | New. Ignore rules. |
| `.dockerignore` | Trimmed to build-context excludes. |
| `docker-compose.yml` | Local dev. Builds the root `Dockerfile`; health check at `/healthz`. |
| `Dockerfile` | Cross-compiles for `$TARGETARCH`, adds `HEALTHCHECK`. |
| `ai/scoring.py` | New. `outcome_score()`, the single tie rule. |
| `ai/test_scoring.py` | New. Unit tests for the tie rule. |
| `internal/server/origin.go` | New. Origin policy. |
| `internal/server/keepalive.go` | New. Ping/pong and read-limit constants and helpers. |
| `internal/server/handler.go` | Adds the `/healthz` route, uses the origin policy and keepalive. |
| `internal/server/*_test.go` | New server tests. |
| `cmd/server/main.go` | `run(ctx, cfg)` with graceful shutdown; config from env. |
| `cmd/server/main_test.go` | New. Shutdown test. |
| `deploy/docker-compose.prod.yml` | New. Server and Caddy on EC2. |
| `deploy/Caddyfile` | New. TLS and reverse proxy. |
| `infra/bootstrap/*.tf` | New. Terraform state bucket (applied once). |
| `infra/*.tf` | New. EC2, SG, EIP, IAM, S3, budget, GitHub OIDC. |
| `.github/workflows/ci.yml` | Replaces `go.yml`. Go and Python tests. |
| `.github/workflows/deploy.yml` | New. Build, push, SSM redeploy, smoke test. |
| `README.md` | Accurate deploy docs, cost notes, scale-up path. |

---

### Task 1: Remove dead files and add ignore rules

**Files:**
- Create: `.gitignore`
- Modify: `.dockerignore`, `docker-compose.yml:3-6`, `README.md` (Status table "Deploy" row, the `deploy/` line in the layout section)
- Delete: `node_modules/`, `package.json`, `package-lock.json`, `ai/__pycache__/` (untrack), `web-legacy/`, `internal/game/debug_log.go`, `render.yaml`, `fly.toml`, `deploy/Dockerfile.server`, `scripts/deploy-fly.sh`, `deploy/k8s/`

**Interfaces:** Produces the root `Dockerfile` as the only server image definition.

- [ ] **Step 1: Write `.gitignore`.** Lines: `node_modules/`, `__pycache__/`, `*.pyc`, `.cursor/`, `.env`, `.DS_Store`, `ios/.build/`, `xcuserdata/`, `infra/.terraform/`, `infra/**/.terraform/`, `*.tfstate*`, `*.tfvars`.
- [ ] **Step 2: Delete the files.** `git rm -r --cached ai/__pycache__ node_modules` first, then `git rm -r` the rest of the list above. `debug_log.go` has no callers; confirm with `grep -rn "agentDebugLog\|AgentDebugLog" internal cmd`, which should print nothing.
- [ ] **Step 3: Point `docker-compose.yml` at the root `Dockerfile`.** Set `dockerfile: Dockerfile`, because `deploy/Dockerfile.server` was a byte-identical copy. Leave the health-check path for Task 6.
- [ ] **Step 4: Rewrite `.dockerignore` to:** `.git`, `.cursor`, `**/__pycache__`, `**/*.pyc`, `ai/`, `infra/`, `docs/`, `ios/`, `*.md`.
- [ ] **Step 5: Fix the README.** In the Status table, set Deploy to `Docker image, compose (local); AWS EC2 via Terraform (see Deploy)`. Remove `K8s` and `Dockerfile.server` from the layout list. Delete any Fly or Render instructions.
- [ ] **Step 6: Verify.**
  - `go build ./... && go test ./...` → PASS.
  - `docker compose build server` → succeeds.
  - `git ls-files | wc -l` → between 55 and 80.
  - `git status --short | grep -c node_modules` → 0.
- [ ] **Step 7: Commit.** `git commit -m "chore: remove dead files, duplicate deploy targets and vendored node_modules"`

### Task 2: Park the iOS app on a branch

**Files:** Move `ios/` and `Makefile` to branch `ios-parked`. Delete `cambioapp/` (an empty Xcode template).

- [ ] **Step 1: Commit iOS on a branch.** `git switch -c ios-parked`, `git add ios Makefile`, then `git commit -m "chore: park native iOS client"`. `ios/.build/` stays out because of Task 1's `.gitignore`. Check with `git show --stat HEAD | grep -c ".build/"`, which must print 0.
- [ ] **Step 2: Return to main.** Run `git switch main`. The files tracked on `ios-parked` disappear from the working tree. Then `rm -rf ios/.build cambioapp`.
- [ ] **Step 3: Verify.** `ls ios Makefile cambioapp 2>&1 | grep -c "No such file"` → 3. `git log ios-parked -1 --stat` lists `ios/Sources/...`.
- [ ] **Step 4: Note it in the README.** Add one line under Status: "Native iOS client parked on branch `ios-parked`; mobile is served by the web app." Commit with `git commit -am "docs: note parked iOS client"`.

### Task 3: Fix the module path

**Files:** Modify `go.mod:1`, `cmd/server/main.go`, `internal/server/handler.go`, `internal/server/hub.go`. These are the only import sites; `grep -rln github.com/zahir/cambio .` confirms it.

- [ ] **Step 1: Rename the module.** `go mod edit -module github.com/zahiraIi/cambio`, then `grep -rl 'github.com/zahir/cambio' --include=*.go . | xargs sed -i '' 's#github.com/zahir/cambio#github.com/zahiraIi/cambio#g'`.
- [ ] **Step 2: Verify.** `grep -rn "zahir/cambio" --include=*.go --include=go.mod .` → no output. `go build ./... && go vet ./... && go test ./...` → PASS.
- [ ] **Step 3: Commit.** `git commit -am "chore: set module path to github.com/zahiraIi/cambio"`

### Task 4: Fair tie scoring in training and eval

**Files:**
- Create: `ai/scoring.py`, `ai/test_scoring.py`
- Modify: `ai/eval.py:18-30`, `ai/train.py:87-90`

**Interfaces:** Produces `outcome_score(agent_score: int, other_scores: list[int]) -> float`. P6's eval gate uses it.

- [ ] **Step 1: Write the failing test** in `ai/test_scoring.py` (unittest, matching `sim_parity_test.py`'s style). Lower Cambio score is better.
```python
class OutcomeScoreTests(unittest.TestCase):
    def test_strict_lowest_is_win(self):   self.assertEqual(outcome_score(3, [5, 7, 9]), 1.0)
    def test_tie_for_lowest_is_half(self): self.assertEqual(outcome_score(5, [5, 7, 9]), 0.5)
    def test_three_way_tie_is_half(self):  self.assertEqual(outcome_score(5, [5, 5, 9]), 0.5)
    def test_not_lowest_is_loss(self):     self.assertEqual(outcome_score(6, [5, 7, 9]), 0.0)
```
- [ ] **Step 2: Run it and confirm it fails.** `cd ai && python3 -m unittest test_scoring -v` → `ModuleNotFoundError: scoring`.
- [ ] **Step 3: Implement `outcome_score` in `ai/scoring.py`.** It returns 1.0 if `agent_score < min(others)`, 0.5 if equal, and 0.0 otherwise.
- [ ] **Step 4: Use it in both callers.**
  - `eval.py`: accumulate `wins += outcome_score(agent_score, others)` and print the label `Score (ties=0.5)`.
  - `train.py`: replace `won = agent_score <= min(others)` and `1.0 if won else 0.0` with `win_history.append(outcome_score(agent_score, others))`.
- [ ] **Step 5: Verify.** `cd ai && python3 -m unittest test_scoring sim_parity_test -v` → all PASS. `python3 train.py --episodes 20 --print-every 10 --save-path /tmp/cambio-smoke` runs without error. Check the flag names against `train.py`'s argparse.
- [ ] **Step 6: Commit.** `git commit -m "fix(ai): count ties as 0.5 instead of wins in train and eval"`

### Task 5: CI on the go.mod version, with vet, race and Python

**Files:** Delete `.github/workflows/go.yml`. Create `.github/workflows/ci.yml`.

**Interfaces:** Produces the workflow name `CI` and job ids `go` and `python`. Task 12's deploy workflow gates on `workflow_run: workflows: [CI]`.

- [ ] **Step 1: Write `ci.yml`.** Triggers: `push` to `main` and `pull_request`.
  - Job `go`: `actions/checkout@v4`, `actions/setup-go@v5` with `go-version-file: go.mod`, then `go vet ./...` and `go test -race ./...`.
  - Job `python`: `actions/setup-python@v5` with `3.12`, `pip install -r ai/requirements.txt`, then `cd ai && python -m unittest discover -p "*test*.py" -v`.
- [ ] **Step 2: Verify locally.** `go vet ./... && go test -race ./...` → PASS. `cd ai && python3 -m unittest discover -p "*test*.py"` → PASS.
- [ ] **Step 3: Commit.** `git commit -m "ci: go.mod-pinned Go with vet and race, plus Python tests"`. The workflow is confirmed green when Task 12's PR pushes.

### Task 6: `/healthz` endpoint and health checks

**Files:**
- Modify: `internal/server/handler.go:31-38` (RegisterRoutes), `docker-compose.yml` (healthcheck), `Dockerfile`, `scripts/launch.py:245`
- Test: `internal/server/health_test.go`

**Interfaces:** Produces `GET /healthz → 200, body {"status":"ok"}, Content-Type application/json`. Caddy, Docker and the deploy smoke test all use it.

- [ ] **Step 1: Write the failing test** `TestHealthz`. Build an `httptest.NewServer` from a mux with `NewHandler(NewHub()).RegisterRoutes(mux)`, `GET /healthz`, then assert status 200, the Content-Type, and a JSON body of exactly `{"status":"ok"}`.
- [ ] **Step 2: Run it and confirm it fails.** `go test ./internal/server -run TestHealthz -v` → FAIL. Without a route, the request falls through to the file server and returns 404.
- [ ] **Step 3: Implement `func (h *Handler) handleHealthz(w http.ResponseWriter, r *http.Request)`** and register it at `/healthz`.
- [ ] **Step 4: Switch every health check to `/healthz`.**
  - `docker-compose.yml`: `wget -q -O - http://127.0.0.1:8080/healthz`.
  - `Dockerfile` runtime stage: `HEALTHCHECK --interval=10s --timeout=2s --retries=3 CMD wget -q -O - http://127.0.0.1:8080/healthz || exit 1`.
  - `launch.py:245`: `/healthz`.
- [ ] **Step 5: Verify.** `go test ./internal/server -v` → PASS. `grep -rn "api/games" docker-compose.yml Dockerfile scripts/` → no output.
- [ ] **Step 6: Commit.** `git commit -m "feat(server): add /healthz and point all health checks at it"`

### Task 7: Origin allowlist

**Files:**
- Create: `internal/server/origin.go`, `internal/server/origin_test.go`
- Modify: `internal/server/handler.go:19-21` (the `upgrader` var), `NewHandler`

**Interfaces:**
- Produces `func originAllowed(allowed []string) func(*http.Request) bool`.
- Changes `func NewHandler(hub *Hub, allowedOrigins []string) *Handler`. The upgrader moves to a field on `Handler`.
- Task 9 reads `allowedOrigins` from env `CAMBIO_ALLOWED_ORIGINS` (comma-separated, full origins such as `https://1.2.3.4.sslip.io`).

The rule is: allow if the `Origin` header's host equals `r.Host`, or if the full origin string is in `allowed`. Reject a missing or empty `Origin`.

- [ ] **Step 1: Write a failing table test** `TestOriginAllowed` with these cases:
  - `SameHost`: Origin `https://1.2.3.4.sslip.io`, Host `1.2.3.4.sslip.io` → true
  - `Listed`: Origin `http://localhost:5173`, Host `localhost:8080`, allowed `[http://localhost:5173]` → true
  - `Foreign`: Origin `https://evil.example`, Host `1.2.3.4.sslip.io` → false
  - `Missing`: no Origin → false
  - `Malformed`: Origin `::bad` → false
- [ ] **Step 2: Run it and confirm it fails.** `go test ./internal/server -run TestOriginAllowed -v` → FAIL (undefined).
- [ ] **Step 3: Implement `originAllowed`** with `net/url.Parse`. Compare `u.Host` to `r.Host` case-insensitively.
- [ ] **Step 4: Wire it in.** `Handler` gets `upgrader websocket.Upgrader{CheckOrigin: originAllowed(allowedOrigins)}`. Update the one caller in `main.go` to pass `nil` for now.
- [ ] **Step 5: Verify.** `go test -race ./internal/server -v` → PASS. Manual check: `go run ./cmd/server`, then open `http://localhost:8080` and play a solo game. The same-host rule must let it through.
- [ ] **Step 6: Commit.** `git commit -m "feat(server): enforce websocket origin allowlist, reject missing Origin"`

### Task 8: Websocket keepalive and read limit

**Files:**
- Create: `internal/server/keepalive.go`, `internal/server/ws_test.go`
- Modify: `internal/server/handler.go` (`handleWebSocket`, right after `Upgrade`)

**Interfaces:** Produces package-level `var` values so tests can shorten them: `pongWait = 60 * time.Second`, `pingPeriod = 54 * time.Second` (that is, `pongWait*9/10`), `writeWait = 10 * time.Second`, `maxMessageSize int64 = 4096`. It also produces `func startKeepalive(conn *websocket.Conn) (stop func())`.

`startKeepalive` does the following:
- calls `conn.SetReadLimit(maxMessageSize)` and `conn.SetReadDeadline(now+pongWait)`;
- sets a `SetPongHandler` that extends the deadline;
- starts a goroutine with a ticker that calls `conn.WriteControl(websocket.PingMessage, nil, now+writeWait)`. `WriteControl` is safe alongside `Client.Send`'s mutex-guarded writes;
- returns `stop`, which ends the ticker goroutine. `handleWebSocket` must `defer stop()`.

- [ ] **Step 1: Write the failing tests.** Use an `httptest.NewServer` running the real handler, and a solo game created over `POST /api/games/solo`. Copy the request body from `handleSoloGame`. Each websocket dial sets the header `Origin: http://<server host>`.
  - `TestReadLimit_ClosesOversizedFrame`: dial, send a 5000-byte text frame, then the next `ReadMessage` returns an error within 2s. After that, `GET /healthz` still returns 200.
  - `TestKeepalive_DropsSilentPeer`: set `pongWait=300ms` and `pingPeriod=100ms` (restore them with `t.Cleanup`). Dial with a client whose `SetPingHandler` does nothing, so it never pongs, and don't read. Then poll `hub.GetGame(id)` until the player's client is unregistered, within 2s.
  - `TestKeepalive_PingWhileBroadcasting`: set `pingPeriod=5ms`. Dial two clients, have one send 200 actions (`{"action":"start"}` is fine, even if it errors), and read on both. The test passes if `go test -race` reports no race.
- [ ] **Step 2: Run them and confirm they fail.** `go test -race ./internal/server -run 'TestReadLimit|TestKeepalive' -v` → FAIL. Today the oversized frame is accepted and silent peers are never dropped.
- [ ] **Step 3: Implement `startKeepalive`** and call it in `handleWebSocket`.
- [ ] **Step 4: Verify.** `go test -race ./... -count=3` → PASS, three times in a row, with no flakes.
- [ ] **Step 5: Commit.** `git commit -m "feat(server): websocket ping/pong keepalive and 4KB read limit"`

### Task 9: Config from env and graceful shutdown

**Files:**
- Modify: `cmd/server/main.go`
- Create: `cmd/server/main_test.go`

**Interfaces:** Produces:
- `type config struct { Port string; ModelPath string; AllowedOrigins []string }`
- `func loadConfig(getenv func(string) string) config`, reading `PORT` (default `8080`), `CAMBIO_MODEL_PATH` (default `models/cambio`) and `CAMBIO_ALLOWED_ORIGINS` (comma-split, trimmed, blanks dropped)
- `func run(ctx context.Context, cfg config, ready chan<- string) error`, which sends the bound address on `ready` once it is listening

`main()` does `ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)` and `log.Fatal` on a non-nil `run` error. `run` uses `http.Server`. On `<-ctx.Done()` it calls `Shutdown` with a 10s timeout and returns nil on a clean shutdown. Drop the `-port` and `-model` flags: env is the only config source.

- [ ] **Step 1: Write the failing tests.**
  - `TestLoadConfig`: with an empty env, get `{8080, models/cambio, nil}`. With `CAMBIO_ALLOWED_ORIGINS=" https://a.io, ,http://b:1 "`, get `[https://a.io http://b:1]`.
  - `TestRun_ShutdownOnCancel`: start `run` with `Port:"0"` in a goroutine, wait on `ready`, `GET http://<addr>/healthz` → 200, `cancel()`, then `run` returns nil within 11s.
- [ ] **Step 2: Run them and confirm they fail.** `go test ./cmd/server -v` → FAIL (undefined `run` and `loadConfig`).
- [ ] **Step 3: Implement it.** Port `"0"` means listen with `net.Listen("tcp", ":"+cfg.Port)` and report `ln.Addr()`. Keep the existing `LoadPolicy` log lines.
- [ ] **Step 4: Verify.** `go test -race ./... ` → PASS. `go run ./cmd/server & sleep 1; kill -TERM $!; wait $!; echo $?` → `0`.
- [ ] **Step 5: Commit.** `git commit -m "feat(server): env config struct and graceful SIGTERM shutdown"`

### Task 10: Multi-arch image, production compose and Caddy

**Files:**
- Modify: `Dockerfile`
- Create: `deploy/docker-compose.prod.yml`, `deploy/Caddyfile`

**Interfaces:**
- Produces a compose file that reads `CAMBIO_IMAGE` (full image ref) and `CAMBIO_HOST` (for example `1.2.3.4.sslip.io`) from `/opt/cambio/.env`. Task 11 writes that file and Task 12 updates `CAMBIO_IMAGE` in it.
- The server's `CAMBIO_ALLOWED_ORIGINS` is set to `https://${CAMBIO_HOST}`.

- [ ] **Step 1: Make the Dockerfile cross-compile.** The builder stage becomes `FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS builder` with `ARG TARGETOS TARGETARCH` and `RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o cambio-server ./cmd/server`. The runtime stage is unchanged apart from Task 6's `HEALTHCHECK`.
- [ ] **Step 2: Write `deploy/Caddyfile`.** One site block, `{$CAMBIO_HOST} { encode gzip; reverse_proxy server:8080 }`. Caddy proxies websockets and preserves `Host` by default.
- [ ] **Step 3: Write `deploy/docker-compose.prod.yml`.**
  - Service `server`: `image: ${CAMBIO_IMAGE}`, `restart: unless-stopped`, env `CAMBIO_ALLOWED_ORIGINS=https://${CAMBIO_HOST}`, no published ports, `stop_grace_period: 15s`.
  - Service `caddy`: `caddy:2-alpine`, ports `80:80` and `443:443`, mounts `./Caddyfile:/etc/caddy/Caddyfile:ro` plus a named volume `caddy_data:/data`, env `CAMBIO_HOST`, `depends_on: server: condition: service_healthy`.
- [ ] **Step 4: Verify locally.**
  - `docker buildx build --platform linux/arm64,linux/amd64 -t cambio:test .` → succeeds.
  - `CAMBIO_IMAGE=cambio:test CAMBIO_HOST=localhost docker compose -f deploy/docker-compose.prod.yml up -d` (build `cambio:test` single-arch with `--load` first).
  - `curl -sk https://localhost/healthz` → `{"status":"ok"}`. Caddy serves an internal certificate for localhost.
  - Open `https://localhost`, accept the certificate, and play a solo game. The websocket must work through Caddy with the origin check enforced.
  - `docker compose -f deploy/docker-compose.prod.yml down -v`.
- [ ] **Step 5: Commit.** `git commit -m "feat(deploy): multi-arch image, production compose with Caddy TLS"`

### Task 11: Terraform infrastructure

**Files:**
- Create in `infra/bootstrap/`: `main.tf`. This holds the state bucket `cambio-tfstate-<account-id>`: versioned, public access blocked, SSE-S3, `prevent_destroy`, and `use_lockfile` locking with no DynamoDB.
- Create in `infra/`: `versions.tf`, `variables.tf`, `network.tf`, `compute.tf`, `user_data.sh.tftpl`, `storage.tf`, `iam.tf`, `github_oidc.tf`, `budget.tf`, `outputs.tf`, `README.md`.

**Interfaces:**
- Variables:
  - `region` (default `us-east-1`)
  - `instance_type` (default `t4g.micro`)
  - `monthly_budget_usd` (default `5`)
  - `alert_email` (required)
  - `github_repo` (default `zahiraIi/cambio`)
  - `image` (default `ghcr.io/zahiraii/cambio:latest`)
- Outputs: `public_url` (`https://<eip>.sslip.io`), `instance_id`, `artifacts_bucket`, `deploy_role_arn`. Task 12 reads `instance_id` and `deploy_role_arn` as GitHub repo variables `AWS_INSTANCE_ID` and `AWS_DEPLOY_ROLE_ARN`, plus `CAMBIO_HOST`.

What each file decides:
- `network.tf`:
  - Use the default VPC and subnet.
  - Security group: ingress 80 and 443 from `0.0.0.0/0` and `::/0`, all egress, no port 22.
  - An `aws_eip` attached to the instance.
- `compute.tf`:
  - Latest AL2023 arm64 AMI via the SSM parameter `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64`.
  - gp3 root volume, 8 GB, encrypted.
  - `metadata_options { http_tokens = "required" }`.
  - `user_data_replace_on_change = true`.
- `user_data.sh.tftpl`:
  - Install docker and the compose plugin.
  - Write `/opt/cambio/{docker-compose.prod.yml,Caddyfile}`, rendered from the `deploy/` files with `file()`.
  - Write `/opt/cambio/.env` with `CAMBIO_IMAGE` and `CAMBIO_HOST=${eip}.sslip.io`.
  - `docker compose up -d`.
  - The EIP has to be known before the instance renders, so allocate the EIP standalone and associate it with `aws_eip_association`.
- `storage.tf`:
  - Bucket `cambio-artifacts-<account-id>`: versioning, public access blocked, SSE-S3.
  - Lifecycle rule on prefix `games/`: expire after 180 days, and expire noncurrent versions after 30 days.
- `iam.tf`:
  - Instance role with `AmazonSSMManagedInstanceCore`.
  - Inline policy: `s3:GetObject` on `models/*` and `s3:PutObject` on `games/*` (for P3).
- `github_oidc.tf`:
  - `aws_iam_openid_connect_provider` for `token.actions.githubusercontent.com`.
  - Role trusted only for `repo:zahiraIi/cambio:ref:refs/heads/main`.
  - Permissions: `ssm:SendCommand` on the instance ARN plus the `AWS-RunShellScript` document, and `ssm:GetCommandInvocation`.
- `budget.tf`: `aws_budgets_budget` COST, monthly, with notifications at 50% and 100% ACTUAL to `alert_email`.

Steps:
- [ ] **Step 1: Write the bootstrap and main configs.** Point `infra/versions.tf` at backend `s3` with the bootstrap bucket and `use_lockfile = true`.
- [ ] **Step 2: Verify statically.** Run `terraform -chdir=infra/bootstrap init -backend=false && terraform -chdir=infra/bootstrap validate`, then the same for `infra`. Both print `Success!`. `terraform fmt -check -recursive infra` returns exit 0.
- [ ] **Step 3: Owner step (costs money, needs AWS credentials, so the owner runs it).**
  - Confirm the account's free-tier status in the Billing console.
  - `terraform -chdir=infra/bootstrap apply`.
  - `terraform -chdir=infra apply -var alert_email=...`.
  - Expected: `public_url` is printed, and `curl -s $(terraform -chdir=infra output -raw public_url)/healthz` returns `{"status":"ok"}` within 5 minutes. Caddy has to finish issuing the certificate first.
- [ ] **Step 4: Write `infra/README.md`.** Cover:
  - apply and destroy order;
  - what is billable (EIP when unattached, EC2 outside free tier, S3);
  - the single-instance, in-memory limit (a redeploy ends live games);
  - the scale-up path: ECS Fargate + ALB, or a second instance with sticky routing, once state moves out of memory.
- [ ] **Step 5: Commit.** `git commit -m "feat(infra): terraform for EC2+Caddy, S3 artifacts, budget alarm, GitHub OIDC"`

### Task 12: Deploy pipeline

**Files:** Create `.github/workflows/deploy.yml`. Modify `README.md` (Deploy section).

**Interfaces:**
- Consumes the CI workflow name `CI` (Task 5).
- Consumes the GitHub repo variables `AWS_DEPLOY_ROLE_ARN`, `AWS_INSTANCE_ID`, `AWS_REGION` and `CAMBIO_HOST` (Task 11 outputs).

- [ ] **Step 1: Write `deploy.yml`.** Trigger on `workflow_run: { workflows: [CI], types: [completed], branches: [main] }` with job guard `if: github.event.workflow_run.conclusion == 'success'`, plus `workflow_dispatch`. Permissions: `id-token: write`, `contents: read`, `packages: write`. Steps in order:
  1. Checkout at `github.event.workflow_run.head_sha`.
  2. `docker/setup-qemu-action@v3` and `docker/setup-buildx-action@v3`.
  3. `docker/login-action@v3` to ghcr with `GITHUB_TOKEN`.
  4. `docker/build-push-action@v6`: `platforms: linux/arm64`, tags `ghcr.io/zahiraii/cambio:${sha}` and `:latest`, `cache-from/to: type=gha`.
  5. `aws-actions/configure-aws-credentials@v4` with `role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}`.
  6. `aws ssm send-command --document-name AWS-RunShellScript --instance-ids $AWS_INSTANCE_ID` with commands `cd /opt/cambio`, `sed -i "s#^CAMBIO_IMAGE=.*#CAMBIO_IMAGE=ghcr.io/zahiraii/cambio:${sha}#" .env`, `docker compose -f docker-compose.prod.yml pull server`, `docker compose -f docker-compose.prod.yml up -d server`. Capture the `CommandId`.
  7. `aws ssm wait command-executed`, then fail the job if the status is not `Success`.
  8. Smoke test: `curl -fsS --retry 10 --retry-delay 3 https://$CAMBIO_HOST/healthz`.
- [ ] **Step 2: Owner step.**
  - Make the GHCR package `cambio` public. This lets the instance pull without credentials.
  - Set the four repo variables.
  - Open a PR with this plan's commits; CI goes green.
  - Merge.
  - Expected: Deploy goes green, and `/healthz` on the public URL returns 200 serving the new image. `docker ps` over SSM Session Manager shows the `:<sha>` tag.
- [ ] **Step 3: End-to-end acceptance.** A phone on cellular and a laptop join the same game at the public URL and finish it. Push a trivial README change to `main` and confirm the site redeploys with no manual step. Run `terraform -chdir=infra plan` and confirm `No changes`.
- [ ] **Step 4: Update the README Deploy section.** Describe the public URL, how deploys happen (merge to `main`), how to roll back (re-run `workflow_dispatch` on an older commit), and the cost and limits notes linked to `infra/README.md`. Commit with `git commit -m "ci: build arm64 image and redeploy via SSM on merge to main"`.
