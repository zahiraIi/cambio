#!/usr/bin/env bash
# Deploy Cambio to Fly.io (free tier eligible — one small VM, always on).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v fly >/dev/null 2>&1; then
  echo "Install Fly CLI: brew install flyctl"
  exit 1
fi

if ! fly auth whoami >/dev/null 2>&1; then
  echo "Log in to Fly.io (opens browser)..."
  fly auth login
fi

if ! fly status -a cambio-card-game >/dev/null 2>&1; then
  echo "Creating Fly app cambio-card-game (first deploy)..."
  fly launch --config fly.toml --copy-config --yes --now
else
  echo "Deploying to cambio-card-game..."
  fly deploy --config fly.toml
fi

echo ""
fly status -a cambio-card-game
echo ""
echo "Public URL:"
fly info -a cambio-card-game | grep -E 'Hostname|Hostnames' || fly apps open -a cambio-card-game
