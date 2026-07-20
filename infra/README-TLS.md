# Production TLS (Let's Encrypt)

The base stack (`docker-compose.prod.yml`) serves plain HTTP on port 80 so you
can deploy and verify before you own a domain. TLS is added by an **overlay**
(`docker-compose.tls.yml`) plus a one-time bootstrap script
(`init-letsencrypt.sh`) that provisions a real certificate with Let's Encrypt
using the HTTP-01 (webroot) challenge.

**No certificates, keys, or account data are ever committed.** They live only in
the `certbot-certs` Docker named volume on the server. The only committed TLS
artifact is `nginx/tls/app.conf.template`, into which the deploy renders your
public domain name (`nginx/tls/app.conf` is git-ignored).

## Prerequisites

1. A domain (e.g. `apexscan.example.com`) with a DNS **A/AAAA record** pointing
   at the server's public IP.
2. Ports **80 and 443** open to the internet (Let's Encrypt validates over 80).
3. `infra/.env.prod` populated (run `./deploy.sh` once first), with:

   ```
   DOMAIN=apexscan.example.com
   LETSENCRYPT_EMAIL=ops@example.com
   PUBLIC_ORIGIN=https://apexscan.example.com
   NEXTAUTH_URL=https://apexscan.example.com
   ```

## One-time issuance

From the `infra/` directory on the server:

```bash
./deploy.sh                 # builds images, brings up the HTTP stack
./init-letsencrypt.sh       # renders TLS config, obtains the certificate
```

`init-letsencrypt.sh`:

1. Renders `nginx/tls/app.conf` from the template with your `DOMAIN`.
2. Creates a throwaway self-signed cert so nginx can boot with a 443 listener.
3. Starts nginx (serving the ACME challenge from a shared webroot volume).
4. Runs certbot to obtain the real certificate, then reloads nginx.

> Tip: while testing DNS/firewall, run `STAGING=1 ./init-letsencrypt.sh` to hit
> Let's Encrypt's staging CA and avoid rate limits. Re-run without `STAGING`
> once it succeeds.

## Running with TLS + auto-renewal

Bring the stack up with both compose files so the `certbot` sidecar keeps
renewing and nginx reloads to pick up new certs:

```bash
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.tls.yml \
  --env-file .env.prod up -d
```

- **certbot** attempts `certbot renew` every 12h (a no-op until ~30 days before
  expiry).
- **nginx** reloads every 6h to load renewed certificates with zero downtime.
- Port 80 keeps serving the ACME challenge and 301-redirects everything else to
  HTTPS for the canonical domain.

## Alternative: terminate TLS upstream

If you already run an edge proxy or load balancer that terminates TLS (Cloudflare,
an ALB, Caddy, etc.), skip the overlay entirely: point it at the host's port 80
and set `PUBLIC_ORIGIN`/`NEXTAUTH_URL` to the `https://` origin. The app trusts
`X-Forwarded-Proto`, which nginx already forwards.

## Renewing / rotating manually

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml \
  --env-file .env.prod run --rm certbot certbot renew --force-renewal
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml \
  --env-file .env.prod exec nginx nginx -s reload
```
