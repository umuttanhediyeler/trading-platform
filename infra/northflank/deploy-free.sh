#!/usr/bin/env bash
# Free-tier Northflank deploy: external GHCR images, no Git/Dockerfile builds.
#
# Prerequisites:
#   1. npx @northflank/cli login
#   2. GitHub Actions "Publish Docker images" workflow has run at least once
#   3. GHCR packages set to public (see below)
#   4. infra/northflank/.env.prod filled
#
# Make GHCR packages public (one-time, after first CI run):
#   gh api -X PATCH /users/umuttanhediyeler/packages/container/trading-platform-api/visibility -f visibility=public
#   gh api -X PATCH /users/umuttanhediyeler/packages/container/trading-platform-web/visibility -f visibility=public
#
# Usage: cd infra/northflank && ./deploy-free.sh

set -euo pipefail

PROJECT_ID="${NORTHFLANK_PROJECT:-fintech}"
NF="npx @northflank/cli"
DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${DIR}/.env.prod"
API_IMAGE="${API_IMAGE:-ghcr.io/umuttanhediyeler/trading-platform-api:latest}"
WEB_IMAGE="${WEB_IMAGE:-ghcr.io/umuttanhediyeler/trading-platform-web:latest}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

echo "==> Fetching Postgres credentials..."
PG_CREDS=$($NF get addon credentials --projectId "$PROJECT_ID" --addonId postgres -o json)
DATABASE_URL=$(echo "$PG_CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['envs']['POSTGRES_URI'])")

API_ENV=$(python3 - <<PY
import json, os
print(json.dumps({"runtimeEnvironment": {
  "NODE_ENV": "production",
  "PORT": "3001",
  "DATABASE_URL": "$DATABASE_URL",
  "REDIS_URL": "redis://redis:6379",
  "JWT_SECRET": os.environ.get("JWT_SECRET", ""),
  "JWT_REFRESH_SECRET": os.environ.get("JWT_REFRESH_SECRET") or os.environ.get("JWT_SECRET", ""),
  "ENCRYPTION_KEY": os.environ.get("ENCRYPTION_KEY", ""),
  "ML_SERVICE_URL": "http://localhost:8001",
  "BACKTEST_SERVICE_URL": "http://localhost:8002",
  "WEB_ORIGIN": os.environ.get("WEB_ORIGIN", ""),
  "MARKET_DATA_PROVIDER": os.environ.get("MARKET_DATA_PROVIDER", "alpaca"),
  "ALPACA_DATA_FEED": os.environ.get("ALPACA_DATA_FEED", "iex"),
  "ALPACA_API_KEY": os.environ.get("ALPACA_API_KEY", ""),
  "ALPACA_SECRET_KEY": os.environ.get("ALPACA_SECRET_KEY", ""),
  "ALPACA_BASE_URL": os.environ.get("ALPACA_BASE_URL", "https://paper-api.alpaca.markets"),
  "DISABLE_WORKERS": "true",
}}))
PY
)

echo "==> Configuring API service (trading-platform) to pull $API_IMAGE ..."
$NF patch service deployment --projectId "$PROJECT_ID" --serviceId trading-platform -i "$(python3 - <<PY
import json
print(json.dumps({
  "deployment": {
    "instances": 1,
    "external": {"imagePath": "$API_IMAGE"},
    "docker": {"configType": "default"},
    "storage": {"ephemeralStorage": {"storageSize": 1024}}
  }
}))
PY
)" -o json 2>/dev/null || echo "  patch deployment skipped (may need UI update)"

$NF update service runtime-environment --projectId "$PROJECT_ID" --serviceId trading-platform -i "$API_ENV" -o json

echo "==> Creating/updating Web deployment service..."
$NF create service deployment --projectId "$PROJECT_ID" -f "$DIR/web-deployment.json" -o json 2>/dev/null \
  || $NF patch service deployment --projectId "$PROJECT_ID" --serviceId web -i "$(python3 - <<PY
import json
print(json.dumps({"deployment": {"instances": 1, "external": {"imagePath": "$WEB_IMAGE"}, "docker": {"configType": "default"}}}))
PY
)" -o json

sleep 5
API_URL=$($NF get service --projectId "$PROJECT_ID" --serviceId trading-platform -o json 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
for p in d.get('data',d).get('ports',[]):
  if p.get('public') and p.get('dns'):
    print('https://'+p['dns']); break
" 2>/dev/null || echo "")

WEB_URL=$($NF get service --projectId "$PROJECT_ID" --serviceId web -o json 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
for p in d.get('data',d).get('ports',[]):
  if p.get('public') and p.get('dns'):
    print('https://'+p['dns']); break
" 2>/dev/null || echo "")

if [[ -n "$WEB_URL" ]]; then
  $NF update service runtime-environment --projectId "$PROJECT_ID" --serviceId trading-platform -i "$(python3 - <<PY
import json
print(json.dumps({"runtimeEnvironment": {"WEB_ORIGIN": "$WEB_URL"}}))
PY
)" -o json 2>/dev/null || true

  $NF update service runtime-environment --projectId "$PROJECT_ID" --serviceId web -i "$(python3 - <<PY
import json
print(json.dumps({"runtimeEnvironment": {
  "NODE_ENV": "production",
  "INTERNAL_API_URL": "http://trading-platform:3001",
  "NEXTAUTH_SECRET": "$NEXTAUTH_SECRET",
  "NEXTAUTH_URL": "$WEB_URL"
}}))
PY
)" -o json
fi

echo ""
echo "Free-tier deploy applied."
echo "  API:  ${API_URL:-check Northflank UI → trading-platform}"
echo "  Web:  ${WEB_URL:-check Northflank UI → web}"
echo ""
echo "If images fail to pull, run GitHub Actions workflow 'Publish Docker images'"
echo "and set GHCR packages to public."
