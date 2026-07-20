#!/usr/bin/env bash
# One-time bootstrap for Oracle Cloud / Ubuntu VPS (Always Free tier).
# Run on the server as a user with sudo:
#   curl -fsSL https://raw.githubusercontent.com/umuttanhediyeler/trading-platform/main/infra/scripts/vps-bootstrap.sh | bash
#
# Or after cloning:
#   bash infra/scripts/vps-bootstrap.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/trading-platform}"
REPO="${REPO:-https://github.com/umuttanhediyeler/trading-platform.git}"
BRANCH="${BRANCH:-main}"

if ! command -v sudo >/dev/null 2>&1; then
  echo "Run this script on the VPS with sudo available." >&2
  exit 1
fi

echo "==> Installing Docker (Compose v2)"
if ! docker compose version >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi

echo "==> Installing git + openssl"
sudo apt-get update -qq
sudo apt-get install -y -qq git openssl curl

echo "==> Cloning repository to $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  echo "    Already cloned — pulling latest"
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  sudo mkdir -p "$(dirname "$APP_DIR")"
  sudo git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
  sudo chown -R "$USER:$USER" "$APP_DIR"
fi

echo "==> Preparing production env"
cd "$APP_DIR/infra"
if [ ! -f .env.prod ]; then
  cp .env.prod.example .env.prod
fi

# Set PUBLIC_ORIGIN to this server's public IP if still localhost
if grep -q '^PUBLIC_ORIGIN=http://localhost' .env.prod 2>/dev/null; then
  PUB_IP=$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
  if [ -n "$PUB_IP" ]; then
    sed -i.bak "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=http://${PUB_IP}|" .env.prod
    sed -i.bak "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=http://${PUB_IP}|" .env.prod
    rm -f .env.prod.bak
    echo "    Set PUBLIC_ORIGIN=http://${PUB_IP}"
  fi
fi

chmod +x deploy.sh

echo "==> First deploy (builds all images — may take 20–40 min on free VM)"
./deploy.sh

echo
echo "Bootstrap complete."
echo "  App URL: $(grep ^PUBLIC_ORIGIN= .env.prod | cut -d= -f2-)"
echo "  Add GitHub Actions secrets (see infra/DEPLOY-GITHUB.md) for auto-deploy on push."
