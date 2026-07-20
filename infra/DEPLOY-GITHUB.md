# GitHub full-stack deploy (Oracle Free VPS)

En kolay tam stack yolu: **GitHub Actions → SSH → Docker Compose** (`infra/docker-compose.prod.yml`).

## 1. Oracle Cloud Always Free VM

1. [cloud.oracle.com](https://cloud.oracle.com) → Create VM (Ubuntu 22.04/24.04, Ampere ARM, 4 OCPU / 24 GB RAM).
2. Security list: inbound **TCP 80** (ve isteğe bağlı 443).
3. SSH ile bağlan: `ssh ubuntu@<PUBLIC_IP>` (veya `opc@...` Oracle Linux ise).

## 2. Sunucuda bootstrap (tek sefer)

```bash
curl -fsSL https://raw.githubusercontent.com/umuttanhediyeler/trading-platform/main/infra/scripts/vps-bootstrap.sh | bash
```

Bu script Docker kurar, repoyu `/opt/trading-platform` altına klonlar, `.env.prod` oluşturur ve `./deploy.sh` çalıştırır.

Manuel düzenleme (Alpaca, domain vb.):

```bash
nano /opt/trading-platform/infra/.env.prod
# PUBLIC_ORIGIN, ALPACA_*, GOOGLE_* ...
cd /opt/trading-platform/infra && ./deploy.sh
```

Site: `http://<PUBLIC_IP>/`

## 3. GitHub Actions otomatik deploy

GitHub repo → **Settings → Secrets and variables → Actions**

### Secrets

| Name | Value |
|------|--------|
| `PRODUCTION_HOST` | VPS public IP |
| `PRODUCTION_USER` | `ubuntu` (veya `opc`) |
| `PRODUCTION_SSH_KEY` | Deploy için private SSH key (PEM) |

Deploy key oluşturma (lokal):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/trading-deploy -N ""
cat ~/.ssh/trading-deploy.pub   # VPS'e authorized_keys'e ekle
cat ~/.ssh/trading-deploy       # GitHub secret PRODUCTION_SSH_KEY
```

VPS'te:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<public-key>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### Variables

| Name | Value |
|------|--------|
| `PRODUCTION_DEPLOY_ENABLED` | `true` |
| `PRODUCTION_APP_PATH` | `/opt/trading-platform` |

### Environment (opsiyonel)

**Settings → Environments → production** oluşturup deploy onayı ekleyebilirsin.

## 4. Akış

Her `main` push'ta:

1. CI (lint, test, build) çalışır
2. Başarılıysa SSH ile VPS'e bağlanır
3. `git pull` + `infra/deploy.sh`
4. `http://<server>/api/health` smoke check

Manuel deploy: **Actions → Deploy production → Run workflow**

## 5. TLS (opsiyonel)

Domain DNS'i VPS IP'ye yönlendir, sonra `infra/README-TLS.md` ve `init-letsencrypt.sh`.

## Sorun giderme

```bash
cd /opt/trading-platform/infra
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs api --tail 100
curl -s http://127.0.0.1/api/health
```
