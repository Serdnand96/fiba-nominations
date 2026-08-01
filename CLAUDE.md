# CLAUDE.md — Onboarding para sesiones de IA

> Leé este archivo primero si arrancás una sesión nueva sobre este repo.
> Acá está el contexto crítico para no caminar a tientas.

---

## TL;DR

Sistema admin de FIBA Americas para nominaciones de oficiales (TDs, VGOs),
training, logística, inventory, etc. Stack:

- **Frontend:** React + Vite + Tailwind, deployado como SPA estático
- **Backend:** FastAPI (Python 3.11) con gunicorn + uvicorn workers
- **DB + Auth + Storage:** Supabase (proyecto `mckaplalscnvaanukrmz`)
- **Hosting:** **DigitalOcean droplet** (NO Vercel — ver más abajo)
- **CI/CD:** GitHub Actions → SSH deploy al droplet

Dominio prod: **https://www.fibaapp.com** (con redirect 301 desde el
legacy `fibaamericascloud.com`).

---

## ⚠️ Cosas que confunden a sesiones nuevas

1. **NO está en Vercel.** `vercel.json` ya no existe (a lo sumo queda un
   `.vercel/` local, gitignoreado). El deploy real es al droplet DO.
   La migración a DO se completó en abril 2026.

2. **Los PDFs se generan con python-docx + docxtpl → LibreOffice**, no
   WeasyPrint ni templates HTML. Las cartas de nominación
   (`api/_lib/services/document_generator.py`) renderizan templates `.docx`
   con placeholders `docxtpl` y los convierten a PDF con `soffice` local
   (`USE_LOCAL_LIBREOFFICE=1`); CloudConvert quedó como fallback
   deshabilitado. **Ojo:** el export de training schedule
   (`api/_lib/routers/training.py`) es un camino aparte — arma la tabla con
   python-docx y todavía convierte vía CloudConvert únicamente (si no hay
   API key, sirve el `.docx`).

3. **Hay dos tablas distintas para personas:**
   - `personnel` → TDs / VGOs (oficiales que se nominan)
   - `employees` → staff interno de FIBA (no se nomina, solo aparece en
     inventario para asignar activos)

   El módulo **Evaluations** ("external staff") evalúa a `personnel`, no a
   `employees` — el "externo" es respecto de FIBA, no del sistema.

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

7. **Transport ya no es un módulo: es una sección de Logística.** Desde la
   migración 025 el permiso se llama `logistics` (`transport` no existe más
   en `user_permissions`) y el módulo tiene tres secciones:
   - **Transporte** — vehículos, choferes, viajes. Sigue viviendo en
     `api/_lib/routers/transport.py` con prefijo `/api/transport/*`: la URL
     quedó igual porque es interna, solo cambió el permiso que exige.
   - **Hospedaje** — hoteles, rooming list y comidas.
   - **Travel Manifest** — llegadas y salidas de cada persona.

   Las dos últimas viven en `api/_lib/routers/logistics.py`. Todo cuelga de
   `logistics_participants`, el padrón de quién viene a la competencia
   (oficiales de `personnel`, staff de `employees`, VIPs y delegaciones sin
   vínculo). **No hay "Supabase Auth standalone"** ni sandbox separado:
   revisalo con el mismo checklist de permisos que cualquier otro módulo.

   Ojo con dos cosas que se ven raras y son correctas:
   - Las **noches** de la rooming list se derivan de `check_in`/`check_out`;
     la grilla `1`/`OUT` del Excel es una vista, no una tabla. El total que
     se le manda al hotel cuenta **habitaciones**, no personas: de una pareja
     que comparte cuarto, solo una fila suma (`is_room_holder`).
   - Los importadores de Excel (`services/logistics_import.py`) son de **dos
     pasos** (preview → commit) y nunca adivinan: un nombre dudoso se importa
     sin vincular y se reporta como warning. Las planillas vienen con typos
     reales (`Guyo`/`Juyo`, `BUELVAS`/`Vuelvas`) y con `Names`/`Last Name`
     invertidos en varias filas.

8. **Hay una vista pública de logística, sin auth.** `/logistica/<token>`
   (frontend) → `/api/public/logistics/<token>` (backend). Un link secreto por
   competencia, rotable y desactivable desde el panel "Compartir".
   **Publica los datos completos, número de pasaporte incluido** — fue una
   decisión explícita del cliente. Si alguna vez hay que recortar, el único
   lugar es `_redact()` en `public_logistics.py`.

9. **Hay dos formas de asignar personal, y las decide `competitions.fee_type`:**
   - `per_game` → asignación **por partido** en `game_assignments` (un cargo
     por juego), solo para templates WCQ/BCLA/LSB.
   - `tournament` → el **crew del torneo** en `competition_assignments`
     (helper: `api/_lib/crew.py`) cubre **todos** los partidos y todos los
     slots de training, sin importar el template. Las filas por partido pasan
     a ser un *override* opcional (quién estuvo realmente en la mesa) y ahí
     sí puede haber más de una persona en el mismo cargo.
   `sync-nominations` sale del crew en modo torneo y de `game_assignments` en
   modo per-game. El crew se edita desde Games y desde el panel de Calendar.

10. **El "Staffing Plan" NO es el crew.** `competition_staffing` (migración
    029, router `staffing.py`, panel en Games) registra a los **empleados FIBA**
    que trabajan un evento — `employees`, no `personnel`. Está deliberadamente
    fuera de `competition_assignments` porque esa tabla alimenta
    `sync-nominations`, las cartas y los fees: **un empleado FIBA no se nomina
    ni cobra window fee**. Si algún día hay que cruzarlos, el puente correcto es
    sembrar `logistics_participants` con `category = 'fiba_staff'`, no unificar
    las tablas. Permiso: `games`. El picker sale de `/staffing/candidates` y no
    de `/employees`, para no exigir el permiso `employees` a quien planifica.

    **Los viajes por año del empleado son derivados, no guardados.** La columna
    "Viajes" de Empleados (`/employees/trip-counts` y `/employees/{id}/trips`)
    se calcula al leer, sumando `competition_staffing` **y**
    `logistics_participants` y deduplicando por competencia: **un viaje = una
    competencia**, aunque la persona cubra dos funciones en el mismo evento. No
    agregar una columna contador a `employees` — habría que recalcularla en
    cada alta, baja y cambio de año. La columna "Días comp." sale del mismo
    cálculo: sábados y domingos **dentro del tramo** de cada viaje, base de los
    compensatorios. **Los feriados no se cuentan** (no hay calendario de
    feriados y varía por país de la persona).

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
├── PAYMENTS_MODULE.md         ← análisis del legacy vbills (histórico; la
│                                 implementación final difiere — ver nota adentro)
├── .claude/                   ← subagentes + skills para sesiones de IA (ver abajo)
│
├── api/                       ← FastAPI backend
│   ├── index.py               ← entry, middleware, mounting routers
│   └── _lib/
│       ├── auth.py            ← require_view, require_edit dependencies
│       ├── database.py        ← lightweight supabase client (httpx)
│       ├── routers/           ← uno por módulo (nominations, training, …)
│       └── services/
│           └── document_generator.py  ← docx (docxtpl) → pdf (LibreOffice)
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
├── public/favicon.png         ← monograma F + basketball seam
├── scripts/
│   ├── build_letter_templates.py  ← regenera los *_TPL.docx (correr si cambia el membrete)
│   ├── fiba-security-scan.sh      ← scanner horario de nginx logs (corre en droplet)
│   └── fiba-supabase-keepalive.sh ← ping diario a Supabase (evita el auto-pause del Free)
├── supabase/migrations/       ← schema SQL
├── verify_security.sh         ← smoke test post-deploy
├── .github/workflows/deploy.yml  ← CI/CD
└── tailwind.config.js         ← tokens del DS
```

---

## 🤖 Subagentes y skills (para sesiones de Claude Code)

En `.claude/` hay subagentes y skills con las convenciones **reales** del
repo, para no reconstruirlas de cero en cada sesión:

- **Agentes** (`.claude/agents/`): `explorer` (read-only, entender un módulo
  antes de tocarlo), `frontend-implementer`, `api-implementer`,
  `pdf-specialist`, `excel-import-specialist` y `code-reviewer`. Flujo
  sugerido: explorer → implementer(s) → code-reviewer.
- **Skills** (`.claude/skills/`, se auto-cargan según el contexto):
  `api-conventions`, `frontend-conventions`, `fiba-excel-format`,
  `pdf-templates`, `security-checklist`.

⚠️ Son una **foto del código**: si refactorizás auth, la generación de PDF o
el import de Excel, actualizá el skill correspondiente en el mismo PR — un
skill desactualizado es peor que ninguno.

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

# ── Dev local (frontend + backend): ──
npm run dev                 # vite
# y aparte:
./venv/bin/uvicorn api.index:app --reload --port 8000
```

---

## 🧭 Convenciones del proyecto

### Backend (FastAPI)

- **Auth middleware** (en `api/index.py`) valida JWT contra Supabase
  `/auth/v1/user`. Bypasses solo para: OPTIONS, `/api`, `/api/public/*`.
  Endpoints `/download` y `/export/pdf` **requieren auth** (pen-test N1).

- **Autorización a nivel de app (NO RLS).** El backend pega a Supabase con
  el `service_role` key (`api/_lib/database.py`), que **bypassa Row Level
  Security**. Por eso el control de acceso vive en el código: cada router
  declara `require_view("X")` a nivel `APIRouter` y cada escritura agrega
  `require_edit("X")` (de `api/_lib/auth.py`). Los permisos salen de
  `user_permissions` (`can_view`/`can_edit`); el flag `is_superadmin` sale
  de `user_profiles` y se cachea por request en
  `request.state._is_superadmin`. RLS existe solo como defensa en
  profundidad en algunas tablas (migraciones 006/007), no como control
  principal. **Un endpoint sin dependency de permiso = agujero P0.**

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
- ❌ Generar las cartas de nominación vía CloudConvert (deshabilitado;
  usar LibreOffice local via `document_generator.py`). El único uso vivo
  de CloudConvert hoy es el export de training schedule (`training.py`).
- ❌ Borrar registros directamente con SQL si tocan storage — usar
  el endpoint que llama a Storage API (`_delete_pdf_from_storage`).
- ❌ Confundir `personnel` con `employees` (TDs/VGOs vs staff interno).
