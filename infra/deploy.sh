#!/usr/bin/env bash
# One-shot single-host deploy for the whole platform.
#
# Usage (on the server, from the repo's infra/ directory):
#   ./deploy.sh
#
# Idempotent: builds images, generates any missing secrets in .env.prod,
# runs database migrations, then starts the full stack behind nginx:80.
set -euo pipefail

cd "$(dirname "$0")"

# Prefer the Docker Compose v2 plugin ("docker compose"); fall back to the
# standalone "docker-compose" binary if that's what the host has.
if docker compose version >/dev/null 2>&1; then
  COMPOSE_BIN=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_BIN=(docker-compose)
else
  echo "ERROR: neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 1
fi

COMPOSE="${COMPOSE_BIN[*]} -f docker-compose.prod.yml --env-file .env.prod"

# --- 1. Ensure .env.prod exists and has secrets ------------------------------
if [[ ! -f .env.prod ]]; then
  echo "==> Creating .env.prod from example"
  cp .env.prod.example .env.prod
fi

gen_hex() { openssl rand -hex 32; }
gen_b64() { openssl rand -base64 32 | tr -d '\n'; }

# Fill a KEY= line that is currently empty with a generated value.
fill_secret() {
  local key="$1" value="$2"
  if grep -qE "^${key}=$" .env.prod; then
    # Escape slashes/ampersands for sed replacement.
    local esc
    esc=$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')
    sed -i.bak "s/^${key}=$/${key}=${esc}/" .env.prod
    echo "==> Generated ${key}"
  fi
}

fill_secret POSTGRES_PASSWORD "$(gen_hex)"
fill_secret JWT_SECRET "$(gen_b64)"
fill_secret JWT_REFRESH_SECRET "$(gen_b64)"
fill_secret NEXTAUTH_SECRET "$(gen_b64)"
fill_secret ENCRYPTION_KEY "$(gen_hex)"
fill_secret GRAFANA_ADMIN_PASSWORD "$(gen_hex)"
rm -f .env.prod.bak

# --- 2. Build all images from source ----------------------------------------
echo "==> Building images"
$COMPOSE build

# --- 3. Bring up datastores first, then migrate -----------------------------
echo "==> Starting datastores"
$COMPOSE up -d postgres redis

echo "==> Waiting for Postgres to be healthy"
until [[ "$(docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q postgres)" 2>/dev/null)" == "healthy" ]]; do
  sleep 3
done

echo "==> Applying Prisma migrations"
$COMPOSE run --rm --no-deps --entrypoint sh api \
  -c "node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma || npx --no-install prisma migrate deploy --schema prisma/schema.prisma"

# --- 4. Start the rest of the stack -----------------------------------------
echo "==> Starting application services"
$COMPOSE up -d

# --- 5. Report ---------------------------------------------------------------
echo "==> Waiting for the API to report healthy"
for _ in $(seq 1 40); do
  if docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q api)" 2>/dev/null | grep -q healthy; then
    break
  fi
  sleep 3
done

echo
echo "==> Stack status"
$COMPOSE ps
echo
echo "Done. The platform is reachable on http://<server-ip>/ (nginx:80)."
echo "Grafana (metrics dashboards) is bound to \${GRAFANA_BIND_ADDR:-127.0.0.1}:3002 —"
echo "  reach it with: ssh -L 3002:127.0.0.1:3002 <user>@<server-ip>  then open http://localhost:3002"
echo "Enable TLS with infra/init-letsencrypt.sh (see infra/README-TLS.md)."
