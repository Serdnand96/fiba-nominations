# CLAUDE.md — Onboarding para sesiones de IA

> Leé este archivo primero si arrancás una sesión nueva sobre este repo.
> Acá está el contexto crítico para no caminar a tientas.
>
> Última revisión: **agosto 2026** (post módulo Presupuesto y auditoría 2026-08).

---

## TL;DR

Sistema admin de FIBA Americas para nominaciones de oficiales (TDs, VGOs),
training, logística, inventory, presupuesto, etc. Stack:

- **Frontend:** React 18 + Vite 5 + Tailwind 3, deployado como SPA estático
- **Backend:** FastAPI (Python 3.11) con gunicorn + uvicorn workers
- **DB + Auth + Storage:** Supabase (proyecto `mckaplalscnvaanukrmz`)
- **Hosting:** **DigitalOcean droplet** (NO Vercel — ver más abajo)
- **CI/CD:** GitHub Actions → SSH deploy al droplet, con rollback automático

Dominio prod: **https://www.fibaapp.com** (con redirect 301 desde el
legacy `fibaamericascloud.com`).

**No hay test suite ni linter configurado.** Ni pytest, ni vitest, ni eslint.
La verificación es: `npm run build` (que el bundle compile), levantar el API
local, y `bash verify_security.sh` post-deploy. Si agregás tests, sos el
primero — no asumas que hay comandos de CI que correr.

---

## ⚠️ Cosas que confunden a sesiones nuevas

1. **NO está en Vercel.** `vercel.json` ya no existe (a lo sumo queda un
   `.vercel/` local, gitignoreado). El deploy real es al droplet DO.
   La migración a DO se completó en abril 2026.

2. **Hay TRES caminos de documento generado, no uno:**
   - **Cartas de nominación** (`api/_lib/services/document_generator.py`):
     templates `.docx` con placeholders `docxtpl` (Jinja2-en-Word) → PDF con
     `soffice` local (`USE_LOCAL_LIBREOFFICE=1`). CloudConvert quedó como
     fallback **deshabilitado**.
   - **Export de training schedule** (`api/_lib/routers/training.py`): camino
     aparte — arma la tabla con python-docx y todavía convierte vía
     **CloudConvert únicamente** (si no hay API key, sirve el `.docx`). Es el
     único uso vivo de CloudConvert.
   - **Game & Practice Schedule** (`api/_lib/services/schedule_workbook.py`):
     `.xlsx` con openpyxl replicando el layout oficial de FIBA, **sin ninguna
     conversión**. Es el único código que escribe Excel en el backend, y está
     partido en dos capas puras (filas → representación intermedia → bytes)
     justamente para poder probarlo sin DB.

3. **Hay dos tablas distintas para personas:**
   - `personnel` → TDs / VGOs / árbitros (oficiales que se nominan)
   - `employees` → staff interno de FIBA (no se nomina, solo aparece en
     inventario, staffing y logística)

   El módulo **Evaluations** ("external staff") evalúa a `personnel`, no a
   `employees` — el "externo" es respecto de FIBA, no del sistema.

4. **`storage://nominations/X` paths** son una convención propia para
   referirse a objects en el bucket privado `nominations` de Supabase
   Storage. El backend los convierte a URLs autenticadas; el frontend
   nunca debe construir URLs públicas porque el bucket es privado. Cada router
   que guarda adjuntos tiene su propio `_extract_storage_key()` — nominations,
   payments y budget (gastos) usan el mismo patrón.

5. **El frontend descarga PDFs/adjuntos vía blob + JWT**, no via `<a href>` con
   URL pública. Las funciones están en `src/api/client.js`
   (`downloadNominationBlob`, `downloadTrainingPdf`, `downloadPaymentAttachment`,
   `downloadExpenseAttachment`, …).

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

8. **Hay dos vistas públicas sin auth, más una de inventario.**
   `/logistica/<token>` (frontend) → `/api/public/logistics/<token>`,
   `/availability/<token>` → `/api/public/availability/<token>`, y
   `/asset/:id` → `/api/public/assets/*` (el QR del inventario). Son links
   secretos por competencia, rotables y desactivables desde el panel
   "Compartir". La de logística **publica los datos completos, número de
   pasaporte incluido** — fue una decisión explícita del cliente. Si alguna vez
   hay que recortar, el único lugar es `_redact()` en `public_logistics.py`.
   Los `/api/public/*` son el **único** bypass de auth del middleware junto con
   OPTIONS y `/api` — todo lo que agregues ahí queda expuesto a internet.

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

    Los días compensatorios llevan **permiso propio `comp_days`** (migración
    030). Es el único permiso que **no** corresponde a una página: no tiene
    ruta ni entrada de sidebar, gobierna una columna dentro de Employees y solo
    usa `can_view`. El backend recorta `weekend_days` de la respuesta con
    `has_view()` (la variante de `auth.py` que devuelve bool en vez de tirar
    403, para permisos que recortan datos en lugar de cerrar un endpoint).
    Al agregar un permiso hay que tocar **tres** lugares: el CHECK de
    `user_permissions.module`, `MODULES` en `permissions.py` y `MODULES` en
    `src/pages/Users.jsx`.

11. **Presupuesto (`budget`) es el primer módulo que filtra FILAS por usuario.**
    Ver el punto siguiente — es lo bastante importante como para tener su
    propia sección.

12. **`expenses` no es `payments`, y ninguno reemplaza al otro.**
    - `payments` (migración 012) es **pago a una persona nominada a un evento**:
      `nomination_id` es `NOT NULL UNIQUE`. Prefill de `nominations.total`,
      W8/bank info y bloqueo de borrado (028) dependen de eso.
    - `expenses` (migración 034) es **gasto de departamento o de evento sin
      persona**: licencias, shipping, branding, seguros. Es lo que faltaba.

    Los pagos también consumen presupuesto: la 036 les agregó
    `department_code` + `account_code`. `payment_budgets` sigue existiendo para
    no romper los pagos viejos, pero **ya no se usa en la UI**.

---

## 💰 El módulo Presupuesto (leer antes de tocarlo)

El contrato completo está en **`BUDGET_MODULE.md`** — 31 endpoints en
`api/_lib/routers/budget.py` (2k líneas), `src/pages/Budget.jsx` con seis
pestañas (`dashboard`, `plan`, `expenses`, `recurring`, `revenues`, `vendors`),
migraciones **033 → 037 aplicadas a prod**. Lo que hay que saber sí o sí:

- **El scoping por departamento es row-level y vive en el backend.** Hasta
  `budget`, un permiso abría o cerraba un endpoint entero y listo. Acá cada
  usuario ve solo los departamentos que tiene en la tabla `budget_access`
  (`department_code = '*'` → todos). Como el backend pega con `service_role`
  y **bypassa RLS**, el filtro es puro código: `_scoped()` en `budget.py`.
  **Una query del módulo sin `_scoped()` es un agujero P0**, exactamente igual
  que un endpoint sin `require_view`. El propio archivo lo dice en un comentario
  arriba del helper; no lo borres.

  Cuidado con el detalle de PostgREST: encadenar `.eq()` después de un `.in_()`
  sobre la misma columna **no se intersecta**, se pisa. Por eso `_scoped()`
  valida el `?department=` pedido contra el scope antes de aplicarlo, en vez de
  encadenar. Copiar el patrón, no reinventarlo.

- **`budget_access` es una tabla aparte de `user_permissions`.** Dar de alta un
  usuario de presupuesto son **dos** pasos: el permiso `budget` (grilla de
  Usuarios) y las filas de departamento (panel de departamentos en la misma
  pantalla). Con permiso y sin filas, no ve nada.

- **La vista de costo de un evento es la excepción explícita y NO filtra.**
  `/budget/competitions/{id}/cost` muestra el desglose completo, incluidas las
  líneas de otros departamentos: sin eso la cifra del evento no sirve. El
  scoping rige bandejas (`/budget/expenses`, `/budget/lines`) y **toda
  escritura**.

- **Presupuesto multi-año = una fila por año**, no columnas 2027/2028/2029/2030.
  Las filas del mismo concepto se unen por `series_id`. "Proyectar" genera los
  años siguientes aplicando `escalation_pct`, y quedan editables.

- **Solo el gasto pagado consume presupuesto.** Lo aprobado-no-pagado se
  reporta aparte como *comprometido*.

- **Los recurrentes se generan perezosamente, no por cron.**
  `GET /budget/recurring/pending?month=YYYY-MM` devuelve las plantillas que
  todavía no tienen gasto ese mes; el usuario confirma en bloque. Nada corre
  solo.

- **El import de presupuesto (`services/budget_import.py`) es preview → commit**
  como el de logística, y **nunca adivina plata**: una columna que no matchea
  una competencia se reporta con su monto y se deja afuera — no se manda a
  "General", que es una columna real del Excel. Soporta las dos formas reales
  del cliente (lista con columnas por año = IT; matriz líneas × competencias =
  Competitions) detectadas por encabezado, no por posición. Es idempotente:
  reimportar la planilla corregida actualiza en vez de duplicar.

- **El plan de cuentas está a medias a propósito.** Finance todavía no entregó
  el oficial: los 6 códigos de IT son reales, las 28 líneas de Competitions
  son provisorias `COMP-01…COMP-28` con `pending_mapping = true` y badge en la
  UI. Cuando llegue el plan, se remapean con una migración de datos.

- **`fee_event_type` no es `template_key`.** El tarifario (`fee_schedule`, 037)
  usa etiquetas propias (`tournament_6d_senior`, `womens_americup`, …) que
  salen textuales del Excel de fees. Al nominar prellena `window_fee` e
  `incidentals`, editables como siempre.

- **El permiso `budget` no está sembrado a nadie.** Igual que `payments`: hasta
  que un admin lo otorgue, solo lo ve el superadmin.

---

## 🗺️ Mapa del repo

```
fiba-nominations/
├── CLAUDE.md                  ← este archivo
├── README.md                  ← overview general
├── ARCHITECTURE.md            ← sistema completo
├── DEPLOYMENT.md              ← GH Actions → droplet (incl. rollback)
├── DEVELOPMENT.md             ← correr local
├── DESIGN_SYSTEM.md           ← tokens / componentes UI
├── SECURITY_RUNBOOK.md        ← acciones manuales pendientes (Supabase, DNS)
├── BUDGET_MODULE.md           ← contrato del módulo Presupuesto (leerlo antes
│                                 de tocar budget.py)
├── PAYMENTS_MODULE.md         ← análisis del legacy vbills (histórico; la
│                                 implementación final difiere — ver nota adentro)
├── MANUAL_USUARIO.md          ← manual del usuario final (+ PDF generado)
├── .claude/                   ← subagentes + skills para sesiones de IA (ver abajo)
│
├── api/                       ← FastAPI backend
│   ├── index.py               ← entry, middleware de auth, mounting routers
│   └── _lib/
│       ├── auth.py            ← require_view / require_edit / require_superadmin
│       │                         / has_view (bool, para recortar datos)
│       ├── database.py        ← cliente Supabase liviano (httpx → PostgREST)
│       ├── crew.py            ← helper del crew de torneo
│       ├── schemas.py         ← modelos Pydantic compartidos
│       ├── routers/           ← uno por módulo (24: nominations, budget,
│       │                         logistics, staffing, training, …)
│       └── services/
│           ├── document_generator.py  ← docx (docxtpl) → pdf (LibreOffice)
│           ├── schedule_workbook.py   ← Game & Practice Schedule → xlsx
│           ├── bulk_import.py         ← import de roster de personnel
│           ├── logistics_import.py    ← manifest + rooming list (preview/commit)
│           ├── budget_import.py       ← presupuesto lista/matriz (preview/commit)
│           ├── template_store.py      ← templates .docx en storage
│           └── activity_log.py        ← audit trail (migración 018)
│
├── src/                       ← React frontend
│   ├── App.jsx                ← shell COMPLETO: sidebar, topbar, router,
│   │                             moduleIcon map, PermissionGuard. No hay
│   │                             components/layout/ — está todo acá.
│   ├── pages/                  ← una por ruta (+ subcarpetas budget/, logistics/
│   │                             para las pestañas pesadas)
│   ├── components/
│   │   ├── ui/                ← Button, Input, Table, Modal, Toast, … (DS)
│   │   └── brand/             ← Logo.jsx (Monogram, Wordmark, …)
│   ├── api/client.js          ← TODAS las llamadas al API (axios + JWT)
│   ├── lib/icons.jsx          ← Tabler icons
│   ├── contexts/AuthContext.jsx
│   └── i18n/                  ← LanguageContext + translations.js (ES + EN)
│
├── templates/                 ← *_TEMPLATE.docx (fuente) y *_TPL.docx (docxtpl)
├── deploy/                    ← configs de referencia del droplet
│   ├── nginx/security.conf.example
│   ├── systemd/fiba-api.service.example
│   └── MANUAL_ACTIONS_2026-08.md   ← pendientes de la auditoría (¡leer!)
├── public/favicon.png         ← monograma F + basketball seam
├── scripts/
│   ├── build_letter_templates.py  ← regenera los *_TPL.docx (correr si cambia el membrete)
│   ├── import_budgets_2027.py     ← carga one-shot (reemplazada por la UI de import)
│   ├── import_budget_comms_2027.py / import_headcount_2027.py / read_budget_xlsx.py
│   ├── fiba-security-scan.sh      ← scanner horario de nginx logs (corre en droplet)
│   └── fiba-supabase-keepalive.sh ← ping diario a Supabase (evita el auto-pause del Free)
├── supabase/migrations/       ← schema SQL (008 → 037; ver nota de baseline)
├── verify_security.sh         ← smoke test post-deploy
├── .github/workflows/deploy.yml  ← CI/CD
└── tailwind.config.js         ← tokens del DS
```

### ⚠️ El schema NO está completo en `supabase/migrations/`

Las migraciones arrancan en la **008** y hay ~17 tablas creadas a mano en el
dashboard que nunca tuvieron DDL versionado. **No asumas que leyendo
`supabase/migrations/` conocés el schema.** Si necesitás la forma real de una
tabla, mirala en Supabase (o en el router que la usa). El fix de fondo es un
`pg_dump --schema-only` → `000_baseline.sql`; está anotado como acción manual
en la 032 y sigue pendiente.

---

## 🤖 Subagentes y skills (para sesiones de Claude Code)

En `.claude/` hay subagentes y skills con las convenciones **reales** del
repo, para no reconstruirlas de cero en cada sesión:

- **Agentes** (`.claude/agents/`): `explorer` (read-only, entender un módulo
  antes de tocarlo), `frontend-implementer`, `api-implementer`,
  `pdf-specialist`, `excel-import-specialist`, `code-reviewer` y `ui-reviewer`
  (auditoría de accesibilidad/UX contra las Web Interface Guidelines).
  Flujo sugerido: explorer → implementer(s) → code-reviewer.
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
| Env de prod     | `/opt/fiba-nominations/.env` (modo 600 — ver `.env.example`)       |

Env vars que importan: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`CORS_ORIGINS`, `USE_LOCAL_LIBREOFFICE`, `CLOUDCONVERT_API_KEY` (solo training),
`FIBA_API_KEY` (sync de partidos desde GDAP).

---

## 🚀 Comandos clave

```bash
# ── Deploy (es automático en push a main, pero también manual): ──
git push origin main
# → GH Actions: ssh fiba, git reset --hard origin/main, pip install,
#   npm build a dist.new + swap atómico, restart fiba-api, smoke test.
#   Si el smoke test falla, hace ROLLBACK solo al commit previo y queda en rojo.
#   Un solo deploy a la vez (concurrency group, sin cancelar el que corre).

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

# ── Verificación antes de pushear (no hay tests): ──
npm run build                              # que el bundle compile
./venv/bin/python -c "import api.index"     # que el backend importe (el cliente
                                           # de Supabase es lazy: no necesita .env)
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
  En `budget`, además, **una query sin `_scoped()` = el mismo P0**.

- **Los permisos son 18 y viven en tres lugares que hay que mantener en sync:**
  el CHECK de `user_permissions.module`, `MODULES` en
  `api/_lib/routers/permissions.py` y `MODULES` en `src/pages/Users.jsx`.
  Un módulo que falta en `permissions.py` **nunca se puede otorgar**; uno que
  falta en el CHECK **rompe el PUT entero a mitad del loop**.

- **Errores:** las violaciones de integridad de Postgres se traducen a 4xx con
  mensaje, no 500 mudo (ver el manejo en los routers). Un 500 en un `insert`
  suele ser un constraint que no estás contemplando.

- **Storage path normalization** (`api/_lib/routers/nominations.py` →
  `_extract_storage_key()`) maneja 3 formatos: `storage://nominations/X`,
  `/storage/v1/object/public/nominations/X`, `/storage/v1/object/nominations/X`.

### Frontend (React)

- **Lazy-load todas las pages**: `const X = lazy(() => import('./pages/X'))`.
  Vite genera un chunk por página.

- **Vendor chunking** definido en `vite.config.js`: `react-vendor`,
  `supabase`, `qrcode-scan`, `http`.

- **Permission guards** envuelven cada ruta: `<PermissionGuard module="X">`
  redirige a 403 si no hay `can_view`. Son **solo UX** — la autorización real
  es la del backend.

- **Todas las llamadas al API pasan por `src/api/client.js`.** No hagas `axios`
  ni `fetch` sueltos en una página: el interceptor de JWT y el manejo de 401
  viven ahí.

- **Nada de `alert()` / `confirm()` nativos.** Feedback vía `useToast()`
  (`components/ui/Toast.jsx`) y confirmaciones vía `Modal`. Ya se migraron
  todas las páginas; no reintroduzcas el patrón viejo.

- **Los `Badge` son dark-aware.** Usá las variantes del componente, no clases
  de color a mano: se rompió el contraste AA en modo claro una vez.

- **i18n** vía `useLanguage()` (ES por default, switch en sidebar). Todo string
  visible va en `src/i18n/translations.js`, en ES **y** EN.

- **Modo oscuro** vía `.dark` en `<html>`, persistido en
  `localStorage.fiba_dark`. Default actual: dark (ver
  `DESIGN_SYSTEM.md` para por qué).

### Git / commits

- Convención: **type prefix** (`feat:`, `fix:`, `docs:`, `design:`,
  `ops:`, `security:`, `data:`) + scope opcional entre paréntesis + descripción
  corta en español + cuerpo opcional. Ej: `fix(budget): el filtro de cuenta
  sigue al departamento elegido`. Ver `git log` para el patrón.

- **No amend** — siempre commits nuevos (pre-commit hooks pueden
  fallar y dejar el repo en estado raro).

- **No push --force a main.** Si hay que reescribir historia, en
  branch nuevo.

### Migraciones

- Numeradas y correlativas en `supabase/migrations/`. **No se aplican solas en
  el deploy**: el workflow no corre SQL. Una migración se revisa y se aplica a
  mano (staging primero), y se anota en el header del archivo cuándo se aplicó
  a prod — mirá la 032 como modelo.
- Escribilas **idempotentes** (`if not exists`, guardas en `do $$`): en prod
  hay deriva previa y vas a querer re-ejecutar.

---

## 🩺 Cómo está la salud del sistema

- **Pen-test cerrado en mayo 2026** (3 rondas). H1-H9 + N1, N2, N3 cerrados.
- **Auditoría de código en agosto 2026.** Los fixes de código ya están
  mergeados: SSTI en templates, `_redact()`, manejo de `X-Forwarded-For`, SSRF,
  correcciones de lógica de negocio, y la migración `032_audit_hardening`
  (aplicada a prod el 2026-08-11, idempotente) con los constraints que faltaban
  — `nominations.total` con `coalesce`, unique por (competencia, persona),
  índice parcial en `staff_evaluations`, enums/rangos que solo validaba Python.

Pendientes **manuales** (no salen del repo):

- `deploy/MANUAL_ACTIONS_2026-08.md` — lo crítico de la auditoría: permisos y
  rotación del `.env`/`service_role` en el droplet, acotar el sudo de la deploy
  key, y el `000_baseline.sql` del schema.
- `SECURITY_RUNBOOK.md` — **N4** (HTTP 500 → 400 en filter de dominio, necesita
  Supabase Pro), **N5/N6** (SPF/DMARC/CAA en `fibaamericascloud.com`),
  **N7** (Cloudflare WAF + ocultar IP origen), **N8** (rate limits en Supabase
  Auth).

Hay scanner horario corriendo en `/var/log/fiba-security-alerts.log`
(via cron `/etc/cron.d/fiba-security-scan`).

---

## 🎨 Trabajo de UI / diseño

Hay un **design system completo** activo desde mayo 2026:
- Navy (`#0c2340`) + basketball orange (`#F57C2A`) + ink neutrals
- IBM Plex Sans + IBM Plex Mono
- Componentes en `src/components/{ui,brand}/` (el shell vive en `App.jsx`)
- Iconos Tabler en `src/lib/icons.jsx`

**Antes de tocar colores/clases, leer `DESIGN_SYSTEM.md`.** Tiene la
explicación del truco de CSS variables para los aliases legacy
`fiba-*` que los hace dark-aware sin tocar JSX.

Para auditar una pantalla (foco, teclado, contraste, remounts, doble-submit),
está el agente `ui-reviewer`.

---

## 🎯 Si te piden algo

- **"Agregá un módulo nuevo"** → router en `api/_lib/routers/X.py` (con
  `require_view` a nivel router), mount en `api/index.py`, página en
  `src/pages/X.jsx` (lazy), ruta con `PermissionGuard` en `App.jsx`, icono en
  el map `moduleIcon`, strings en `translations.js` (ES+EN), y el permiso en
  los **tres** lugares (CHECK de la migración, `permissions.py`, `Users.jsx`).

- **"Tocá algo de presupuesto"** → leé `BUDGET_MODULE.md` primero, y no toques
  una query sin `_scoped()`.

- **"Cambiá el deploy"** → modificá `.github/workflows/deploy.yml`. Hay
  un user en el droplet llamado `fiba` con clave SSH agregada via
  `DROPLET_SSH_KEY` secret. Ojo con el bloque de rollback: si agregás pasos,
  agregá también su reversión.

- **"Probá un cambio en el droplet"** → `ssh fiba`, navegá a
  `/opt/fiba-nominations`, podés correr el venv directamente con
  `./venv/bin/python` o reiniciar el servicio. **Cualquier cosa que dejes ahí
  la borra el próximo deploy** (`git reset --hard origin/main`).

- **"Hay algo lento"** → `ssh fiba sudo journalctl -u fiba-api`,
  buscar P99 en gunicorn logs. La DB es Supabase Free → puede tener
  rate limits.

---

## 🚫 Cosas que NO hacer

- ❌ Asumir que está en Vercel (ya no — droplet DO).
- ❌ Asumir que `supabase/migrations/` es el schema completo (faltan ~17 tablas).
- ❌ Llamar al bucket `nominations` como público (es privado, siempre
  vía service_role en el backend).
- ❌ Generar las cartas de nominación vía CloudConvert (deshabilitado;
  usar LibreOffice local via `document_generator.py`). El único uso vivo
  de CloudConvert hoy es el export de training schedule (`training.py`).
- ❌ Escribir una query de `budget.py` sin `_scoped()`, o un endpoint sin
  `require_view` / `require_edit`.
- ❌ Encadenar `.eq()` después de `.in_()` sobre la misma columna en PostgREST
  creyendo que intersecta.
- ❌ Borrar registros directamente con SQL si tocan storage — usar
  el endpoint que llama a Storage API (`_delete_pdf_from_storage`).
- ❌ Confundir `personnel` con `employees` (TDs/VGOs vs staff interno), ni
  `payments` con `expenses` (persona nominada vs gasto sin persona).
- ❌ Usar `alert()` / `confirm()` en el frontend, ni hacer `fetch`/`axios` fuera
  de `src/api/client.js`.
