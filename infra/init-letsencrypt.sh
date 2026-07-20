#!/usr/bin/env bash
# First-time Let's Encrypt issuance for the production stack (nginx + certbot,
# HTTP-01 webroot flow). Idempotent-ish: safe to re-run; it will ask before
# replacing an existing certificate.
#
# Prereqs on the server:
#   - DNS A/AAAA record for $DOMAIN points at this host.
#   - Ports 80 and 443 reachable from the internet.
#   - infra/.env.prod contains DOMAIN and LETSENCRYPT_EMAIL.
#
# Usage (from infra/):
#   ./init-letsencrypt.sh
#
# After success, bring the stack up with the TLS overlay:
#   docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml --env-file .env.prod up -d
set -euo pipefail

cd "$(dirname "$0")"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_BIN=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_BIN=(docker-compose)
else
  echo "ERROR: neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 1
fi

ENV_FILE=.env.prod
[[ -f "$ENV_FILE" ]] || { echo "ERROR: $ENV_FILE not found. Run deploy.sh first." >&2; exit 1; }

# Read DOMAIN / LETSENCRYPT_EMAIL without leaking other secrets into the shell.
DOMAIN=$(grep -E '^DOMAIN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '[:space:]')
LETSENCRYPT_EMAIL=$(grep -E '^LETSENCRYPT_EMAIL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '[:space:]')
STAGING=${STAGING:-0}   # set STAGING=1 to use Let's Encrypt's staging CA while testing

if [[ -z "$DOMAIN" || -z "$LETSENCRYPT_EMAIL" ]]; then
  echo "ERROR: set DOMAIN and LETSENCRYPT_EMAIL in $ENV_FILE first." >&2
  exit 1
fi

COMPOSE=("${COMPOSE_BIN[@]}" -f docker-compose.prod.yml -f docker-compose.tls.yml --env-file "$ENV_FILE")

echo "==> Rendering nginx TLS config for ${DOMAIN}"
export DOMAIN
mkdir -p nginx/tls
# Only substitute ${DOMAIN}; leave nginx runtime vars ($host, $scheme, ...) intact.
envsubst '${DOMAIN}' < nginx/tls/app.conf.template > nginx/tls/app.conf

cert_path="/etc/letsencrypt/live/${DOMAIN}"

echo "==> Creating a temporary self-signed certificate so nginx can start"
"${COMPOSE[@]}" run --rm --entrypoint "\
  sh -c 'mkdir -p ${cert_path} && \
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout ${cert_path}/privkey.pem \
      -out ${cert_path}/fullchain.pem \
      -subj \"/CN=${DOMAIN}\"'" certbot

echo "==> Starting nginx with the temporary certificate"
"${COMPOSE[@]}" up -d nginx

echo "==> Removing the temporary certificate"
"${COMPOSE[@]}" run --rm --entrypoint "rm -rf ${cert_path}" certbot

staging_flag=""
[[ "$STAGING" != "0" ]] && staging_flag="--staging"

echo "==> Requesting the real Let's Encrypt certificate"
"${COMPOSE[@]}" run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    ${staging_flag} \
    -d ${DOMAIN} \
    --email ${LETSENCRYPT_EMAIL} \
    --rsa-key-size 2048 \
    --agree-tos \
    --non-interactive \
    --force-renewal" certbot

echo "==> Reloading nginx with the issued certificate"
"${COMPOSE[@]}" exec nginx nginx -s reload

echo
echo "Done. https://${DOMAIN} is now served with a Let's Encrypt certificate."
echo "Bring the full stack up with the TLS overlay to keep certbot renewing:"
echo "  ${COMPOSE_BIN[*]} -f docker-compose.prod.yml -f docker-compose.tls.yml --env-file .env.prod up -d"
