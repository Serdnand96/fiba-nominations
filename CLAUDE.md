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

    Los días compensatorios llevan **permiso propio `comp_days`** (migración
    030). Es el único permiso que **no** corresponde a una página: no tiene
    ruta ni entrada de sidebar, gobierna una columna dentro de Employees y solo
    usa `can_view`. El backend recorta `weekend_days` de la respuesta con
    `has_view()` (la variante de `auth.py` que devuelve bool en vez de tirar
    403, para permisos que recortan datos en lugar de cerrar un endpoint).
    Al agregar un permiso hay que tocar **tres** lugares: el CHECK de
    `user_permissions.module`, `MODULES` en `permissions.py` y `MODULES` en
    `src/pages/Users.jsx`.

11. **Los checklists de sede son datos, no código** (migración 038,
    `checklists.py` + `public_checklists.py`). "El VGO llega a la sede y prueba
    reloj, fill & key, software, GFX y stats" es *una* plantilla
    (`checklist_templates`), editable desde el panel **Control de operación** en
    Games. Agregar la del TD o la del médico no toca el backend.

    - La corrida se engancha al **partido**, no a la sede ni al día.
    - Abrir una corrida **copia** los ítems de la plantilla a
      `game_checklist_items`. Editar la plantilla en octubre no reescribe lo que
      se firmó en agosto — por eso hay `label` duplicado, no es un descuido.
    - **El estado no se guarda.** `pending` / en curso / cerrado / con falla se
      derivan de los ítems en `run_state()`. No agregar una columna `status`.
    - Permiso `games`, el mismo del crew y del staffing plan. No es una página.
    - Hay una **tercera vista pública**, `/checklist/<token>` →
      `/api/public/checklists/<token>`. A diferencia de logística y
      availability, esta **escribe**: cada PATCH revalida la cadena ítem →
      corrida → partido → competencia contra el token, y una corrida cerrada es
      de solo lectura desde afuera (reabrirla exige permiso `games`). La firma
      se pide una vez al abrir la corrida, no ítem por ítem; `checked_source`
      distingue lo cargado en la cancha (`self`) de lo transcripto en la oficina
      (`admin`).

12. **`date`/`time` de un partido son hora LOCAL de la sede.** No UTC, no hora
    de Argentina, no la del navegador. Es lo que ve el TD en el gimnasio y lo
    que muestra la web de FIBA. El ancla para convertir a cualquier otra zona
    es `game_schedule.datetime_utc` (migración 039), que sale de
    `gameDateTimeUTC` de FIBA.

    - **Nunca sumes un offset a la hora local.** La competencia toca 16 zonas
      IANA que cambian de horario de verano en fechas distintas, y algunas no
      cambian. Convertí desde `datetime_utc`.
    - Cuidado con la fecha: México juega 20:10 local y eso es **02:10 UTC del
      día siguiente**. `datetime_utc` es timestamptz justamente por eso, y la
      card marca `+1`/`-1` cuando en la zona destino el partido cae otro día.
    - `NULL` significa que FIBA todavía no fijó horario
      (`hasTimeGameDateTime=false`); la UI muestra `--:--` en vez de inventar.
      `'00:00'` en `time` es lo mismo: relleno, no medianoche.
    - La hora del war room (Miami) vive en `src/lib/warRoom.js`, con la zona en
      una sola constante `WAR_ROOM_TZ`.

13. **La API de FIBA no devuelve una ventana: devuelve el clasificatorio
    entero.** `getgdapgamesbycompetitionid` para el WC 2027 Americas Qualifiers
    trae los **84 partidos de las seis ventanas**, de noviembre 2025 a marzo
    2027, por la misma URL. Acá, en cambio, cada ventana es una **competencia
    aparte** con su crew, sus nominaciones y sus fees.

    Por eso existe `competitions.fiba_window_code` (W1..W6, migración 040): si
    está seteado, `sync-results` importa solo los partidos con ese `windowCode`.
    `NULL` = sin filtro, que es lo correcto para una competencia no dividida en
    ventanas (AmeriCup, CentroBasket) — la mayoría.

    - **No filtres por el rango de fechas de la competencia.** Window 3 de FIBA
      termina el 2026-07-08 y la competencia declara hasta el 07-07: ese filtro
      se come un partido, y en el caso real ese partido tenía TD y VGO
      asignados. Los bordes de una ventana no coinciden con las fechas que
      carga el equipo, que incluyen viaje.
    - El filtro **falla del lado seguro**: si la competencia declara ventana
      pero ningún partido del feed trae `windowCode`, no filtra nada. Un feed
      sin ventanas tiene que devolver sus partidos, no cero.
    - Sin esto (hasta agosto 2026) W3 y W4 tenían 84 filas cada una, de las
      cuales 17 y 12 eran suyas; los partidos de agosto se veían dentro de la
      ventana de julio. Se limpiaron 139 filas.

14. **Hay DOS tablas de gasto y el reporte suma las dos.** No son alternativas
    ni una reemplaza a la otra:
    - `payments` (migración 012) → pago a **una persona nominada a un evento**.
      `nomination_id` es NOT NULL UNIQUE: sin nominación no hay pago. De ahí
      salen los fees de TDs, VGOs y árbitros.
    - `expenses` (migración 034) → **todo lo demás**: gasto de departamento sin
      evento (licencias, internet, leasing) y gasto de evento sin persona
      (shipping, branding, seguros).

    `/budget/summary` suma las dos fuentes. Un pago cuenta como ejecutado con
    `status = 'completed'`; un gasto, con `paid`. Lo aprobado-sin-pagar se
    reporta como *comprometido* y no descuenta del restante.

    **No metas un `nomination_id` nullable en `payments`** para unificarlas: eso
    volvería condicional el prefill desde `nominations.total`, la lógica de
    W8/bank info y el bloqueo de borrado de la migración 028.

    El contrato completo del módulo está en `BUDGET_MODULE.md` y se actualiza en
    el mismo PR que el código.

15. **La imputación de un pago al presupuesto es derivada, y son DOS.**
    `payments.department_code` / `account_code` (migración 036) no se piden en
    el formulario: salen del `budget_code` que el usuario ya eligió y del rol de
    la persona nominada. Y un pago aporta **dos** imputaciones, no una:

    | Concepto | Va a la cuenta | Mapeo |
    |---|---|---|
    | fee (`total` = amount + extra) | de **fees** del rol | `api/_lib/budget_accounts.py` |
    | pasaje (`airfare`, migración 013) | de **travel** del rol | el mismo archivo |
    | (departamento) | — | columna `payment_budgets.department_code` (migración **041**) |

    - **Nunca imputes el pasaje a la cuenta del fee.** Infla una línea y deja la
      otra en cero, y encima parece correcto. El plan de cuentas viene apareado:
      TD 11/12, VGO 13/14, REF 10/07, REF_INSTRUCTOR 08/09.
    - El departamento es **dato, no código**: agregar un `payment_budgets` sin
      mapear manda esos pagos a `unallocated_payments` (el ámbar del dashboard).
      El backend loguea un warning cuando pasa, pero es lo único que avisa.
    - Un valor sin mapear queda en `NULL` **a propósito**: se reporta como sin
      imputar en vez de esconderse dentro del total de un área ajena.

16. **Budget es el único módulo con filtrado por FILA.** En todos los demás un
    permiso abre o cierra el endpoint entero: quien tiene `logistics` ve toda la
    logística. Acá no alcanza — el designado de IT ve los gastos de IT y no los
    de Competitions.

    Y **no se resuelve con RLS**: el backend pega con el `service_role`, que la
    bypassa por diseño. El recorte vive en el código, en **cada** query del
    router, vía `_scoped()` (`budget.py`) contra la tabla `budget_access`.

    - Una query de budget sin `_scoped()` es un agujero **P0**, igual que un
      endpoint sin `require_view`.
    - `_scoped()` resuelve el scope y el filtro que pidió el usuario en **un
      solo** `.eq`/`.in_`: el query builder guarda un filtro por columna, así que
      encadenar dos pisa el scope en silencio. Eso sería el bypass.
    - `/budget/access/{user_id}` es **solo superadmin**: quién ve qué plata no lo
      decide alguien que ya tiene el módulo.

17. **Las migraciones de Budget (033-041) NO van en el deploy automático.** Se
    aplican a mano contra Supabase **antes** de pushear el código que las usa —
    si no, el deploy encuentra una columna que no existe. Cada archivo lo dice en
    su cabecera. El resto del schema sigue la misma convención, pero acá es
    especialmente fácil olvidarlo porque son nueve migraciones seguidas.

    **Estado hoy (agosto 2026):** el presupuesto está cargado ($1.627.431 para
    2027, entre IT, Competitions y Comms) pero el **ejecutado está casi vacío**
    — 1 pago, 0 gastos, 0 proveedores. Si el dashboard te da todo en cero, es el
    dato y no un bug.

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
├── BUDGET_MODULE.md           ← contrato del módulo Budget (schema, endpoints,
│                                 scoping por departamento, datos cargados)
├── .claude/                   ← subagentes + skills para sesiones de IA (ver abajo)
│
├── api/                       ← FastAPI backend
│   ├── index.py               ← entry, middleware, mounting routers
│   └── _lib/
│       ├── auth.py            ← require_view, require_edit dependencies
│       ├── database.py        ← lightweight supabase client (httpx)
│       ├── budget_accounts.py ← rol → cuenta de fees / de travel (payments ↔ budget)
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

- **"Tocá algo de plata"** (budget, payments, fees) → leé `BUDGET_MODULE.md`
  primero: es el contrato del módulo y se actualiza en el mismo PR. Checklist
  corto: `_scoped()` en toda query nueva de budget, la migración aplicada a mano
  ANTES del push, y si tocás la imputación de un pago acordate de que son dos
  (fee y pasaje, puntos 15 a 17).

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
- ❌ Escribir una query en `budget.py` sin `_scoped()` — es un P0 (punto 16).
- ❌ Imputar el pasaje de un pago a la cuenta de fees (punto 15).
- ❌ Pushear código que usa una migración de Budget sin haberla aplicado antes
  a mano en Supabase (punto 17).
