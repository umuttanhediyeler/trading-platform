#!/usr/bin/env bash
# Deploy the trading platform to Northflank (project: fintech).
#
# Prerequisites:
#   1. npx @northflank/cli login   (API token with project permissions)
#   2. Default payment method on Northflank account
#   3. GitHub repo linked in Northflank VCS settings
#   4. Copy .env.prod.example → .env.prod and fill secrets
#
# Usage:
#   cd infra/northflank && ./deploy.sh

set -euo pipefail

PROJECT_ID="${NORTHFLANK_PROJECT:-fintech}"
NF="npx @northflank/cli"
DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${DIR}/.env.prod"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy .env.prod.example and fill in secrets."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

require_var() {
  if [[ -z "${!1:-}" ]]; then
    echo "Required variable $1 is not set in $ENV_FILE"
    exit 1
  fi
}

require_var JWT_SECRET
require_var ENCRYPTION_KEY
require_var NEXTAUTH_SECRET

echo "==> Ensuring addons (postgres, redis)..."
$NF create addon --projectId "$PROJECT_ID" -f "$DIR/postgres.json" -o json 2>/dev/null || echo "  postgres already exists or skipped"
$NF create addon --projectId "$PROJECT_ID" -f "$DIR/redis.json" -o json 2>/dev/null || echo "  redis already exists or skipped"

echo "==> Waiting for addons to become ready (up to 5 min)..."
for i in $(seq 1 30); do
  PG_STATUS=$($NF get addon --projectId "$PROJECT_ID" --addonId postgres -o json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status','unknown'))" 2>/dev/null || echo "unknown")
  RD_STATUS=$($NF get addon --projectId "$PROJECT_ID" --addonId redis -o json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status','unknown'))" 2>/dev/null || echo "unknown")
  echo "  postgres=$PG_STATUS  redis=$RD_STATUS"
  if [[ "$PG_STATUS" == "running" && "$RD_STATUS" == "running" ]]; then
    break
  fi
  sleep 10
done

echo "==> Fetching addon credentials..."
PG_CREDS=$($NF get addon credentials --projectId "$PROJECT_ID" --addonId postgres -o json)
RD_CREDS=$($NF get addon credentials --projectId "$PROJECT_ID" --addonId redis -o json)

DATABASE_URL=$(echo "$PG_CREDS" | python3 -c "import sys,json; d=json.load(sys.stdin); env=d['data']['runtimeEnvironment']; print(env.get('DATABASE_URL') or env.get('NF_POSTGRES_DATABASE_URL',''))")
REDIS_URL=$(echo "$RD_CREDS" | python3 -c "import sys,json; d=json.load(sys.stdin); env=d['data']['runtimeEnvironment']; print(env.get('REDIS_URL') or env.get('NF_REDIS_URI',''))")

if [[ -z "$DATABASE_URL" || -z "$REDIS_URL" ]]; then
  echo "Could not resolve DATABASE_URL / REDIS_URL from addon credentials."
  echo "Set them manually in Northflank UI → addon → Connection details."
  exit 1
fi

echo "==> Creating internal services (ml, backtest)..."
$NF create service combined --projectId "$PROJECT_ID" -f "$DIR/ml.json" -o json 2>/dev/null || echo "  ml already exists"
$NF create service combined --projectId "$PROJECT_ID" -f "$DIR/backtest.json" -o json 2>/dev/null || echo "  backtest already exists"

echo "==> Creating API service..."
$NF create service combined --projectId "$PROJECT_ID" -f "$DIR/api.json" -o json 2>/dev/null || echo "  api already exists"

echo "==> Configuring API runtime environment..."
$NF update service runtime-environment --projectId "$PROJECT_ID" --serviceId api -i "$(cat <<EOF
{
  "runtimeEnvironment": {
    "NODE_ENV": "production",
    "PORT": "3001",
    "DATABASE_URL": "$DATABASE_URL",
    "REDIS_URL": "$REDIS_URL",
    "JWT_SECRET": "$JWT_SECRET",
    "JWT_REFRESH_SECRET": "${JWT_REFRESH_SECRET:-$JWT_SECRET}",
    "ENCRYPTION_KEY": "$ENCRYPTION_KEY",
    "ML_SERVICE_URL": "http://ml:8001",
    "BACKTEST_SERVICE_URL": "http://backtest:8002",
    "WEB_ORIGIN": "${WEB_ORIGIN:-}",
    "MARKET_DATA_PROVIDER": "${MARKET_DATA_PROVIDER:-alpaca}",
    "ALPACA_DATA_FEED": "${ALPACA_DATA_FEED:-iex}",
    "ALPACA_API_KEY": "${ALPACA_API_KEY:-}",
    "ALPACA_SECRET_KEY": "${ALPACA_SECRET_KEY:-}",
    "ALPACA_BASE_URL": "${ALPACA_BASE_URL:-https://paper-api.alpaca.markets}",
    "STRIPE_SECRET_KEY": "${STRIPE_SECRET_KEY:-sk_test_skipped}",
    "STRIPE_WEBHOOK_SECRET": "${STRIPE_WEBHOOK_SECRET:-whsec_skipped}",
    "STRIPE_PRICE_ID_BASIC": "${STRIPE_PRICE_ID_BASIC:-price_basic_skipped}",
    "STRIPE_PRICE_ID_PREMIUM": "${STRIPE_PRICE_ID_PREMIUM:-price_premium_skipped}",
    "DISABLE_WORKERS": "false"
  }
}
EOF
)" -o json

echo "==> Configuring ML + Backtest runtime environment..."
for SVC in ml backtest; do
  $NF update service runtime-environment --projectId "$PROJECT_ID" --serviceId "$SVC" -i "$(cat <<EOF
{
  "runtimeEnvironment": {
    "DATABASE_URL": "$DATABASE_URL"
  }
}
EOF
)" -o json
done

echo "==> Waiting for API public URL..."
sleep 15
API_URL=""
for i in $(seq 1 20); do
  API_URL=$($NF get service --projectId "$PROJECT_ID" --serviceId api -o json 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
ports = d.get('data', {}).get('ports', [])
for p in ports:
    domains = p.get('domains', [])
    if domains:
        print('https://' + domains[0]); break
" 2>/dev/null || true)
  if [[ -n "$API_URL" ]]; then break; fi
  sleep 10
done

if [[ -z "$API_URL" ]]; then
  echo "API URL not ready yet. Set WEB_ORIGIN / NEXT_PUBLIC_* manually after first deploy."
  API_URL="https://p01-api--${PROJECT_ID}.code.run"
fi

WS_URL="${API_URL/https/wss}"

echo "  API public URL: $API_URL"

echo "==> Creating Web service..."
$NF create service combined --projectId "$PROJECT_ID" -f "$DIR/web.json" -o json 2>/dev/null || echo "  web already exists"

echo "==> Configuring Web build args + runtime environment..."
$NF update service build-arguments --projectId "$PROJECT_ID" --serviceId web -i "$(cat <<EOF
{
  "buildArguments": {
    "NEXT_PUBLIC_API_URL": "$API_URL",
    "NEXT_PUBLIC_WS_URL": "$WS_URL"
  }
}
EOF
)" -o json

WEB_ORIGIN_FINAL="${WEB_ORIGIN:-}"
if [[ -z "$WEB_ORIGIN_FINAL" ]]; then
  WEB_ORIGIN_FINAL=$($NF get service --projectId "$PROJECT_ID" --serviceId web -o json 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
for p in d.get('data', {}).get('ports', []):
    domains = p.get('domains', [])
    if domains:
        print('https://' + domains[0]); break
" 2>/dev/null || echo "")
fi

$NF update service runtime-environment --projectId "$PROJECT_ID" --serviceId web -i "$(cat <<EOF
{
  "runtimeEnvironment": {
    "NODE_ENV": "production",
    "INTERNAL_API_URL": "http://api:3001",
    "NEXTAUTH_SECRET": "$NEXTAUTH_SECRET",
    "NEXTAUTH_URL": "${WEB_ORIGIN_FINAL:-$API_URL}"
  }
}
EOF
)" -o json

# Patch WEB_ORIGIN on API once web URL is known
if [[ -n "$WEB_ORIGIN_FINAL" ]]; then
  $NF update service runtime-environment --projectId "$PROJECT_ID" --serviceId api -i "$(cat <<EOF
{
  "runtimeEnvironment": {
    "WEB_ORIGIN": "$WEB_ORIGIN_FINAL"
  }
}
EOF
)" -o json
fi

echo ""
echo "Deploy triggered. Monitor builds in Northflank UI → project fintech."
echo "  Web:  check service 'web' ports tab for public URL"
echo "  API:  $API_URL"
