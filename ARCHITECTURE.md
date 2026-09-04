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
  - La ruta `/` redirige al **primer módulo visible** del sidebar
    (`defaultRoute`): si el usuario tiene `feed`, entra por el Muro.
  - Clic en el usuario del sidebar abre el modal **Mi perfil**
    (`src/components/ProfileModal.jsx`): foto o avatar ilustrado
    (`src/lib/avatars.js`, DiceBear cargado con `import()`).

### Routing

React Router v6, todas las pages excepto Login + PublicAsset son
lazy-loaded (`React.lazy`). Cada page se sirve como un chunk vite
independiente — ver `vite.config.js` para los `manualChunks` que
separan `react-vendor`, `supabase`, `qrcode-scan`, `http`. El chunk
`avatars` (DiceBear) solo se baja al abrir la pestaña Avatar de Mi perfil.

Rutas públicas (sin login, el token o el id es la credencial):

| Ruta frontend            | Endpoint backend                    | Para qué                                |
|--------------------------|-------------------------------------|-----------------------------------------|
| `/asset/:id`             | `/api/public/assets/…`              | Landing del QR de un activo             |
| `/availability/:token`   | `/api/public/availability/…`        | Autoservicio de disponibilidad          |
| `/logistica/:token`      | `/api/public/logistics/…`           | Logística completa de una competencia   |
| `/checklist/:token`      | `/api/public/checklists/…`          | Control de sede por partido (**escribe**) |

### Módulos compartidos (`src/lib/`)

- `competitions.js` — registro único de tipos de competencia
  (`COMPETITION_TYPES`, debe coincidir con el CHECK de la migración 042) y
  el nombre para mostrar con año, porque hay pares con `name` idéntico.
- `warRoom.js` — hora del war room de Miami (`WAR_ROOM_TZ`) a partir de
  `game_schedule.datetime_utc`.
- `refereeNeutrality.js` — reglas de neutralidad arbitral del lado UI.
- `avatars.js` — estilos DiceBear y render a PNG para el avatar de perfil.

### Auth

- `src/contexts/AuthContext.jsx` — wrapper sobre Supabase Auth
- Al login, llama `getUserPermissions(userId)` → guarda `permissions`
  por módulo + `isSuperadmin` en el contexto
- `hasView(module)` / `hasEdit(module)` para checks declarativos

### i18n

- `src/i18n/LanguageContext.jsx` — almacena `lang` (`es` | `en`) en
  localStorage (`fiba-lang`)
- `t(key)` para traducir; una sola tabla en `src/i18n/translations.js`
  con `{ en, es }` por key

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
  - `/api/public/*` (QR scan, disponibilidad autoservicio, logística pública
    y checklists de sede), con rate limit por IP y `X-Robots-Tag: noindex`
- **NO bypass para `/download` ni `/export/pdf`** — eso era el bug N1
  del pen-test, ya cerrado
- Después del auth hay un handler que traduce errores de Postgres
  (violaciones de CHECK, FK, largo de columna) a **4xx con mensaje
  genérico**; el detalle queda en el log del servidor

### Routers (`api/_lib/routers/`)

Uno por módulo:

```
activity.py        evaluations.py     personnel.py           public_logistics.py
assets.py          feed.py            profile.py             reports.py
availability.py    games.py           public_assets.py       staffing.py
budget.py          loans.py           public_availability.py templates.py
calendar.py        logistics.py       public_checklists.py   training.py
checklists.py      nominations.py                            transport.py
competitions.py    payments.py                               users.py
employees.py       permissions.py
```

Prefijos que no coinciden con el nombre del permiso (los que confunden):

| Router           | Prefijo            | Permiso                                   |
|------------------|--------------------|-------------------------------------------|
| `transport.py`   | `/api/transport`   | `logistics` (Transporte es una sección)   |
| `staffing.py`    | `/api/staffing`    | `games` (Staffing Plan, panel de Games)   |
| `checklists.py`  | `/api/checklists`  | `games` (Control de operación)            |
| `profile.py`     | `/api/me`          | ninguno: `require_user`, lo propio del logueado |
| `feed.py`        | `/api/feed`        | `feed` — `can_view` participa, `can_edit` modera |
| `activity.py`    | `/api/activity`    | solo superadmin                           |

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
- `require_superadmin` — solo si `user_profiles.is_superadmin`
- `require_user` — cualquier usuario logueado (401 si no hay); lo usa
  `/api/me`
- `has_view(request, module)` / `has_edit(request, module)` — las
  variantes bool, para permisos que recortan datos en vez de cerrar el
  endpoint (`comp_days` en employees, moderación del Muro)
- Caché de superadmin status en `request.state._is_superadmin` para
  evitar hits repetidos a la DB dentro de la misma request

**Budget es la excepción al modelo "un permiso abre el endpoint entero":**
filtra por fila según `budget_access` (departamentos) vía `_scoped()` en
cada query del router. Ver `BUDGET_MODULE.md` y el punto 16 de `CLAUDE.md`.

### DB client (`api/_lib/database.py`)

Cliente httpx liviano que habla con la REST API de Supabase
(`/rest/v1/...`). NO usamos `supabase-py` porque pesaba demasiado y
agregaba dependencias innecesarias. Service-role key en
`SUPABASE_SERVICE_ROLE_KEY` env var.

### PDF generation (`api/_lib/services/document_generator.py`)

- Render del `.docx` con `docxtpl` (placeholders Jinja2) usando templates
  en `templates/`
- Conversión a PDF con LibreOffice headless (`soffice --convert-to pdf`)
- Profile dir único por request (`-env:UserInstallation=file://<tmpdir>`)
  para evitar locks
- CloudConvert quedó como fallback deshabilitado **para las cartas**.
  Ojo: el export del training schedule (`api/_lib/routers/training.py`)
  es un camino aparte — arma el `.docx` con `python-docx` y convierte a
  PDF solo vía CloudConvert (sin `CLOUDCONVERT_API_KEY`, sirve el `.docx`)

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
| `vehicles` / `trips` | Transporte (sección de Logística)           |
| `logistics_*`        | Padrón, manifest, hospedaje, comidas, links |
| `training_*`       | Sesiones de training                          |
| `games`            | Partidos del calendario                       |
| `assets`           | Inventario (Macs, monitors, cámaras…)         |
| `loans`            | Préstamos de assets a employees               |
| `competition_assignments` | Crew del torneo (fee `tournament`); `game_assignments` es por partido |
| `competition_staffing` | Staffing Plan: empleados FIBA en un evento (no se nominan) |
| `game_schedule`    | `datetime_utc` del partido (ancla para zonas horarias) |
| `checklist_templates` / `game_checklists` / `game_checklist_items` | Control de sede por partido; `checklist_public_links` da el token público |
| `payments` + `payment_*` | Pagos (1:1 con `nominations`), budgets, adjuntos |
| `departments` / `accounts` / `budget_lines` / `expenses` / `recurring_expenses` / `revenues` / `vendors` / `fee_schedule` / `budget_access` | Módulo Budget (migraciones 033-041) |
| `competition_reports` / `staff_evaluations` | Reportes de competencia y evaluaciones |
| `feed_posts` / `feed_comments` / `feed_reactions` / `feed_poll_votes` | El Muro (migración 043) |
| `activity_log`     | Auditoría de acciones (vista Activity, superadmin) |
| `user_permissions` | `(user_id, module, can_view, can_edit)`       |
| `user_profiles`    | Flag `is_superadmin` + `avatar_url` (migración 044) |

Las migraciones **no** se aplican en el deploy: se corren a mano contra
Supabase antes de pushear el código que las usa (cada archivo lo dice en
su cabecera).

### RLS

Habilitado en todas las tablas con datos sensibles. Las policies son
defensivas — el anon role no lee nada por default. El backend usa la
service-role key, que **bypasea RLS**. Los checks de permisos están
en el backend (no en la DB) vía `require_view`/`require_edit`.

### Storage buckets

| Bucket         | Visibilidad | Uso                                      |
|----------------|-------------|------------------------------------------|
| `nominations`  | **privada** | PDFs/docs de nominación, training        |
| `inventory`    | pública     | Fotos de assets (QR), de personnel, del Muro (`feed/`) y avatares de usuario (`avatars/`) |

`nominations` solo se accede vía service_role en el backend. El
frontend pide blobs autenticados al endpoint `/api/nominations/{id}/download`.

---

## Seguridad

Resumen — detalles en `SECURITY_RUNBOOK.md`.

- 3 rondas de pen-test (H1-H9 + N1-N3 cerrados) y auditoría de agosto
  2026 (acciones manuales en `deploy/MANUAL_ACTIONS_2026-08.md`; referencias
  versionadas de nginx y systemd en `deploy/`)
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
| FIBA GDAP API  | Sync de partidos y resultados (desde `games.py`, key en `FIBA_API_KEY`). Devuelve el clasificatorio entero; `competitions.fiba_window_code` filtra la ventana |
| Let's Encrypt  | TLS para fibaapp.com + fibaamericascloud.com (4 SAN)  |
| CloudConvert   | **Solo** el export del training schedule (`training.py`) |

Las cartas de nominación **no** usan CloudConvert (LibreOffice local);
el único uso vivo es el export del training schedule.
