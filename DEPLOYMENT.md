# Deployment

Cómo se deploya el sistema. Para arquitectura general ver
[`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## TL;DR

```bash
git push origin main          # → GH Actions → SSH al droplet → restart
bash verify_security.sh       # smoke test
```

---

## Infraestructura

| Componente   | Dónde / qué                                                       |
|--------------|-------------------------------------------------------------------|
| Host         | DigitalOcean droplet, plan $16/mo (2GB RAM / 1vCPU / 50GB SSD)    |
| IP           | `64.227.19.67`                                                    |
| OS           | Ubuntu 24.04 LTS                                                  |
| User         | `fiba` (passwordless sudo para `systemctl restart fiba-api`)      |
| Code path    | `/opt/fiba-nominations` (git working tree)                        |
| Python venv  | `/opt/fiba-nominations/venv`                                      |
| Frontend out | `/opt/fiba-nominations/dist` (servido por nginx)                  |
| Service unit | `/etc/systemd/system/fiba-api.service`                            |
| nginx site   | `/etc/nginx/sites-available/fiba-nominations`                     |
| TLS          | Let's Encrypt en `/etc/letsencrypt/live/www.fibaapp.com/`         |

---

## Pipeline (GitHub Actions)

`.github/workflows/deploy.yml`:

1. Trigger: `push` a `main` o `workflow_dispatch` manual
2. Setea SSH key desde el secret `DROPLET_SSH_KEY`
3. SSH al droplet (`fiba@${{ secrets.DROPLET_HOST }}`)
4. En el droplet, ejecuta:

```bash
cd /opt/fiba-nominations
git fetch origin main && git reset --hard origin/main

./venv/bin/pip install -r requirements.txt -q   # incluye gunicorn/uvicorn pinneados

set -a && . ./.env && set +a
npm ci --silent --no-audit --no-fund
npm run build

sudo systemctl restart fiba-api
sleep 2
sudo systemctl is-active fiba-api

curl -fsS -o /dev/null -w "HTTPS %{http_code}\n" \
  https://www.fibaapp.com/
```

5. Si algún paso falla, GH Action falla → notificación

Tiempo típico de deploy: **~90-120 segundos** (npm install + vite build
+ pip install + restart).

---

## Secrets de GitHub Actions

| Secret              | Para qué                                          |
|---------------------|---------------------------------------------------|
| `DROPLET_SSH_KEY`   | Clave privada SSH (autorizada en `~fiba/.ssh/authorized_keys`) |
| `DROPLET_HOST`      | IP o hostname del droplet                         |

Para rotar la clave SSH:

```bash
ssh-keygen -t ed25519 -f new_deploy_key -N ''
ssh fiba 'echo "$(cat new_deploy_key.pub)" >> ~/.ssh/authorized_keys'
# pegar el contenido de new_deploy_key (sin .pub) en GH Secrets
# luego borrar la clave vieja de ~/.ssh/authorized_keys
```

---

## Servicio (systemd)

```ini
# /etc/systemd/system/fiba-api.service
[Unit]
Description=FIBA Nominations API (FastAPI / gunicorn)
After=network.target

[Service]
Type=notify
User=fiba
Group=fiba
WorkingDirectory=/opt/fiba-nominations
EnvironmentFile=/opt/fiba-nominations/.env
ExecStart=/opt/fiba-nominations/venv/bin/gunicorn \
  -k uvicorn.workers.UvicornWorker \
  -w 2 \
  -b 127.0.0.1:8000 \
  --timeout 120 \
  --keep-alive 5 \
  --max-requests 500 \
  --max-requests-jitter 50 \
  --access-logfile - \
  --error-logfile - \
  api.index:app
Restart=always
RestartSec=3
MemoryMax=1200M
LimitNOFILE=65536
```

Comandos útiles:

```bash
sudo systemctl status fiba-api
sudo systemctl restart fiba-api
sudo systemctl reload fiba-api      # no funciona para gunicorn, usar restart
sudo journalctl -u fiba-api -n 100 --no-pager
sudo journalctl -u fiba-api -f      # follow
```

---

## nginx

`/etc/nginx/sites-available/fiba-nominations` (resumen):

```nginx
# HTTP → HTTPS (siempre)
server { listen 80; return 301 https://$host$request_uri; }

# Legacy domain → new domain
server {
  listen 443 ssl http2;
  server_name fibaamericascloud.com www.fibaamericascloud.com;
  return 301 https://fibaapp.com$request_uri;
}

# apex → www
server {
  listen 443 ssl http2;
  server_name fibaapp.com;
  return 301 https://www.fibaapp.com$request_uri;
}

# Main app
server {
  listen 443 ssl http2;
  server_name www.fibaapp.com;

  client_max_body_size 25M;

  # Security headers (HSTS, CSP, X-Frame-Options DENY, etc)
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
  # …

  # Static frontend
  root /opt/fiba-nominations/dist;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }

  # API proxy
  location /api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $proxy_scheme;
  }

  # Disclosure contact (RFC 9116)
  location = /.well-known/security.txt {
    alias /var/www/well-known/security.txt;
  }
}
```

Comandos útiles:

```bash
sudo nginx -t                       # validar config antes de reload
sudo systemctl reload nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## Fuentes de las cartas (LibreOffice)

Las cartas de nominación se convierten a PDF con `soffice --headless` en el
droplet. Las plantillas declaran Univers, IBM Plex Sans, Cochocib Script y
Titillium, y el droplet **no tiene ninguna**: sin más, fontconfig las reemplaza
por DejaVu Sans y la carta sale con los títulos partidos y la firma rota.

No hay nada que instalar en el sistema. `fonts/` viene en el repo con las
fuentes libres (IBM Plex Sans, IBM Plex Sans Condensed, PT Sans Narrow, Alex
Brush, Titillium Web) y un `fonts/fonts.conf` con los alias
(`Univers → Nimbus Sans`, `Cochocib Script → Alex Brush`, …).
`document_generator._convert_to_pdf_libreoffice()` lanza `soffice` con
`FONTCONFIG_FILE=/opt/fiba-nominations/fonts/fonts.conf`, así que el `git
reset --hard` del deploy alcanza para que la próxima conversión las use.

Para verificar en el droplet qué resuelve cada familia:

```bash
FONTCONFIG_FILE=/opt/fiba-nominations/fonts/fonts.conf fc-match "Univers"
FONTCONFIG_FILE=/opt/fiba-nominations/fonts/fonts.conf fc-match "Cochocib Script Latin Pro"
```

Si FIBA entrega las fuentes con licencia (Univers, Cochocib Script Latin Pro),
van a `/opt/fiba-nominations/fonts/private/` (gitignoreado, sobrevive al
deploy). Al estar presentes ganan sobre el sustituto sin tocar nada más. La
pantalla de Templates muestra por plantilla qué familia sale como está, cuál
sustituida y cuál falta.

---

## Environment variables (`/opt/fiba-nominations/.env`)

```bash
# Supabase
SUPABASE_URL=https://mckaplalscnvaanukrmz.supabase.co
SUPABASE_KEY=sb_publishable_…
SUPABASE_SERVICE_ROLE_KEY=sb_secret_…

# Frontend (Vite las inyecta en build)
VITE_SUPABASE_URL=https://mckaplalscnvaanukrmz.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_…
VITE_API_URL=/api

# CORS
CORS_ORIGINS=https://www.fibaapp.com,https://fibaapp.com

# CloudConvert — solo lo usa el export del training schedule
# (sin la key ese export sirve .docx; las cartas no la necesitan)
# CLOUDCONVERT_API_KEY=

# FIBA GDAP — sync de partidos/resultados/fechas y "Nuevas en FIBA".
# Primary key de https://gdap-portal.fiba.basketball/profile
GDAP_API_KEY=…
# Feed de la web de FIBA: respaldo del sync de partidos si falta la de GDAP
FIBA_API_KEY=…

# Google Calendar — sync de partidos al calendario de cada usuario (ver abajo).
# Sin las tres, la pestaña de Mi perfil dice "no configurado" y el cron no hace nada.
GOOGLE_OAUTH_CLIENT_ID=….apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=…
# Cifra los refresh tokens guardados. Generarla UNA vez con:
#   ./venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Cambiarla desconecta a todos (tienen que volver a conectar): no la rotes sin avisar.
GOOGLE_TOKEN_KEY=…
# Opcional: por defecto es $PUBLIC_APP_URL/google/callback (https://www.fibaapp.com/google/callback)
# GOOGLE_OAUTH_REDIRECT_URI=
```

Después de tocar `.env`, **reiniciar el servicio** (`sudo systemctl
restart fiba-api`).

### Google Calendar: setup en Google Cloud (una vez)

1. En https://console.cloud.google.com crear un proyecto (p.ej. "FIBA Americas
   App") y habilitar **Google Calendar API** (APIs & Services → Library).
2. **OAuth consent screen**: tipo *External*, nombre "FIBA Americas", dominio
   autorizado `fibaapp.com`, email de soporte. Scopes: `openid`, `email` y
   `https://www.googleapis.com/auth/calendar.app.created` (la app solo ve los
   calendarios que ella crea, no el principal de nadie).
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized redirect URIs:
   - `https://www.fibaapp.com/google/callback`
   - `http://localhost:5173/google/callback` (dev)
4. Pasar la app a **"In production"** (Publishing status). ⚠️ En *Testing*
   Google vence los refresh tokens **a los 7 días** y solo entran los test
   users: todos tendrían que reconectar cada semana. En producción sin
   verificar, Google muestra el aviso de "app no verificada" (Avanzado →
   continuar) y permite hasta 100 usuarios: alcanza para el equipo. La
   verificación formal es opcional.
5. **Antes del push** del código: aplicar a mano
   `supabase/migrations/052_google_calendar.sql` en Supabase (como todas las
   migraciones, CLAUDE.md punto 17).
6. Copiar client ID y secret al `.env` (arriba), generar `GOOGLE_TOKEN_KEY` y
   reiniciar `fiba-api`. Sin esas variables la pestaña dice "no configurado" y
   no toca la tabla.
7. Instalar el cron (cabecera de `scripts/google_calendar_sync.py`).

---

## TLS

Certificados Let's Encrypt para 4 SAN:

- `fibaapp.com`
- `www.fibaapp.com`
- `fibaamericascloud.com`
- `www.fibaamericascloud.com`

Renovación automática vía systemd timer:

```bash
sudo systemctl list-timers | grep certbot
sudo certbot renew --dry-run        # probar renew sin tocar nada
sudo certbot certificates           # ver expiraciones
```

---

## Rollback

Si un deploy rompe algo:

```bash
ssh fiba
cd /opt/fiba-nominations
git log --oneline -10                # encontrar el commit bueno
git reset --hard <commit-sha>
npm run build
sudo systemctl restart fiba-api
```

Para revertir en GitHub:

```bash
git revert <commit-sha>              # crea un revert commit
git push origin main                 # GH Actions deploya el revert
```

---

## Manual deploy (sin GH Actions)

Si GitHub Actions está caído:

```bash
ssh fiba
cd /opt/fiba-nominations
git fetch origin main && git reset --hard origin/main
./venv/bin/pip install -r requirements.txt
npm install && npm run build
sudo systemctl restart fiba-api
```

---

## Health checks

```bash
# Desde tu laptop:
curl -fsS https://www.fibaapp.com/                # SPA loads
curl -fsS https://www.fibaapp.com/api             # FastAPI health
bash verify_security.sh                            # full smoke test

# Desde el droplet:
ssh fiba sudo systemctl is-active fiba-api
ssh fiba sudo systemctl is-active nginx
```

---

## Monitoring

- **Logs API:** `journalctl -u fiba-api`
- **Logs nginx:** `/var/log/nginx/{access,error}.log`
- **Alertas de seguridad:** `/var/log/fiba-security-alerts.log`
  (poblado por cron `/etc/cron.d/fiba-security-scan` cada hora)
- **Keepalive Supabase:** `/var/log/fiba-supabase-keepalive.log`
  (cron diario `/etc/cron.d/fiba-supabase-keepalive` — evita el
  auto-pause del plan Free)
- **Sync con FIBA:** `/var/log/fiba-gdap-sync.log` (cron
  `/etc/cron.d/fiba-gdap-sync`: `--live` cada 15 min para las competencias en
  curso, `--all` a las 06:00 UTC). Instalación en la cabecera de
  `scripts/fiba_sync.py`. El último error de cada competencia queda además en
  `competitions.fiba_sync_error` y se ve en Competencias y en el Calendario.
- **Sync con Google Calendar:** `/var/log/fiba-google-calendar.log` (cron
  `/etc/cron.d/fiba-google-calendar`, minutos 5/20/35/50, después del `--live`
  de FIBA). Instalación en la cabecera de `scripts/google_calendar_sync.py`. El
  último error de cada usuario queda en `google_calendar_links.last_sync_error`
  y lo ve en Mi perfil → Google Calendar.
- **No hay alerting externo** (Sentry / Datadog) — pendiente
