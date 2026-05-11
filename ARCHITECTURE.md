# Arquitectura

Visión integral del sistema FIBA Americas. Para deploy específico ver
[`DEPLOYMENT.md`](DEPLOYMENT.md), para correr local ver
[`DEVELOPMENT.md`](DEVELOPMENT.md), para UI ver
[`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

---

## Diagrama

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (https://www.fibaapp.com)                              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS (Let's Encrypt)
                            ▼
            ┌───────────────────────────────┐
            │  nginx (DigitalOcean droplet) │
            │  - TLS termination            │
            │  - HSTS / CSP / X-Frame, etc. │
            │  - 301: legacy → fibaapp.com  │
            │  - serve /opt/.../dist/       │
            │  - /api/ → 127.0.0.1:8000     │
            └────────┬──────────────────┬───┘
                     │                  │
                     │ static files     │ /api/*
                     │                  ▼
                     │       ┌──────────────────────────┐
                     │       │ gunicorn (systemd unit   │
                     │       │   fiba-api.service)      │
                     │       │ - 2× uvicorn workers     │
                     │       │ - FastAPI app:           │
                     │       │   • auth middleware      │
                     │       │   • CORS                 │
                     │       │   • security headers     │
                     │       │   • module routers       │
                     │       └────────┬─────────────────┘
                     │                │
                     │                │ httpx (REST)
                     │                ▼
                     │       ┌────────────────────────────┐
                     │       │ Supabase                   │
                     │       │ - PostgreSQL + RLS         │
                     │       │ - Auth (JWT)               │
                     │       │ - Storage (private bucket  │
                     │       │   "nominations" + public   │
                     │       │   bucket "inventory")      │
                     │       └────────────────────────────┘
                     ▼
       SPA React 18 + Vite + Tailwind
```

---

## Frontend

### Entry / shell

- `src/main.jsx` — monta React con `<BrowserRouter>`, `LanguageProvider`,
  `AuthProvider`
- `src/App.jsx` — shell con:
  - Sidebar navy-900 con basketball-500 accent
  - Topbar con dark toggle
  - `Suspense` para lazy chunks
  - `PermissionGuard` por ruta

### Routing

React Router v6, todas las pages excepto Login + PublicAsset son
lazy-loaded (`React.lazy`). Cada page se sirve como un chunk vite
independiente — ver `vite.config.js` para los `manualChunks` que
separan `react-vendor`, `supabase`, `qrcode-scan`, `http`.

### Auth

- `src/contexts/AuthContext.jsx` — wrapper sobre Supabase Auth
- Al login, llama `getUserPermissions(userId)` → guarda `permissions`
  por módulo + `isSuperadmin` en el contexto
- `hasView(module)` / `hasEdit(module)` para checks declarativos

### i18n

- `src/i18n/LanguageContext.jsx` — almacena `lang` (`es` | `en`) en
  localStorage
- `t(key)` para traducir; tablas en `src/i18n/es.js` y `en.js`

### API client

- `src/api/client.js` — wrapper axios. Todas las requests pasan `Bearer
  <JWT>` automáticamente (interceptor `axios.interceptors.request.use`)
- **Downloads** son blob fetches que respetan auth (no `<a href>`):
  - `downloadNominationBlob(id, filename)`
  - `downloadTrainingPdf(type, params)`

### Design system

Tokens, componentes y migración cubiertos en
[`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

---

## Backend

### Entry (`api/index.py`)

- Crea `FastAPI()` app con docs/redoc deshabilitados (no exponer en prod)
- Middleware en orden:
  1. CORS (orígenes de `CORS_ORIGINS` env var)
  2. Security headers (X-Content-Type-Options, X-Frame-Options,
     Referrer-Policy, Permissions-Policy)
  3. `auth_middleware` — valida JWT con Supabase `/auth/v1/user`,
     guarda `request.state.user`
- Bypasses del auth middleware:
  - `OPTIONS` (CORS preflight)
  - `/api` y `""` (health checks)
  - `/api/public/*` (QR scan landing)
- **NO bypass para `/download` ni `/export/pdf`** — eso era el bug N1
  del pen-test, ya cerrado

### Routers (`api/_lib/routers/`)

Uno por módulo:

```
assets.py          competitions.py    games.py
availability.py    employees.py       loans.py
calendar.py        nominations.py     permissions.py
personnel.py       public_assets.py   training.py
transport.py
```

Cada router declara permisos vía dependencies:

```python
@router.get("", dependencies=[Depends(require_view("nominations"))])
def list_nominations(): ...

@router.post("", dependencies=[Depends(require_edit("nominations"))])
def create_nomination(...): ...

@router.delete("/{id}", dependencies=[Depends(require_superadmin)])
def delete_user(...): ...
```

### Auth dependencies (`api/_lib/auth.py`)

- `require_view(module)` — el user del JWT tiene `can_view=true`
  en `user_permissions` para ese módulo, o es superadmin
- `require_edit(module)` — análogo con `can_edit=true`
- `require_superadmin` — solo si está marcado en `user_permissions`
- Caché de superadmin status en `request.state._is_superadmin` para
  evitar hits repetidos a la DB dentro de la misma request

### DB client (`api/_lib/database.py`)

Cliente httpx liviano que habla con la REST API de Supabase
(`/rest/v1/...`). NO usamos `supabase-py` porque pesaba demasiado y
agregaba dependencias innecesarias. Service-role key en
`SUPABASE_SERVICE_ROLE_KEY` env var.

### PDF generation (`api/_lib/services/document_generator.py`)

- Render del `.docx` con `python-docx` usando templates en `templates/`
- Conversión a PDF con LibreOffice headless (`soffice --convert-to pdf`)
- Profile dir único por request (`--user-profile=/tmp/lo_<uuid>`)
  para evitar locks
- CloudConvert quedó como fallback pero no se usa (env var
  `CLOUDCONVERT_API_KEY` deshabilitada)

### Storage paths

Convención propia: `storage://nominations/<key>` se traduce a:

- `_extract_storage_key(path)` saca el key real
- `_delete_pdf_from_storage(path)` borra usando Storage API
  (NO `DELETE FROM storage.objects` — Supabase rechaza ese pattern)

---

## Base de datos (Supabase)

Proyecto: `mckaplalscnvaanukrmz`. Schema inicial en
`supabase/migrations/001_initial_schema.sql`.

### Tablas principales

| Tabla              | Para qué                                      |
|--------------------|-----------------------------------------------|
| `personnel`        | TDs y VGOs (oficiales nominables)             |
| `employees`        | Staff interno FIBA (para asignar inventario)  |
| `competitions`     | Torneos / eventos                             |
| `nominations`      | Cartas de nominación generadas                |
| `availability`     | Disponibilidad de TDs/VGOs                    |
| `vehicles` / `trips` | Transporte                                  |
| `training_*`       | Sesiones de training                          |
| `games`            | Partidos del calendario                       |
| `assets`           | Inventario (Macs, monitors, cámaras…)         |
| `loans`            | Préstamos de assets a employees               |
| `user_permissions` | `(user_id, module, can_view, can_edit, is_superadmin)` |

### RLS

Habilitado en todas las tablas con datos sensibles. Las policies son
defensivas — el anon role no lee nada por default. El backend usa la
service-role key, que **bypasea RLS**. Los checks de permisos están
en el backend (no en la DB) vía `require_view`/`require_edit`.

### Storage buckets

| Bucket         | Visibilidad | Uso                                      |
|----------------|-------------|------------------------------------------|
| `nominations`  | **privada** | PDFs/docs de nominación, training        |
| `inventory`    | pública     | Fotos de assets para PublicAsset (QR)    |

`nominations` solo se accede vía service_role en el backend. El
frontend pide blobs autenticados al endpoint `/api/nominations/{id}/download`.

---

## Seguridad

Resumen — detalles en `SECURITY_RUNBOOK.md`.

- 3 rondas de pen-test (H1-H9 + N1-N3 cerrados)
- nginx security headers: HSTS, CSP, X-Frame-Options DENY,
  Permissions-Policy, Referrer-Policy
- fail2ban + ufw, SSH passwordless key-only
- ufw bloquea IPs hostiles conocidas (13 ya añadidas)
- `/var/log/fiba-security-alerts.log` — scanner horario detecta:
  401-burst en /api/users, signup-burst, 4xx-burst,
  scanner-paths (.env, .git, .aws), download-enum
- `.well-known/security.txt` con disclosure contact

---

## Servicios externos

| Servicio       | Para qué                                              |
|----------------|-------------------------------------------------------|
| Supabase       | DB + Auth + Storage                                   |
| FIBA Sync      | Microservicio en `services/fiba_sync.py` que sincroniza datos upstream desde FIBA |
| Let's Encrypt  | TLS para fibaapp.com + fibaamericascloud.com (4 SAN)  |

CloudConvert **NO** se usa en prod (reemplazado por LibreOffice local).
