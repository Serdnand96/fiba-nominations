# CLAUDE.md — Onboarding para sesiones de IA

> Leé este archivo primero si arrancás una sesión nueva sobre este repo.
> Acá está el contexto crítico para no caminar a tientas.

---

## TL;DR

Sistema admin de FIBA Americas para nominaciones de oficiales (TDs, VGOs),
training, transport, inventory, etc. Stack:

- **Frontend:** React + Vite + Tailwind, deployado como SPA estático
- **Backend:** FastAPI (Python 3.11) con gunicorn + uvicorn workers
- **DB + Auth + Storage:** Supabase (proyecto `mckaplalscnvaanukrmz`)
- **Hosting:** **DigitalOcean droplet** (NO Vercel — ver más abajo)
- **CI/CD:** GitHub Actions → SSH deploy al droplet

Dominio prod: **https://www.fibaapp.com** (con redirect 301 desde el
legacy `fibaamericascloud.com`).

---

## ⚠️ Cosas que confunden a sesiones nuevas

1. **NO está en Vercel.** Hay un `vercel.json` y `.vercel/` legacy, pero
   no son la fuente de verdad. El deploy real es al droplet DO.
   La migración a DO se completó en abril 2026.

2. **PDF generation usa LibreOffice local**, no CloudConvert. El droplet
   tiene `soffice` instalado y `api/_lib/services/document_generator.py`
   lo usa. CloudConvert quedó como fallback opcional pero deshabilitado
   en prod.

3. **Hay dos tablas distintas para personas:**
   - `personnel` → TDs / VGOs (oficiales que se nominan)
   - `employees` → staff interno de FIBA (no se nomina, solo aparece en
     inventario para asignar activos)

4. **`storage://nominations/X` paths** son una convención propia para
   referirse a objects en el bucket privado `nominations` de Supabase
   Storage. El backend los convierte a URLs autenticadas; el frontend
   nunca debe construir URLs públicas porque el bucket es privado.

5. **El frontend descarga PDFs vía blob + JWT**, no via `<a href>` con
   URL pública. La función está en `src/api/client.js`
   (`downloadNominationBlob`, `downloadTrainingPdf`).

6. **CSS variables hacen los tokens `fiba-*` dark-aware.** No es
   Tailwind nativo — ver `DESIGN_SYSTEM.md`. Si tocás colores, leelo
   primero.

---

## 🗺️ Mapa del repo

```
fiba-nominations/
├── CLAUDE.md                  ← este archivo
├── README.md                  ← overview general
├── ARCHITECTURE.md            ← sistema completo
├── DEPLOYMENT.md              ← GH Actions → droplet
├── DEVELOPMENT.md             ← correr local
├── DESIGN_SYSTEM.md           ← tokens / componentes UI
├── SECURITY_RUNBOOK.md        ← acciones manuales pendientes (Supabase, DNS)
│
├── api/                       ← FastAPI backend
│   ├── index.py               ← entry, middleware, mounting routers
│   └── _lib/
│       ├── auth.py            ← require_view, require_edit dependencies
│       ├── database.py        ← lightweight supabase client (httpx)
│       ├── routers/           ← uno por módulo (nominations, training, …)
│       └── services/
│           └── document_generator.py  ← docx → pdf via LibreOffice
│
├── src/                       ← React frontend
│   ├── App.jsx                ← shell (sidebar + topbar + router)
│   ├── pages/                 ← una por ruta
│   ├── components/
│   │   ├── ui/                ← Button, Input, Table, … (DS primitivos)
│   │   ├── layout/            ← Sidebar, Topbar, AppShell
│   │   └── brand/             ← Logo.jsx (Monogram, Wordmark, …)
│   ├── lib/icons.jsx          ← Tabler icons
│   ├── contexts/              ← Auth, Language
│   └── i18n/                  ← ES + EN
│
├── public/favicon.svg         ← monograma F + basketball seam
├── scripts/
│   └── fiba-security-scan.sh  ← scanner horario de nginx logs (corre en droplet)
├── services/
│   └── fiba_sync.py           ← microservicio aparte (sync con FIBA upstream)
├── supabase/migrations/       ← schema SQL
├── verify_security.sh         ← smoke test post-deploy
├── .github/workflows/deploy.yml  ← CI/CD
└── tailwind.config.js         ← tokens del DS
```

---

## 🔑 Cuentas / dónde están las cosas

| Servicio        | Dónde                                                              |
|-----------------|--------------------------------------------------------------------|
| Repo            | `Serdnand96/fiba-nominations` (GitHub)                             |
| Droplet         | `ssh fiba` (alias en `~/.ssh/config`) → `64.227.19.67`             |
| Code en droplet | `/opt/fiba-nominations` (owner: `fiba` user)                       |
| Supabase        | proyecto `mckaplalscnvaanukrmz`                                    |
| Domain          | GoDaddy (DNS), Let's Encrypt (TLS)                                 |
| GH Actions secrets | `DROPLET_SSH_KEY`, `DROPLET_HOST`                                |
| Service prod    | `systemctl status fiba-api` (gunicorn → 127.0.0.1:8000)            |
| nginx config    | `/etc/nginx/sites-available/fiba-nominations`                      |

---

## 🚀 Comandos clave

```bash
# ── Deploy (es automático en push a main, pero también manual): ──
git push origin main
# → GH Actions tira ssh fiba, git pull, pip install, npm build, restart fiba-api

# ── Ver el deploy en marcha: ──
gh run watch                # último workflow

# ── Smoke test después de un deploy: ──
bash verify_security.sh

# ── Logs del API: ──
ssh fiba sudo journalctl -u fiba-api -n 100 --no-pager

# ── Logs de nginx: ──
ssh fiba sudo tail -f /var/log/nginx/access.log
ssh fiba sudo tail -f /var/log/nginx/error.log

# ── Alertas de seguridad: ──
ssh fiba sudo tail -f /var/log/fiba-security-alerts.log

# ── Restart manual: ──
ssh fiba sudo systemctl restart fiba-api && sleep 2 && \
  ssh fiba sudo systemctl is-active fiba-api

# ── Dev local (frontend + backend + fiba-sync): ──
npm run dev                 # vite + fiba-sync en paralelo
# y aparte:
./venv/bin/uvicorn api.index:app --reload --port 8000
```

---

## 🧭 Convenciones del proyecto

### Backend (FastAPI)

- **Auth middleware** (en `api/index.py`) valida JWT contra Supabase
  `/auth/v1/user`. Bypasses solo para: OPTIONS, `/api`, `/api/public/*`.
  Endpoints `/download` y `/export/pdf` **requieren auth** (pen-test N1).

- **Permisos por módulo** vía dependencies `require_view("X")` /
  `require_edit("X")` (de `api/_lib/auth.py`). El check pega a la
  tabla `user_permissions` con cache por request en
  `request.state._is_superadmin`.

- **Storage path normalization** (`api/_lib/routers/nominations.py` →
  `_extract_storage_key()`) maneja 3 formatos: `storage://nominations/X`,
  `/storage/v1/object/public/nominations/X`, `/storage/v1/object/nominations/X`.

### Frontend (React)

- **Lazy-load todas las pages**: `const X = lazy(() => import('./pages/X'))`.
  Vite genera un chunk por pagina.

- **Vendor chunking** definido en `vite.config.js`: `react-vendor`,
  `supabase`, `qrcode-scan`, `http`.

- **Permission guards** envuelven cada ruta: `<PermissionGuard module="X">`
  redirige a 403 si no hay `can_view`.

- **i18n** vía `useLanguage()` (ES por default, switch en sidebar).

- **Modo oscuro** vía `.dark` en `<html>`, persistido en
  `localStorage.fiba_dark`. Default actual: dark (ver
  `DESIGN_SYSTEM.md` para por qué).

### Git / commits

- Convención: **type prefix** (`feat:`, `fix:`, `docs:`, `design:`,
  `ops:`, `security:`) + descripción corta + cuerpo opcional con
  detalles. Ver `git log` para el patrón.

- **No amend** — siempre commits nuevos (pre-commit hooks pueden
  fallar y dejar el repo en estado raro).

- **No push --force a main.** Si hay que reescribir historia, en
  branch nuevo.

---

## 🩺 Cómo está la salud del sistema

Pen-test cerrado en mayo 2026 (3 rondas). H1-H9 + N1, N2, N3 cerrados.
Pendientes manuales (ver `SECURITY_RUNBOOK.md`):

- **N4** (HTTP 500 → 400 en filter de dominio) — necesita Supabase Pro
- **N5/N6** (SPF/DMARC/CAA en `fibaamericascloud.com`) — pendiente
- **N7** (Cloudflare WAF + ocultar IP origen) — decisión pendiente
- **N8** (rate limits en Supabase Auth) — pendiente

Hay scanner horario corriendo en `/var/log/fiba-security-alerts.log`
(via cron `/etc/cron.d/fiba-security-scan`).

---

## 🎨 Trabajo de UI / diseño

Hay un **design system completo** activo desde mayo 2026:
- Navy (`#0c2340`) + basketball orange (`#F57C2A`) + ink neutrals
- IBM Plex Sans + IBM Plex Mono
- Componentes en `src/components/{ui,layout,brand}/`
- Iconos Tabler en `src/lib/icons.jsx`

**Antes de tocar colores/clases, leer `DESIGN_SYSTEM.md`.** Tiene la
explicación del truco de CSS variables para los aliases legacy
`fiba-*` que los hace dark-aware sin tocar JSX.

---

## 🎯 Si te piden algo

- **"Agregá un módulo nuevo"** → router en `api/_lib/routers/X.py`,
  mount en `api/index.py`, página en `src/pages/X.jsx`, ruta en
  `App.jsx`, icono en el map `moduleIcon`, permiso en `user_permissions`.

- **"Cambiá el deploy"** → modificá `.github/workflows/deploy.yml`. Hay
  un user en el droplet llamado `fiba` con clave SSH agregada via
  `DROPLET_SSH_KEY` secret.

- **"Probá un cambio en el droplet"** → `ssh fiba`, navegá a
  `/opt/fiba-nominations`, podés correr el venv directamente con
  `./venv/bin/python` o reiniciar el servicio.

- **"Hay algo lento"** → `ssh fiba sudo journalctl -u fiba-api`,
  buscar P99 en gunicorn logs. La DB es Supabase Free → puede tener
  rate limits.

---

## 🚫 Cosas que NO hacer

- ❌ Asumir que está en Vercel (ya no — droplet DO).
- ❌ Llamar al bucket `nominations` como público (es privado, siempre
  vía service_role en el backend).
- ❌ Generar PDFs llamando a CloudConvert (deshabilitado; usar
  LibreOffice local via `document_generator.py`).
- ❌ Borrar registros directamente con SQL si tocan storage — usar
  el endpoint que llama a Storage API (`_delete_pdf_from_storage`).
- ❌ Confundir `personnel` con `employees` (TDs/VGOs vs staff interno).
