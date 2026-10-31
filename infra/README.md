# Cambio on AWS

One EC2 instance (`t4g.micro`, arm64) runs two containers with `docker compose`:
the Go server and Caddy (automatic Let's Encrypt HTTPS, websocket proxy).
The public hostname is `<elastic-ip>.sslip.io`, so no domain purchase is needed.
GitHub Actions deploys over SSM Run Command using OIDC, so there is no SSH and no stored AWS keys.

```
browser ──https/wss──> EIP ──> EC2 [ caddy :443 ──> server :8080 ]
GitHub Actions ──OIDC──> IAM role ──ssm:SendCommand──> EC2 (pull image, restart)
                                          S3 cambio-artifacts-<acct>/{models,games}/
```

## What it costs

There is no load balancer, NAT gateway or Fargate. The billable parts are:

| Resource | Notes |
|---|---|
| EC2 `t4g.micro` | Covered by free-tier credits/hours on eligible accounts. Otherwise about $6/month on-demand in us-east-1. |
| Public IPv4 (Elastic IP) | AWS bills public IPv4 addresses hourly (about $3.60/month), including attached ones. Check whether your free-tier terms cover it. |
| EBS gp3, 8 GB | Pennies per month. |
| S3 | Pennies at this size. Game logs expire after 180 days. |

**Check your account's free-tier status in the Billing console before applying.** AWS changed its free-tier model in 2025. The budget alarm emails you at 50% and 100% of `monthly_budget_usd` (default $5).

## Limits (by design, for now)

- **One instance and in-memory state.** A redeploy or reboot ends live games. Session-token reconnect comes in P5. Until then, deploy when nobody is playing.
- **The websocket origin check rejects clients that send no `Origin` header.** That includes native apps. The iOS client is parked on branch `ios-parked`.
- **Scale-up path:** once state moves out of process memory, move to ECS Fargate behind an ALB (raise the idle timeout for websockets), or run a second instance with sticky routing.

## First-time setup (owner, in order)

Prerequisites: Terraform ≥ 1.10, the AWS CLI logged in to your account, and `gh` CLI access to the repo.

1. **Create the state bucket** (once):
   ```bash
   terraform -chdir=infra/bootstrap init
   terraform -chdir=infra/bootstrap apply
   ```
2. **Publish the first image.** Merge the PR to `main`. CI runs, then `Deploy` builds and pushes `ghcr.io/zahiraii/cambio`. The SSM step is skipped because `AWS_INSTANCE_ID` isn't set yet. Then in GitHub → your profile → Packages → `cambio` → Package settings, set visibility to **Public** so the instance can pull it without credentials.
3. **Create the stack:**
   ```bash
   terraform -chdir=infra init \
     -backend-config="bucket=$(terraform -chdir=infra/bootstrap output -raw bucket)" \
     -backend-config="region=us-east-1"
   terraform -chdir=infra apply -var alert_email=you@example.com
   ```
   - If `apply` fails on the GitHub OIDC provider because it already exists, import it with the command shown at the top of `github_oidc.tf`.
   - Confirm the AWS Budgets subscription email.
4. **Wait for HTTPS.** First boot installs Docker and Caddy issues a certificate. This takes about 2–5 minutes.
   ```bash
   curl -s "$(terraform -chdir=infra output -raw public_url)/healthz"   # {"status":"ok"}
   ```
5. **Wire up redeploys.** Set the repo variables from the outputs:
   ```bash
   gh variable set AWS_REGION --body us-east-1
   gh variable set AWS_INSTANCE_ID --body "$(terraform -chdir=infra output -raw instance_id)"
   gh variable set AWS_DEPLOY_ROLE_ARN --body "$(terraform -chdir=infra output -raw deploy_role_arn)"
   gh variable set CAMBIO_HOST --body "$(terraform -chdir=infra output -raw cambio_host)"
   ```
   From then on, every merge to `main` that passes CI redeploys automatically.

## Operating

- **Changing `deploy/`:** `docker-compose.prod.yml` and `Caddyfile` ship with every deploy. `user_data` only runs on first boot and Terraform ignores later edits to it. To re-bootstrap on purpose, run `terraform -chdir=infra apply -replace=aws_instance.web`. That drops live games and re-issues the certificate; Let's Encrypt allows 5 duplicate certificates per week.

- **Shell on the box:**
  ```bash
  aws ssm start-session --target "$(terraform -chdir=infra output -raw instance_id)"
  ```
- **Logs:**
  ```bash
  cd /opt/cambio && sudo docker compose -f docker-compose.prod.yml logs -f server
  ```
- **Roll back:** in the Actions tab, run `Deploy` with `workflow_dispatch` and enter an older commit sha.
- **Tear down:**
  ```bash
  terraform -chdir=infra destroy
  ```
  The state bucket in `bootstrap/` has `prevent_destroy` set and is kept. It costs pennies.
