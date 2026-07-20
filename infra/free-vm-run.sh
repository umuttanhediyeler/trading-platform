#!/usr/bin/env bash
# En basit ücretsiz deploy: Oracle Always Free VM üzerinde hazır GHCR image çalıştır.
# Kullanım (VM içinde):
#   nano .env.api   # DATABASE_URL, REDIS_URL, JWT_*, ENCRYPTION_KEY, WEB_ORIGIN
#   bash free-vm-run.sh

set -euo pipefail

API_IMAGE="${API_IMAGE:-ghcr.io/umuttanhediyeler/trading-platform-api:latest}"
ENV_FILE="${ENV_FILE:-.env.api}"

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<'EOF'
NODE_ENV=production
PORT=3001
DISABLE_WORKERS=true
NODE_OPTIONS=--max-old-space-size=512
DATABASE_URL=postgresql://postgres.REF:SIFRE@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require
REDIS_URL=rediss://default:SIFRE@absolute-catfish-189396.upstash.io:6379
WEB_ORIGIN=https://SENIN-VERCEL-URL.vercel.app
JWT_SECRET=degistir
JWT_REFRESH_SECRET=degistir
ENCRYPTION_KEY=64_karakter_hex_openssl_rand_hex_32
ALLOW_LIVE_BROKER=false
MARKET_DATA_PROVIDER=alpaca
ALPACA_BASE_URL=https://paper-api.alpaca.markets
EOF
  echo "Created $ENV_FILE — fill secrets, then re-run."
  exit 1
fi

sudo apt-get update -y
sudo apt-get install -y docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" || true

sudo docker pull "$API_IMAGE"
sudo docker rm -f apex-api 2>/dev/null || true
sudo docker run -d --name apex-api --restart unless-stopped \
  -p 80:3001 --env-file "$ENV_FILE" \
  "$API_IMAGE"

echo "API should be at http://$(curl -s ifconfig.me)/health"
echo "Then set Vercel NEXT_PUBLIC_API_URL to http://THAT_IP"
