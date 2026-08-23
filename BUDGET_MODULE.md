# BUDGET_MODULE.md — Diseño del módulo de Presupuesto y Gastos

> Estado: **completo** (agosto 2026) — las 5 fases implementadas, migraciones
> 033-037 **aplicadas a prod**, `api/_lib/routers/budget.py` (31 endpoints),
> `src/pages/Budget.jsx` (6 pestañas).
>
> Queda pendiente de terceros: el plan de cuentas de Finance y los gastos
> históricos 2026 (ver §11).
>
> **Datos cargados:** los presupuestos 2027 de IT (2027-2030) y de Competitions
> están importados — ver §10.
>
> El permiso `budget` **no está sembrado a nadie**: igual que `payments`, hasta
> que un admin lo otorgue en Usuarios solo lo ve el superadmin.
>
> Este documento es el contrato del módulo. Si algo del código difiere,
> se actualiza acá en el mismo PR.

---

## 1. Por qué existe

El módulo `payments` de hoy solo sabe pagar **personas nominadas a un evento**:
`payments.nomination_id` es `NOT NULL UNIQUE` (migración 012). Eso deja fuera
dos cosas que FIBA Américas gasta todos los meses:

1. **Gasto de departamento sin evento** — licencias de software, internet,
   leasing de impresora, utilities. Es el 100% del presupuesto de IT.
2. **Gasto de evento sin persona** — shipping DHL, branding de cancha, LED
   tunnel, doping, seguros. En la planilla de Competitions son 28 líneas.

Los presupuestos reales que hoy viven en Excel:

- `ADMIN/BUDGET/FIBA_IT_Budget_2027-2030.xlsx` — lista de líneas agrupadas por
  **código contable** (610400, 611000, 610500, 612100, 612200, 612300), con
  proyección 2027→2030 y % de escalación por categoría.
- `Competitions (private)/Budgets/2027/CompsDraftBudget2027_*.xlsx` — **matriz**
  de 28 líneas de gasto × 18 competencias, más una columna literal
  *"General Expenses (not associated to the competitions)"*.

**Las dos formas son el mismo objeto.** Una línea de presupuesto es:

```
(año, departamento, cuenta, competencia | NULL, monto)
```

Las filas de IT tienen `competencia = NULL`. Las celdas de la matriz de
Competitions son `(línea, competencia)`, y la columna "General Expenses" es
`competencia = NULL`. Una sola tabla cubre los dos casos; lo que cambia es la
**vista** (lista vs. matriz).

---

## 2. Decisiones tomadas

| # | Decisión | Por qué |
|---|----------|---------|
| 1 | Tabla `expenses` **nueva**, `payments` queda como está | `payments` es "pago a una persona nominada" y funciona. Meterle un `nomination_id` nullable volvería condicional el prefill de `nominations.total`, W8/bank info y el bloqueo de borrado (migración 028). |
| 2 | **Departamento** y **cuenta** son dimensiones separadas | Una competencia cruza departamentos: en la matriz de 2027, "TV Production (COMMS)" e "IT on Events" viven dentro del presupuesto de Competitions. Quién ejecuta ≠ de dónde sale la plata. |
| 3 | Aprobación **simple** (`approved_by` + `approved_at`) | Sin bandeja de pendientes ni notificaciones. |
| 4 | Presupuesto **multi-año**, por departamento **y** por competencia | El de IT proyecta 2027-2030; el de Competitions presupuesta por evento. |
| 5 | **Solo el gasto pagado cuenta como ejecutado** | Lo aprobado-no-pagado se reporta aparte como *comprometido*. Desde la fase 7 (§14) el **restante sí lo descuenta**: `presupuestado − ejecutado − comprometido`. |
| 6 | **Una sola versión vigente** del presupuesto, editable | Sin tabla de versiones. Los cambios quedan en el activity log existente (migración 018). |
| 7 | Todo en **USD** | Sin multi-moneda, sin tipo de cambio. |
| 8 | Recurrentes por **plantilla con generación perezosa** | Nada corre por cron; los gastos esperados del mes se muestran al abrir el mes y se confirman en bloque. |
| 9 | Hotel y transporte: **Logística queda puramente operativa** | El host los asume casi siempre. Cuando FIBA sí paga (ej. "Hotel Extra Nights" de AmeriCup W), va como gasto normal. Nunca se derivan costos desde Logística → cero doble conteo. |
| 10 | **Ingresos** también se registran | El Summary de Competitions tiene *Expected Revenue* y *Grant Requested*. |

---

## 3. Schema

Migraciones `033` → `037`. Todas con RLS activada y **sin políticas**
(backend-only vía `service_role`), igual que `payments` — son datos
financieros sensibles.

### 033 — Catálogos

```sql
-- Departamentos que gastan.
CREATE TABLE departments (
    code   text PRIMARY KEY,
    label  text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    sort   integer DEFAULT 0
);
-- Seed: competitions, club_competitions, comms, admin, 3x3,
--       youth_development, events, it, finance
--
-- `comms` sale de la matriz de Competitions 2027: la línea 15 "Comms Expenses"
-- y la 16 "TV Production / Streaming (COMMS)" ($267.000, la línea más grande
-- del presupuesto) son de Comms, no de Competitions. Es el caso testigo de por
-- qué departamento y cuenta son dimensiones separadas.

-- Plan de cuentas único (lo administra Finance).
CREATE TABLE accounts (
    code            text PRIMARY KEY,     -- '612300'
    label           text NOT NULL,        -- 'IT Software & Licenses'
    kind            text NOT NULL DEFAULT 'expense'
                      CHECK (kind IN ('expense', 'revenue')),
    parent_code     text REFERENCES accounts(code),  -- agrupación / subtotales
    escalation_pct  numeric(5,4) DEFAULT 0,  -- default para proyección multi-año
    pending_mapping boolean NOT NULL DEFAULT false,  -- código provisorio
    active          boolean NOT NULL DEFAULT true,
    sort            integer DEFAULT 0
);

-- Proveedores.
CREATE TABLE vendors (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    tax_id     text,
    country    text,
    email      text,
    phone      text,
    bank_info  text,
    notes      text,
    active     boolean NOT NULL DEFAULT true,
    created_at timestamptz DEFAULT now()
);
```

**Seed del plan de cuentas.** Finance tiene el plan oficial pero todavía no lo
entregó. Se siembra con lo que ya existe y se marca `pending_mapping = true`:

- Los **6 códigos reales de IT** (610400, 610500, 611000, 612100, 612200,
  612300) con sus `escalation_pct` del sheet *Assumptions* (5%, 0%, 3%, 3%, 4%,
  6%) → `pending_mapping = false`.
- Las **28 líneas de Competitions** como códigos provisorios `COMP-01`…`COMP-28`
  → `pending_mapping = true`.

Cuando llegue el plan oficial, se remapean los `COMP-*` con un `UPDATE` y una
migración de datos. Hasta entonces la UI muestra un badge en las cuentas
pendientes.

### 035 — Presupuesto

```sql
CREATE TABLE budget_lines (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    year            integer NOT NULL,
    department_code text NOT NULL REFERENCES departments(code),
    account_code    text NOT NULL REFERENCES accounts(code),
    competition_id  uuid REFERENCES competitions(id) ON DELETE SET NULL,
        -- NULL = gasto general no asociado a competencia
    kind            text NOT NULL DEFAULT 'expense'
                      CHECK (kind IN ('expense', 'revenue')),
    description     text NOT NULL,
    qty             numeric(10,2),
    monthly_amount  numeric(12,2),
    amount          numeric(12,2) NOT NULL DEFAULT 0,   -- anual, USD
    escalation_pct  numeric(5,4) NOT NULL DEFAULT 0,
    source          text NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('manual', 'calculated')),
    notes           text,
    series_id       uuid NOT NULL DEFAULT gen_random_uuid(),
        -- misma línea a través de los años (para ver 2027→2030 en una fila)
    created_by      uuid,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_budget_lines_year_dept ON budget_lines(year, department_code);
CREATE INDEX idx_budget_lines_competition ON budget_lines(competition_id);
CREATE INDEX idx_budget_lines_series ON budget_lines(series_id);
```

**Multi-año = una fila por año**, no columnas 2027/2028/2029/2030. Permite editar
2028 sin tocar 2027 y hace triviales las queries por año. `series_id` las une
para la vista de proyección. La acción "proyectar" genera las filas de los años
siguientes aplicando `escalation_pct` — y quedan editables después.

**Headcount de staffing** (replica el sheet *Staffing (travel)*): alimenta las
líneas `source = 'calculated'`.

```sql
CREATE TABLE budget_headcount (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    year           integer NOT NULL,
    competition_id uuid REFERENCES competitions(id) ON DELETE CASCADE,
    role_label     text NOT NULL,   -- 'Technical Delegates', 'VGOs', 'VIP hold', …
    headcount      integer NOT NULL DEFAULT 0,
    UNIQUE (year, competition_id, role_label)
);

CREATE TABLE budget_assumptions (
    year              integer PRIMARY KEY,
    avg_flight_cost   numeric(12,2) NOT NULL DEFAULT 1050,
    notes             text
);
```

`línea de travel = headcount × avg_flight_cost`, recalculada al leer. Si alguien
edita el monto a mano, la línea pasa a `source = 'manual'` y deja de recalcularse.

**Metadata de competencia** que hoy falta:

```sql
ALTER TABLE competitions
    ADD COLUMN subzone text CHECK (subzone IN
        ('AMERICAS', 'CONSUBASQUET', 'CONCENCABA', 'CBC', 'GLOBAL')),
    ADD COLUMN tier integer CHECK (tier BETWEEN 1 AND 3);
```

### 034 — Gastos e ingresos ejecutados

> Va **antes** que el presupuesto a propósito: es el pedido original y se puede
> usar sin tener el presupuesto cargado. `budget_line_id` se agrega por `ALTER`
> en la 035, cuando existe la tabla a la que apunta.

```sql
CREATE SEQUENCE expense_record_seq START 1;

CREATE TABLE expenses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    record_no       text NOT NULL UNIQUE
                      DEFAULT 'GA-' || lpad(nextval('expense_record_seq')::text, 5, '0'),
    department_code text NOT NULL REFERENCES departments(code),
    account_code    text NOT NULL REFERENCES accounts(code),
    competition_id  uuid REFERENCES competitions(id) ON DELETE SET NULL,
    -- budget_line_id se agrega en la 035 (ALTER), junto con budget_lines

    payee_type      text NOT NULL DEFAULT 'vendor'
                      CHECK (payee_type IN ('vendor', 'employee', 'other')),
    vendor_id       uuid REFERENCES vendors(id) ON DELETE SET NULL,
    employee_id     uuid REFERENCES employees(id) ON DELETE SET NULL,
    payee_name      text,   -- fallback cuando no hay catálogo

    description     text NOT NULL,
    amount          numeric(12,2) NOT NULL DEFAULT 0,   -- USD
    expense_date    date NOT NULL,      -- fecha de la factura / del gasto
    payment_date    date,               -- cuándo se pagó

    status          text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','approved','paid','rejected','cancelled')),
    approved_by     uuid,
    approved_at     timestamptz,
    payment_method  text,
    bank_confirmation text,
    invoice_no      text,

    recurring_id    uuid REFERENCES recurring_expenses(id) ON DELETE SET NULL,
    comments        text,
    created_by      uuid,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

CREATE TABLE expense_attachments (  -- mismo patrón que payment_attachments
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id   uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    storage_path text NOT NULL,   -- storage://nominations/expenses/<id>/<uuid>.<ext>
    file_name    text NOT NULL,
    kind         text,            -- INVOICE / RECEIPT / CONTRACT / …
    uploaded_at  timestamptz DEFAULT now()
);

CREATE TABLE recurring_expenses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department_code text NOT NULL REFERENCES departments(code),
    account_code    text NOT NULL REFERENCES accounts(code),
    vendor_id       uuid REFERENCES vendors(id) ON DELETE SET NULL,
    description     text NOT NULL,
    amount          numeric(12,2) NOT NULL,
    frequency       text NOT NULL CHECK (frequency IN ('monthly','quarterly','annual')),
    day_of_month    integer DEFAULT 1,
    start_date      date NOT NULL,
    end_date        date,
    active          boolean NOT NULL DEFAULT true
);

CREATE TABLE revenues (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department_code text NOT NULL REFERENCES departments(code),
    account_code    text NOT NULL REFERENCES accounts(code),
    competition_id  uuid REFERENCES competitions(id) ON DELETE SET NULL,
    source_name     text NOT NULL,   -- 'FIBA HQ Grant', 'Enjoy Contract', …
    kind            text NOT NULL DEFAULT 'other'
                      CHECK (kind IN ('grant','sponsorship','hosting_fee','tv_rights','other')),
    description     text,
    amount          numeric(12,2) NOT NULL DEFAULT 0,
    expected_date   date,
    received_date   date,
    status          text NOT NULL DEFAULT 'expected'
                      CHECK (status IN ('expected','received','cancelled')),
    created_by      uuid,
    created_at      timestamptz DEFAULT now()
);

-- Permiso del módulo. Recordá: hay que tocar TRES lugares (ver CLAUDE.md §10):
-- este CHECK, MODULES en permissions.py, y MODULES en src/pages/Users.jsx.
ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_module_check;
ALTER TABLE user_permissions ADD CONSTRAINT user_permissions_module_check
  CHECK (module IN (… , 'budget'));
```

**Generación perezosa de recurrentes.** No hay cron. `GET /budget/recurring/pending?month=YYYY-MM`
devuelve las plantillas activas de ese mes que todavía no tienen un `expenses`
con ese `recurring_id` y ese período. El usuario confirma en bloque (ajustando
monto si la factura vino distinta) y recién ahí se crean las filas.

### 036 — Scoping por departamento + integración con payments

```sql
-- Scoping por departamento — PRIMERA vez que el sistema filtra filas por usuario.
CREATE TABLE budget_access (
    user_id         uuid NOT NULL,
    department_code text NOT NULL,   -- '*' = todos los departamentos
    can_view        boolean NOT NULL DEFAULT true,
    can_edit        boolean NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, department_code)
);
```

Los pagos a personas también deben consumir presupuesto:

```sql
ALTER TABLE payments
    ADD COLUMN department_code text REFERENCES departments(code),
    ADD COLUMN account_code    text REFERENCES accounts(code);
-- backfill desde payment_budgets: comms→? / competitions→competitions /
-- administration→admin / referees→competitions / bcla→club_competitions / it→it
```

`payment_budgets` **se mantiene** para no romper los pagos existentes, pero deja
de usarse en la UI: la dimensión pasa a ser `department_code` + `account_code`.

### 037 — Tarifario de fees

Del sheet *Fees Breakdown*. Cierra el circuito presupuesto → nominación → pago.

```sql
CREATE TABLE fee_schedule (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role         text NOT NULL CHECK (role IN ('REF','TD','VGO','REF_INSTRUCTOR')),
    event_type   text NOT NULL,
    fee          numeric(12,2) NOT NULL,
    incidentals  numeric(12,2) NOT NULL DEFAULT 0,
    valid_from   date NOT NULL DEFAULT '2026-01-01',
    active       boolean NOT NULL DEFAULT true,
    UNIQUE (role, event_type, valid_from)
);

ALTER TABLE competitions ADD COLUMN fee_event_type text;
```

`event_type` sale textual del Excel y **no** coincide con `template_key`
(WCQ/BCLA/LSB/GENERIC), por eso la columna nueva:

- `single_game_mens_qualifiers`
- `single_game_other`
- `tournament_6d_youth` / `tournament_6d_senior`
- `tournament_8d_youth` / `tournament_8d_senior`
- `womens_americup`
- `americup`

Al nominar, si la competencia tiene `fee_event_type`, se prellenan
`window_fee` e `incidentals` desde el tarifario — editables, como hoy.

---

## 4. Autorización

⚠️ **Este es el punto más delicado del módulo.** El sistema hoy no filtra filas
por usuario en ningún módulo: un permiso abre o cierra un endpoint entero.
`budget` sería el primero, y el filtrado **tiene que vivir en el backend** —
recordá que se pega a Supabase con `service_role`, que bypassa RLS.

Regla, en orden:

1. **Superadmin** (`user_profiles.is_superadmin`) → todo, siempre.
2. Sin `user_permissions.module = 'budget'` con `can_view` → 403, no ve el módulo.
3. Con el módulo abierto, los departamentos visibles salen de `budget_access`:
   - fila con `department_code = '*'` → **administrador general**, ve todo.
   - filas con departamentos concretos → ve solo esos. Puede tener `can_edit`
     en uno y solo `can_view` en otro (era el requisito: *"varios designados por
     áreas, con diferentes permisos"*).
   - sin filas → no ve nada, aunque tenga el módulo.

**Toda query filtra por `department_code IN (departamentos del caller)`**, no
solo la UI. Un endpoint del módulo sin ese filtro es un agujero P0 equivalente a
un endpoint sin `require_view`.

### Qué ve un designado dentro de una competencia

Una competencia cruza departamentos, y **la vista de evento las muestra todas**:
el designado de Competitions que abre "Women's AmeriCup 2027" ve el desglose
completo, incluidas las líneas de Comms e IT. El scoping por departamento aplica
a **cargar y editar**, no a leer el costo de un evento — sin el desglose entero
la cifra del evento no sirve para nada.

Concretamente: el filtro `department_code IN (departamentos del caller)` rige
las bandejas (`/budget/expenses`, `/budget/lines`) y toda escritura. La vista
`/budget/competitions/{id}/cost` es la excepción explícita y no filtra.

---

## 5. Endpoints

Router `api/_lib/routers/budget.py`, prefijo `/api/budget/*`,
`dependencies=[Depends(require_view("budget"))]` a nivel `APIRouter` y
`require_edit("budget")` en cada escritura, **más** el filtro por departamento.

```
# Catálogos
GET/POST/PATCH  /budget/departments
GET/POST/PATCH  /budget/accounts
GET/POST/PATCH/DELETE  /budget/vendors

# Presupuesto
GET   /budget/lines?year=&department=&account=&competition_id=&general_only=&kind=
POST/PATCH/DELETE  /budget/lines
GET   /budget/lines/series/{series_id}   # la misma línea a lo largo de los años
POST  /budget/lines/project              # genera años siguientes con escalación
GET   /budget/summary?year=&department=  # presupuestado / comprometido / ejecutado / restante
GET/PUT  /budget/headcount?year=
GET/PUT  /budget/assumptions/{year}

# Gastos
GET   /budget/expenses?year=&department=&account=&competition=&status=&vendor=&from=&to=
POST/PATCH/DELETE  /budget/expenses
POST  /budget/expenses/{id}/approve
POST  /budget/expenses/{id}/attachments
GET   /budget/expenses/{id}/attachments/{aid}/download    # blob + JWT, bucket privado
GET   /budget/recurring
POST/PATCH/DELETE  /budget/recurring
GET   /budget/recurring/pending?month=YYYY-MM
POST  /budget/recurring/generate       # confirma en bloque

# Ingresos
GET/POST/PATCH/DELETE  /budget/revenues

# Vista de costo de evento
GET   /budget/competitions/{id}/cost   # nominaciones + airfare + gastos vs presupuesto

# Tarifario
GET/PUT  /budget/fee-schedule

# Import / export del presupuesto en Excel (§13)
POST  /budget/import/lines/preview     # no escribe; propone el mapeo de columnas
POST  /budget/import/lines/commit      # con el mapeo que confirmó el usuario
GET   /budget/lines/export.xlsx        # la plantilla y el round-trip
```

Los adjuntos van al bucket privado `nominations` bajo `expenses/<id>/`, con
descarga por blob autenticado — **nunca** URL pública (ver CLAUDE.md §4 y §5).

---

## 6. Pantallas

Ruta `/budget`, lazy-loaded, envuelta en `<PermissionGuard module="budget">`.

1. **Presupuesto** — selector de año. Dos vistas del mismo dato:
   - **Matriz** (para Competitions): filas = cuentas, columnas = "General" +
     competencias. Totales por fila, por columna y general, igual que el Excel.
     El pivot se arma en el frontend a partir de `/budget/lines` — no hay
     endpoint `/matrix`: la celda necesita los `id` de las líneas para editarlas,
     así que devolver las líneas crudas evita un segundo viaje.
   - **Lista** (para IT): líneas agrupadas por cuenta con subtotales.
   - Acción "proyectar años siguientes" aplicando escalación.

   Dos reglas de la matriz que salieron de implementarla:
   - **La vista por defecto la decide el dato.** La matriz solo se gana su lugar
     si hay cruce real cuenta × evento: se abre en Matriz cuando ≥2 cuentas del
     departamento tocan competencias, y en Lista si no. El presupuesto de IT es
     casi todo overhead sin evento — una sola cuenta ("IT on Events") cruza —,
     así que su matriz salía con 7 filas × 8 columnas y 41 celdas vacías. El
     toggle manual manda hasta el próximo cambio de año o departamento.
   - **Las cuentas sin gasto por evento se pliegan.** Una cuenta cuya única
     cifra está en General no aporta nada a un cruce: se agrupan en una fila
     desplegable. En IT eso baja la grilla de 56 celdas a 16 (−71%); en
     Competitions pliega 1 de 21 y no cambia nada. Los totales se calculan
     sobre **todas** las cuentas, plegadas incluidas — la fila plegada lleva su
     suma y el total de la matriz no se mueve.
   - **Editar exige un departamento seleccionado.** Crear una línea necesita
     `department_code`, y con "todos" la matriz es un consolidado de varios
     departamentos: no hay forma de saber a cuál pertenece una celda nueva. Con
     "todos" la vista queda de solo lectura y lo dice en pantalla.
   - **Una celda puede tener varias líneas.** No hay constraint único sobre
     (año, departamento, cuenta, competencia) porque IT tiene 15 líneas sobre la
     cuenta 612300. Con una línea la celda se edita inline; con varias muestra
     la suma y abre el detalle. Vaciar una celda de una sola línea la borra.
2. **Gastos** — bandeja con filtros (departamento, cuenta, competencia, estado,
   proveedor, rango de fechas). Alta, edición, adjuntos, aprobar, marcar pagado.
3. **Recurrentes** — plantillas + el panel "pendientes de este mes".
4. **Ingresos** — bandeja simple.
5. **Proveedores** — catálogo.
6. **Costo del evento** — panel dentro de la competencia:
   `pagos a personas (nominaciones) + airfare + gastos del evento` vs.
   presupuestado, con el delta.
7. **Dashboard** — por departamento: presupuestado / comprometido / ejecutado /
   restante, y alerta de sobregiro.

Todo con los tokens del design system (leer `DESIGN_SYSTEM.md` antes de tocar
colores) e i18n ES/EN.

---

## 7. Plan de implementación

| Fase | Alcance | Entregable |
|------|---------|-----------|
| **1** ✅ | Migraciones **033-034** + router `budget.py` + catálogos + gastos + ingresos + proveedores + página | Se pueden cargar gastos por departamento, con o sin evento. Es el pedido original. |
| **2** ✅ | Migración **035**: presupuesto (`budget_lines`), matriz, lista, proyección | Presupuestado vs. comprometido vs. ejecutado. |
| **3** ✅ | Migración **036**: permisos por departamento + payments consume presupuesto | Designados con acceso acotado. |
| **4** ✅ | Recurrentes (panel del mes), dashboard, vista de costo del evento | Cierra el reporting. |
| **5** ✅ | Migración **037**: tarifario + headcount calculado | Circuito completo presupuesto ↔ nominación ↔ pago. El import histórico 2026 sigue pendiente: faltan los archivos. |

---

## 8. Alcance del "ejecutado"

Desde la migración 036, `/budget/summary` suma **las dos fuentes de gasto**:

| Fuente | Cuenta como ejecutado | Cuenta como comprometido |
|--------|----------------------|--------------------------|
| `expenses` | `status = 'paid'` | `status = 'approved'` |
| `payments` | `status = 'completed'` | `new` / `in_process` / `split` |

Los gastos se imputan al año por `expense_date`. Un pago **pagado** va por
`payment_date`; uno todavía abierto no tiene esa fecha y va por el año de su
competencia (migración 038 — antes no se filtraba por año y sumaba como
comprometido en todos). El **airfare** cuenta como una segunda fila de gasto
del pago, imputada a `airfare_account_code`.

Los pagos **sin departamento** (históricos, anteriores al backfill de la 036) se
reportan aparte en `unallocated_payments` y no se reparten a ciegas en ningún
total por área — así se ve qué falta clasificar en vez de esconderlo. La UI los
muestra en ámbar.

`excludes_person_payments` ahora devuelve `false`. El campo se mantiene para que
un frontend viejo cacheado no muestre una advertencia que ya no aplica.

### Cómo se aplica el recorte por departamento

Todo pasa por dos helpers de `budget.py` y hay un test que lo verifica
(`_scoped` en cada lectura, `_assert_can_edit` / `_row_or_403` en cada
escritura):

- **`_scoped(q, request, requested)`** resuelve el scope **y** el filtro que
  pidió el usuario **en un solo lugar**, a propósito. El query builder guarda un
  filtro por columna, así que un `.eq("department_code", x)` encadenado después
  de un `.in_()` **pisa el scope**: encadenarlos sería un bypass con solo pedir
  `?department=finance`. Nunca los encadenes.
- **Falla cerrado.** Sin filas en `budget_access` el usuario no ve nada, aunque
  tenga el permiso del módulo. El default opuesto convertiría un olvido del
  admin en una fuga de datos financieros.
- **404, no 403, sobre filas ajenas.** Un 403 distinguible confirmaría que el
  registro existe.
- **Mover una fila a otro departamento exige permiso sobre el destino**, no solo
  sobre el origen.
- **Los adjuntos heredan el departamento de su gasto** (`_attachment_or_403`).
  Se piden por su propio id, así que sin eso el scoping tendría una puerta
  trasera.
- **`/budget/access/{user_id}` es solo superadmin**: quién ve qué plata no lo
  decide alguien que ya tiene el módulo, o podría ampliarse el propio alcance.

---

## 9. Vista de costo del evento

`GET /budget/competitions/{id}/cost` junta las tres fuentes que hoy viven
separadas:

| Fuente | Qué aporta |
|--------|-----------|
| `payments` → `nominations` | fees de las personas nominadas |
| `payments.airfare` | pasajes, **línea aparte** en el desglose — se liquidan con la agencia y no son parte de lo que cobra la persona (migración 013) — pero desde la 038 sí entran al ejecutado y al comprometido, contra la cuenta de travel del rol |
| `expenses` | gasto del evento sin persona: shipping, branding, seguros |
| `budget_lines` | contra qué se compara |

⚠️ **Es la única excepción al recorte por departamento**: no llama a `_scoped()`
y muestra todos los departamentos, sea cual sea el acceso del caller. Fue
decisión explícita del cliente — el scoping rige cargar y editar, no leer el
total de un evento, y una competencia cruza departamentos. Sigue detrás de
`require_view("budget")` a nivel de router. La excepción está anotada en el
auditor de scope para que no se confunda con un olvido.

---

## 10. Datos cargados

Importados el 2026-08-11 desde los Excel (ver la memoria `budget-source-files`
para las rutas). El importador es de **dos pasos** como el resto del repo
(preview → `--commit`) e **idempotente**: marca las filas en `notes` y las borra
antes de reinsertar.

| Origen | Filas | 2027 |
|--------|-------|------|
| `FIBA_IT_Budget_2027-2030` | 92 (4 años × 23 líneas) | $215.015 |
| `CompsDraftBudget2027` | 168 | $970.416 |
| `2027_Budget_Comms_Americas` | 62 (54 + 8 del reparto U16) | $412.500 |

El de Comms se cargó el 2026-08-12 ya con el import del módulo
(`scripts/import_budget_comms_2027.py` solo aporta el mapeo acordado). Las
decisiones del cliente sobre sus 10 grupos:

- **BCLA ($100.000) y LSBF ($14.000) → General.** El Excel presupuesta la
  temporada y la base la modela por fases; imputarlo a una inflaría el costo de
  ese evento.
- **«U16 (Both) Boys & Girls» ($78.000) → 50/50** entre `FIBA U16 AmeriCup` y
  `FIBA U16 Women's AmeriCup`. La planilla no discrimina ("for both boys &
  girls"): el reparto es acordado, no un dato, y queda anotado en cada línea.
- **DIGITAL / SOCIAL MEDIA ($63.500) y EDITORIAL 24/7 ($45.000) → General**,
  que es lo que dice la planilla ("For All Events").
- **CentroBasket U15/U17 ($14.000) y South American U17 Women ($15.500) →
  afuera**: no existen en el calendario 2027. Cuando se creen se reimporta el
  mismo archivo y entran solas, sin tocar el resto.

Las 27 cuentas de Comms son provisorias `COMM-01`…`COMM-27`
(`pending_mapping = true`), como las `COMP-*`.

El departamento sale de la **línea**, no de la planilla: `COMP-15` y `COMP-16`
(Comms Expenses, TV Production) van a `comms` y `COMP-26` (IT on Events) a `it`,
aunque estén dentro del presupuesto de Competitions. Por eso IT 2027 da $269.015
— sus propios $215.015 más $54.000 que salen del presupuesto de Competitions.

### Lo que quedó afuera ⚠️

**$563.416 de $1.533.832** no se importó porque 4 columnas del Excel no tienen
un match seguro con la tabla `competitions`. **No se mandaron a "General"** a
propósito: General es una columna real del Excel ($166.500) y ensuciarla
arruinaría el reporte.

| Columna del Excel | Monto | Por qué |
|---|---|---|
| Liga Sudamericana | $323.316 | El Excel presupuesta la temporada; la base la modela en 6 fases (Group A-D, QFs, Finals) |
| Women's Basketball League Americas (WBLA) | $112.400 | La base solo tiene "WBLA – Final 4" |
| Draws (AmeriCup Q & AmeriCup W) | $82.900 | No es una competencia, es el evento del sorteo |
| Liga Sudamericana Femenina | $44.800 | Igual que LSB: el Excel es la temporada, la base son 3 fases |

Esto también explica que Comms figure con solo $20.000: $235.000 de sus
$267.000 de TV Production cuelgan de LSB y WBLA, que son de los no importados.

---

## 11. Tarifario y headcount (fase 5)

### El tarifario NO es una segunda fuente de verdad

El sistema ya resolvía fees por rol antes de este módulo: cada competencia tiene
`{td,vgo,ref,ref_instructor,video_operator}_window_fee` y `_incidentals`
(migraciones 003 y 016), que `sync-nominations` copia a cada nominación en
`_build_default_overrides` (games.py). `POST /budget/fee-schedule/apply`
**rellena esas mismas columnas** — no las reemplaza ni agrega un camino
paralelo. Después quedan editables por competencia: el tarifario es el default.

Por eso ese endpoint exige edición de **`budget` y de `competitions`**: escribe
en la tabla de otro módulo, y esos valores terminan en las cartas y los pagos.
Tener presupuesto no debería alcanzar para cambiarle el fee a un evento.

⚠️ **`incidentals` es POR CIUDAD** ("Incidentals x City" en el Excel). Se copia
tal cual; para un evento multi-sede hay que multiplicarlo a mano. El sistema no
sabe cuántas sedes tiene una competencia y multiplicar por una cuenta inventada
sería peor que dejarlo explícito. La UI lo advierte en ámbar.

`fee_event_type` es un eje **distinto** de `template_key`: dos competencias con
el mismo template pueden estar en escalones de fee distintos.

### Headcount → líneas de travel: cuidado con el doble conteo

`POST /budget/headcount/generate` replica lo que el Excel hace entre
`Staffing (travel)` y `Breakdown`: headcount × costo de vuelo promedio.

⚠️ **Las líneas de travel del Excel YA SON eso.** COMP-12, COMP-14, COMP-19 y
COMP-20 se calcularon así en la planilla, así que generar sobre un año que ya
las tiene cargadas duplicaría el presupuesto de viaje. El endpoint detecta los
pares (cuenta, competencia) que ya tienen una línea `manual`, los saltea y los
devuelve en `skipped_conflicts`; `replace_manual=true` los reemplaza.

Sobre 2027 esto da 65 conflictos y 8 líneas nuevas — y esas 8 son un hallazgo
real: el sheet `Staffing` lista gente viajando a los dos "U18 Qualifier 2" pero
el `Breakdown` les presupuestó **$0** en FA Staff Travel y TV Graphics Travel.
Es una inconsistencia del Excel de origen, no del sistema. Se revirtieron para
que lo importado siga cuadrando con la planilla.

---

## 12. Pendientes

> Superado por **§14** (revisión de agosto 2026): la hoja de ruta vigente son
> las fases 6-11 de esa sección. Lo de acá sigue pendiente y se repite en 14.13.

- **Plan de cuentas oficial de Finance.** Hasta que llegue, los códigos de
  Competitions son `COMP-01`…`COMP-28` con `pending_mapping = true`.
- **Gastos ejecutados 2026** para importar. Se importan al final, cuando estén
  los archivos.
- **Regla de visibilidad cruzada** dentro de una competencia (§4): decidida por
  defecto, confirmar con los designados cuando usen el módulo.


---

## 13. Import desde Excel

Lo que en §10 fue un script de una sola vez (`scripts/import_budgets_2027.py`)
ahora es una función del módulo: botón **Importar Excel** en la pestaña
Presupuesto → `api/_lib/services/budget_import.py`. Dos pasos, preview → commit,
como el resto de los importadores del repo.

**Lee las dos formas reales sin configuración**, detectando el encabezado por su
texto y no por posición (las planillas traen títulos arriba, celdas combinadas y
saltos de línea dentro del header):

- **lista** con código contable y columnas por año (`Annual 2027`…`2030`) → una
  fila por año, unidas por `series_id`. Es el de IT;
- **matriz** cuenta × competencia con su columna "General" → una línea por
  celda. Es el de Competitions;
- **lista jerárquica**: una fila por evento con su subtotal ("BCLA 100.000") y
  debajo sus líneas, anidada dos niveles ("EVENTS" contiene cuatro eventos). Es
  el de Comms, y ahí el evento **es** la fila de arriba;
- una planilla sin encabezados de dos columnas `concepto | monto` (el
  presupuesto de un solo evento), que se imputa entera a la competencia que se
  elija.

En la jerárquica los subtotales no se importan —su plata ya está en las líneas
de abajo— y se detectan con **dos** señales: la fila viene en negrita o menos
sangrada que la de abajo, **y** su monto es exactamente la suma de las filas que
le siguen. Hacen falta las dos: en el propio archivo de Comms "Draw 8.000"
coincide con las dos líneas siguientes (5.000 + 3.000) y con la aritmética sola
se robaba los hijos de BCLA. Si las sumas no cierran no hay árbol y la planilla
se lee plana.

### Las tres decisiones que lo definen

1. **Una columna dudosa no se importa.** Solo el match exacto del nombre vincula
   una columna a una competencia. La *contención* está topeada por debajo del
   umbral a propósito: "Women's AmeriCup" está contenido en "FIBA U16 Women's
   AmeriCup" y son eventos distintos. Lo dudoso se propone en el preview con su
   parecido y lo resuelve el usuario en un desplegable; lo que quede sin
   resolver se reporta con su monto y **queda afuera**. Nunca va a "General":
   General es una columna real del Excel y ensuciarla arruina el reporte — la
   misma regla que §10.
2. **Reimportar es la operación normal.** Una fila que matchea
   (año + departamento + cuenta + competencia + descripción), o que trae el `ID`
   que emite el export, **actualiza** la línea existente. No hay marcas de
   import ni versiones: sigue habiendo una sola versión vigente (decisión #6).
   `replace` —opcional, apagado— borra además lo que ya no está en la planilla,
   acotado a los departamentos y años que la planilla toca y listando cada línea
   antes de confirmar.
3. **El export ES la plantilla.** `GET /budget/lines/export.xlsx` emite las
   líneas del año en el formato que el import vuelve a leer, con la columna ID.
   El ciclo exportar → editar en Excel → subir no duplica nada.

**Cuentas.** La planilla de Competitions no trae códigos: la cuenta es el propio
"Expense Item", que se busca contra `accounts.label`. Lo que no matchea abre una
cuenta provisoria `<DEPT>-NN` con `pending_mapping = true` —siguiendo la serie
`COMP-01…28`— y el preview las lista antes de crear ninguna. Se puede apagar,
y entonces esas filas quedan como error en vez de importarse.

**Autorización.** `require_edit("budget")` más el recorte por departamento: se
valida el departamento elegido y las filas de un departamento que el caller no
puede editar salen como error. Una planilla puede tocar varios departamentos —
las líneas de Comms e IT viven dentro del presupuesto de Competitions—, así que
el chequeo es por fila, no solo sobre el departamento del formulario.

Validado contra los archivos reales: el de IT reproduce **$215.015** para 2027
(92 filas, 4 años) y el de Competitions **$970.416** con las 13 columnas
mapeadas, dejando afuera los mismos **$563.416** de §10.

---

## 14. Revisión de agosto 2026 — Budget + Payments como una sola herramienta

> Estado: **decisiones tomadas, implementación pendiente.** Esta sección es el
> contrato de lo que sigue; las fases 6-11 reemplazan a "§12 Pendientes" como
> hoja de ruta. Nada de acá está implementado todavía.

El pedido que abrió la revisión: que la sección sea **la herramienta de control,
diseño, manejo y trazabilidad del presupuesto de los departamentos**, y que
Payments relacione **todo** el gasto derivado de una competencia — el personal,
pero también lo que implica operar el evento.

### 14.1 Lo que la revisión encontró roto

Seis cosas, en orden de cuánta plata se pierde de vista con cada una:

1. **El puente Payments → Budget está cortado en el alta.** La migración 036
   agregó `payments.department_code` y `account_code` y backfilleó lo histórico,
   pero ni `create_payment`/`update_payment` (`routers/payments.py:193-245`) ni
   `src/pages/Payments.jsx` los escriben nunca: la UI sigue usando el catálogo
   viejo `payment_budgets`, que es justamente el que mezcla departamento y línea
   y que la 036 vino a reemplazar. **Todo pago cargado desde la 036 en adelante
   cae en `unallocated_payments`** y no aparece en ningún total por área. El
   summary lo reporta en ámbar, así que el síntoma se ve; la causa no.
2. **El airfare no consume presupuesto en ningún lado.** `/budget/summary` suma
   `payments.total` (= amount + extra) y `competition_cost` lo devuelve como
   línea aparte, fuera de `executed`. Pero el presupuesto sí tiene líneas de
   viaje — COMP-07, 09, 12, 14 — que entonces muestran 100% de remanente para
   siempre, aunque los vuelos estén pagados.
3. **Los pagos abiertos no se filtran por año en el summary.** En
   `budget.py:884` la guarda es
   `if status == "completed" and not payment_date.startswith(year): continue`.
   Un pago `new`/`in_process`/`split` no tiene `payment_date`, así que **no se
   descarta nunca**: los pagos abiertos de 2026 suman como comprometido en el
   total de 2027, de 2028 y de cualquier año que se consulte. Se arregla
   imputándolos por el año de la competencia de su nominación, que es el dato
   que sí existe.
4. **El gasto de evento sin persona ya existe, pero en otra pantalla y con otro
   permiso.** Shipping, branding, seguros y doping van a `expenses` (pestaña
   Gastos, permiso `budget`); las personas van a Payments (permiso `payments`).
   Quien opera un evento necesita dos permisos y dos pantallas para ver el mismo
   gasto, y ninguna de las dos le muestra el evento completo salvo el panel de
   costo.
5. **Dos ciclos de estado que no se hablan:** `expenses` es
   `draft→approved→paid` con aprobador; `payments` es
   `new→in_process→split→completed` sin aprobación de ningún tipo.
6. **Trazabilidad a medias.** El activity log (middleware de `api/index.py`)
   registra método + path + id, deliberadamente sin body. Sirve para "quién tocó
   qué"; no responde "esta línea pasó de $80.000 a $95.000, quién y cuándo".

### 14.2 Decisiones

| # | Decisión | Por qué |
|---|----------|---------|
| 1 | **Payments pasa a ser la bandeja única del gasto de un evento**: personas nominadas *y* proveedores/gasto operativo en una sola grilla, con alta de ambos desde ahí. | Es el pedido literal. Budget queda como la herramienta de **diseñar y controlar** el presupuesto; Payments, la de **ejecutarlo** contra un evento. |
| 2 | La bandeja se abre con el permiso **`payments`**, y sus filas se recortan con el mismo **`budget_access`** que Budget. | Quien opera un evento ve el evento entero (una competencia cruza departamentos), pero solo carga y edita en los suyos. Es la regla que `competition_cost` ya aplica — deja de ser una excepción y pasa a ser la norma de la sección. |
| 3 | **El airfare consume presupuesto**, imputado a la cuenta de *travel* del rol de la persona. | Cierra las líneas de viaje, que hoy nunca se consumen. Requiere una segunda cuenta en el pago: el fee va a COMP-11 y el vuelo de la misma persona a COMP-12. |
| 4 | **Aprobación de un solo nivel, sin umbral**: el designado con `can_edit` del departamento aprueba cualquier monto de su área. Los pagos a personas entran al mismo circuito, que hoy no tienen. | Se evita inventar un escalamiento que nadie pidió. El control real ya lo da el recorte por departamento: nadie aprueba plata ajena. |
| 5 | **Todo en USD**, como hoy. Quien carga convierte antes de ingresar. | Sin columna de moneda ni tipo de cambio: cero cambios de schema y ningún FX que mantener. |
| 6 | **El remanente descuenta lo comprometido**: `presupuestado − ejecutado − comprometido`. | Un gasto aprobado o un pago pendiente ya reservó la plata. El ejecutado se sigue mostrando aparte. |
| 7 | **El presupuesto administrativo anual se respeta como tal** — IT y Admin son la operación anual de FIBA Américas, no un evento. Siguen siendo `competition_id = NULL`, la columna "General". | Ya está bien modelado. Disfrazarlo de evento sería peor: ensuciaría el reporte por competencia con overhead que no pertenece a ninguna. |
| 8 | **Entidad nueva `budget_events`** para el gasto que no es ni competencia del calendario ni overhead anual: Draws, workshops, y las **temporadas** de las ligas. | Ver 14.3 — dos problemas distintos que resultan tener la misma solución. |
| 9 | **Las temporadas presupuestan, las fases ejecutan.** Las fases del calendario cuelgan de un `budget_event` temporada; el presupuesto vive arriba, el gasto real se imputa a la fase donde ocurrió y el reporte suma hacia arriba. | Es la forma del dato real: el Excel presupuesta la temporada de Liga Sudamericana, la base modela sus 6 fases. Ninguna de las dos está mal. |
| 10 | **Hospedaje y comidas quedan fuera** del presupuesto. Logística sigue sin hablarse con Budget. | Decisión del cliente: se liquidan por fuera del sistema. |
| 11 | **Resultado por evento**: el panel de costo muestra ingresos contra gasto total. | `revenues` ya guarda `competition_id`; la cifra está, falta cruzarla. |

### 14.3 `budget_events` — por qué una sola entidad para dos problemas

Quedaron sin resolver dos cosas que parecían distintas:

- **Los Draws de AmeriCup ($82.900) y los workshops de TDs.** Son operaciones
  reales con gasto propio, pero no son competencias del calendario ni overhead
  anual. Hoy no tienen dónde vivir salvo General, que los vuelve invisibles.
- **Liga Sudamericana ($323.316), LSF ($44.800) y WBLA ($112.400).** El Excel
  presupuesta la temporada entera; `competitions` tiene las fases sueltas
  (Group A-D, QFs, Finals) y **ninguna noción de temporada ni de fase** — no hay
  parent, ni grupo, ni nada que las una.

Las dos necesitan lo mismo: **un contenedor de gasto con identidad propia, que
no es una competencia**. Uno sin hijos es un Draw; uno con las fases colgadas es
una temporada. Una entidad, dos usos:

```sql
-- 039 (propuesta — la 038 se la llevó el puente de payments, fase 6)
CREATE TABLE budget_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    year            integer NOT NULL,
    department_code text NOT NULL REFERENCES departments(code) ON UPDATE CASCADE,
    kind            text NOT NULL CHECK (kind IN ('season', 'draw', 'workshop', 'other')),
    start_date      date,
    end_date        date,
    active          boolean NOT NULL DEFAULT true,
    notes           text
);

-- Las fases de una liga cuelgan de su temporada. NULL = competencia suelta,
-- que es el 90% del calendario.
ALTER TABLE competitions ADD COLUMN budget_event_id uuid
    REFERENCES budget_events(id) ON DELETE SET NULL;

-- Presupuesto y gasto pueden apuntar al contenedor en vez de a una competencia.
ALTER TABLE budget_lines ADD COLUMN budget_event_id uuid REFERENCES budget_events(id) ON DELETE SET NULL;
ALTER TABLE expenses     ADD COLUMN budget_event_id uuid REFERENCES budget_events(id) ON DELETE SET NULL;
```

**No aparece en nominaciones, logística ni juegos.** Es una entidad del módulo
Budget: no tiene partidos, ni crew, ni cartas. La alternativa —darlos de alta
como `competitions` con una marca de "no deportiva"— obligaría a que media
docena de módulos aprendan a filtrarlas, y el primero que se olvide manda un
Draw a la lista de nominables.

**Regla de rollup:** el costo de un `budget_event` es el suyo propio **más** el
de sus competencias hijas. Una fase nunca se cuenta dos veces porque su gasto
vive solo en ella; lo que sube es la suma, no una copia.

Con esto entran los **$563.416** que hoy quedan afuera del import (§10): las
columnas del Excel que no matcheaban pasan a matchear contra un
`budget_event` en vez de contra una competencia que no existe.

### 14.4 El airfare y su cuenta

Un pago tiene hoy **una** `account_code`, pero paga dos cosas que son líneas
distintas del presupuesto: el fee de la persona y su vuelo. Se agrega
`payments.airfare_account_code`, con este default por `personnel.role`:

| Rol | Fee | Travel |
|-----|-----|--------|
| `TD` | COMP-11 Technical Delegate Fees | COMP-12 Technical Delegate Travel Expense |
| `VGO` | COMP-13 TV Graphics Operator Fees | COMP-14 TV Graphics Operator Travel Expenses |
| `REF` | COMP-10 Referees Fees | COMP-07 Referees Travel Expense |
| `REF_INSTRUCTOR` | COMP-08 Referee Instructor / Commissioners Fees | COMP-09 Referee Instructor / Commissioners Travel Expense |
| `VIDEO_OPERATOR` | ⚠️ sin cuenta | ⚠️ sin cuenta |

El mapeo de fees es el mismo que ya hizo el backfill de la 036; el de travel es
su columna paralela en el Excel de Competitions. **`VIDEO_OPERATOR` no tiene
cuenta asignada** — el backfill de la 036 tampoco se la dio — y queda como
pregunta abierta (14.13): es un rol distinto de `VGO` en este sistema, aunque el
Excel solo trae "TV Graphics Operator".

⚠️ **No hay doble conteo con las líneas calculadas de headcount.** Esas líneas
son *presupuesto* (headcount × costo de vuelo promedio); el airfare imputado es
*ejecutado*. Son los dos lados de la misma comparación, no dos sumas del mismo
número.

### 14.5 Fases

| Fase | Alcance | Por qué en este orden |
|------|---------|----------------------|
| **6** ✅ | **El puente y el año.** Departamento + cuenta obligatorios al crear/editar un pago, con prefill por rol; `airfare_account_code`; la UI de Payments migra de `payment_budgets` a departamento + cuenta; los pagos abiertos se imputan por el año de su competencia; backfill de lo cargado sin imputar desde la 036. Migración **038**. Ver 14.6. | Es el bug que hace que la plata no se vea. Alto valor, bajo riesgo, sin schema nuevo salvo una columna. |
| **7** ✅ | **Remanente con compromiso** en `/budget/summary`, `competition_cost` y el dashboard. Ver 14.7. | Cambio de fórmula acotado, y hace falta antes de que alguien tome decisiones mirando el número viejo. |
| **8** ✅ | **Migración 039: `budget_events`**, rollup temporada → fases, y soporte del importador. Ver 14.8. El reimport de los $563.416 queda pendiente de los archivos. | Schema nuevo. Independiente de la 6 y la 7, se puede hacer en paralelo. |
| **9** ✅ | **Bandeja única del evento**: Payments muestra personas + proveedores + gasto operativo, con `budget_access` recortando filas y el alta de gasto de proveedor desde ahí. Ver 14.10. | Es la fase grande de UI y necesita que la 6 y la 8 ya hayan pasado: sin imputación ni contenedor de evento, la bandeja mostraría totales que no cierran. |
| **10** ✅ | **Aprobación de un nivel** para gastos y pagos, con bandeja de pendientes del departamento. Migración **040**. Ver 14.11. | Depende de la 9: la bandeja de aprobación vive en la misma pantalla. |
| **11** ✅ | **Resultado por evento**: ingresos contra costo total en el panel de la competencia y del `budget_event`. Ver 14.12. | Cierra el reporting. Necesita el rollup de la 8. |

### 14.6 Fase 6 — cómo quedó implementada

Migración **038**, `routers/payments.py`, `routers/budget.py`, `Payments.jsx`.

**Un pago ahora imputa a dos líneas, no a una.** El fee va a `account_code` y el
vuelo a `airfare_account_code` — son cuentas distintas del Excel de
Competitions, y mientras el airfare no tuvo cuenta propia las líneas de viaje
(COMP-07, 09, 12 y 14) mostraron 100% de remanente aunque los vuelos estuvieran
pagados. `_payment_expense_rows()` en `budget.py` parte cada pago en esas dos
filas antes de los rollups, así que el reparto por cuenta sale solo. El airfare
**no** es parte de `payments.total` (migración 013), de modo que sumarlo como
fila propia no lo cuenta dos veces.

**`_resolve_imputation()` en `payments.py` es la única puerta.** El departamento
es obligatorio y no se deriva: el mismo rol lo paga Competitions en un evento y
Club Competitions en otro. Las dos cuentas sí salen del rol (`_ROLE_ACCOUNTS`,
el mismo mapeo que el backfill de la 038 — si cambia uno, cambian los dos), lo
que deja el formulario en un clic para los cuatro roles que tienen línea.
**Un rol sin mapeo devuelve 400 en vez de un NULL silencioso:** un pago sin
imputar es plata que desaparece de todos los totales por área, que es
exactamente el bug que esta fase vino a cerrar. Hoy el único caso es
`VIDEO_OPERATOR` (14.13), que se carga eligiendo la cuenta a mano.

Dos detalles que salieron de implementarlo:

- **La imputación se recalcula en cada edición**, no solo cuando la tocan. Bajar
  el airfare a 0 tiene que **limpiar** la cuenta de viaje: un cero estacionado
  en COMP-12 se lee como una línea consumida. Y de paso, una fila vieja sin
  departamento queda clasificada la primera vez que alguien la abre, en lugar de
  seguir invisible para siempre.
- **`budget_code` perdió su `NOT NULL`** y dejó de escribirse. `payment_budgets`
  se mantiene porque es lo que hace legible un pago de 2024, y el endpoint
  `GET /payments/budgets` sigue en pie para un SPA cacheado; ningún camino nuevo
  lo usa. Por la misma razón el filtro `?budget=` del listado sobrevive junto al
  `?department=` nuevo: ignorarlo en silencio le mostraría totales sin filtrar a
  alguien que cree haber filtrado.

**El año de un pago abierto** sale de la competencia de su nominación
(`created_at` de respaldo para las pocas competencias sin año). Antes la guarda
solo descartaba los `completed` de otro año, así que un pago abierto de 2026
sumaba como comprometido en 2027, 2028 y cualquier año consultado.

Verificado sobre las dos funciones puras: los 12 casos de `_resolve_imputation`
(defaults por rol, override manual, limpieza del vuelo, rol sin mapeo,
departamento y cuenta inexistentes) y los 7 de `_payment_expense_rows` (el corte
por año en las dos ramas, las dos filas con cuentas distintas, el pago sin
imputar que conserva el `None`, y el airfare en cero que no genera fila).

⚠️ **La 038 no va en el deploy automático:** aplicarla a mano contra Supabase
*antes* de que salga el código, o el alta de pagos falla al escribir una columna
que no existe.

### 14.7 Fase 7 — el restante descuenta lo comprometido

`remaining = budgeted − executed − committed`, en los cuatro lugares que lo
calculaban: los totales y el rollup de `/budget/summary`, y los totales y el
desglose por departamento de `competition_cost`. `executed` y `committed` se
siguen devolviendo por separado, así que la cifra vieja se reconstruye sumando.

**La barra de progreso cambió con la fórmula.** "Usado" pasa a ser
ejecutado + comprometido, que es lo mismo que ahora descuenta el restante. Sin
eso una fila con restante negativo en rojo podía mostrar la barra verde al
lado: el sobregiro lo causaba lo comprometido y la barra solo miraba lo
ejecutado. Los dos segmentos siguen separados —verde lo que ya salió, azul lo
reservado— y se tiñen de rojo juntos cuando la suma pasa el presupuesto.

### 14.8 Fase 8 — `budget_events`

Migración **039**, `routers/budget.py`, `services/budget_import.py`, y la pestaña
Eventos de `Budget.jsx`.

**Una tabla, dos usos.** `budget_events` sin competencias colgadas es una bolsa
suelta (un Draw, un workshop); con `competitions.budget_event_id` apuntando a
ella es una temporada. El CHECK `*_one_target` en `budget_lines`, `expenses` y
`revenues` impide que una fila apunte a una competencia **y** a un evento: con
las dos cargadas contaría en los dos rollups y el total del año quedaría
inflado sin que se note dónde.

**El rollup pliega la fase en su temporada.** `_stamp_target()` en el summary
resuelve, para cada fila, `budget_event_id → temporada de su competencia →
competencia`. Sin eso la temporada saldría con presupuesto y cero ejecutado, y
cada fase con ejecutado y cero presupuesto: dos mitades que no se comparan con
nada. El desglose por fase vive en `GET /budget/events/{id}/cost`.

**`_cost_core()` es ahora uno solo.** `/competitions/{id}/cost` y
`/events/{id}/cost` son el mismo cálculo con distinto alcance; duplicarlo era
garantizar que en tres meses dieran cifras distintas para la misma plata. El
desglose por fase sale de las filas que el core ya trajo — llamarlo una vez por
fase multiplicaba las consultas contra una base con rate limit.

**"General" ahora significa sin NINGÚN evento.** `general_only=true` en los
listados de líneas y gastos exige que `competition_id` y `budget_event_id` sean
los dos nulos. Sin la segunda condición el gasto de un Draw aparecería como
overhead anual y ensuciaría justo el reporte que la decisión 7 quiere preservar.

**El importador matchea eventos igual que competencias.** El pool de
`match_competition` pasa a ser competencias + eventos del año, y el destino se
parte en la columna que corresponda al armar la fila. Mientras `budget_events`
esté vacía el pool es idéntico al de antes, así que **no puede cambiar el
resultado de un import ya validado** — el de IT sigue dando $215.015 y el de
Competitions $970.416. Los $563.416 entran cuando existan los eventos y estén
los archivos.

### 14.9 Auditoría de las fases 6 y 7 — qué se corrigió

Dos agentes auditaron el código y la UI de las fases 6 y 7. Lo que salió, en
orden de plata involucrada:

1. **P0 — un pago `completed` desaparecía de todos los años.** `/budget/summary`
   imputa un pago pagado por `payment_date`, pero la columna es nullable, no
   tiene el CHECK que sí tiene `expenses`, y **el formulario de Payments nunca
   tuvo un campo de fecha**. Al marcar un pago como pagado la fila se quedaba
   sin año y se caía del ejecutado, del comprometido, de los tres rollups y
   hasta de `unallocated_payments`. Con la fase 7 el efecto se duplicaba: bajaba
   el comprometido *y* subía el restante. **Pagar hacía ver el presupuesto más
   disponible.** Arreglado por los dos lados: `_payment_date_for()` estampa hoy
   al pasar a `completed` y limpia al salir (lo mismo que ya hace el módulo de
   gastos), y el corte por año usa el año de la competencia como respaldo
   también en la rama `completed`, para las filas históricas.
2. **Desactivar una cuenta congelaba los pagos históricos.** `_resolve_imputation`
   exigía `active` incluso sobre códigos que venían de la fila y que el usuario
   no había tocado. El día que Finance desactive la provisoria COMP-13 —que es
   exactamente para lo que existe `PATCH /budget/accounts`— todos los pagos de
   esa cuenta habrían quedado ineditables, con un 400 nombrando un código que el
   formulario ya no ofrece. Ahora el parámetro `changed` marca qué mandó el
   request: eso se valida contra el catálogo activo, lo heredado solo por
   existencia.
3. **El vuelo sin cuenta se escondía en "General".** Tiene departamento (lo
   hereda del fee), así que el ámbar de `unallocated_payments` no lo veía, y su
   `account_code` nulo lo mandaba al bucket general contra un presupuesto de
   cero. Se reporta aparte en `unallocated_accounts`.
4. **Borrar un comentario no lo borraba.** `update_payment` filtraba los `None`
   del `model_dump()`, así que vaciar un campo era indistinguible de no
   mandarlo. Pasa a `exclude_unset=True`.
5. **Se borró la superficie muerta de `payment_budgets`.** La justificación
   escrita —"un SPA cacheado lo pide"— no se sostenía: un SPA viejo manda
   `budget_code` sin departamento y `_resolve_imputation` lo rechaza igual, o
   sea la compatibilidad ya estaba rota del lado de escritura. Se fueron
   `GET /payments/budgets`, `_valid_budget`, el filtro `?budget=` y el campo de
   los schemas. **La columna `payments.budget_code` y la tabla `payment_budgets`
   se quedan**: son dato histórico, no necesitan superficie de API.

⚠️ **Riesgo aceptado hasta la fase 9:** Payments valida que el departamento
exista, no que el caller pueda gastar de él. Alguien con `payments.can_edit` y
sin filas en `budget_access` puede imputar al presupuesto de otra área, y el
responsable de esa área no puede corregirlo porque Payments todavía no recorta
por departamento. No es un problema de confidencialidad sino de integridad, y
existe desde que la fase 6 conectó la plata. Lo cierra la fase 9.

### 14.10 Fase 9 — la bandeja única del evento

`GET /payments/event` devuelve en una sola respuesta las personas nominadas con
su pago y el gasto operativo de la competencia. Payments deja de ser "la
pantalla de los nominados": quien opera un evento ve todo lo que ese evento
gasta sin necesitar el permiso `budget`.

**Las escrituras delegan, no reimplementan.** `/payments/event-expenses` llama a
`create_expense` / `update_expense` / `delete_expense` del router de Budget, que
ya validan cuenta, destinatario, coherencia de pagado y el departamento contra
`budget_access`. Duplicar esas validaciones era garantizar que en tres meses las
dos pantallas trataran distinto la misma tabla.

⚠️ Se las puede llamar como funciones porque **no tienen defaults de `Query()`**.
El repo ya se quemó con eso: un `Query()` sin resolver llega como objeto truthy
y se convierte en un filtro fantasma — es el bug que dejó `/payments/summary` en
$0.00. Si alguna vez alguien le agrega un `Query()` a esas tres, este atajo deja
de servir y hay que extraerlas a un servicio.

**Un gasto cargado desde la bandeja pertenece siempre al evento**
(`_event_expense_target`). Sin esa guarda, `payments` sería una puerta lateral
para cargar el overhead anual de un departamento sin tener el permiso `budget`.

**El recorte llegó a Payments.** `_assert_can_spend()` exige `budget_access` con
`can_edit` sobre el departamento al que se imputa, y sobre el de origen cuando
un pago se mueve de área. Las lecturas siguen sin recortar —la bandeja muestra
el evento entero, que es el punto—, y `/payments/imputation` marca cada
departamento con `can_edit` para que el formulario no ofrezca lo que el backend
va a rechazar.

⚠️ **La lectura de gastos de la bandeja es una excepción explícita al scope**,
igual que `competition_cost`. La primera versión la resolvía con
`_fetch_expenses`, que sí recorta, y el resultado era peor que un permiso de
más: las personas venían sin recortar y los gastos recortados, así que
`grand_total` **daba distinto para cada usuario**. Una cifra de portada que
cambia según quién la mira no sirve para reportar nada. La excepción se escribe
local y a la vista en `event_tray`, y **no** como un flag en `_fetch_expenses`:
un parámetro que apaga el scope dentro del helper que lo garantiza es
exactamente lo que alguien después usa sin darse cuenta. Cada fila viaja con su
`can_edit`.

**El catálogo de proveedores y empleados lo sirve `/payments/imputation`.** El
alta de un gasto operativo exige `vendor_id` o `employee_id`, y esas tablas
están detrás de `budget` y `employees`: sin esto, la bandeja de la fase 9 solo
dejaba cargar destinatarios sueltos escritos a mano, o sea que no era usable con
un solo permiso. Se sirven `id` y `name` y nada más — los datos bancarios y
fiscales son justamente lo que hace sensible a `vendors`. Es el mismo patrón que
`/staffing/candidates`, que sirve el picker de empleados para no exigirle el
permiso `employees` a quien planifica.

⚠️ **REQUISITO DE DEPLOY.** `budget_access` falla cerrado: un usuario no
superadmin **sin filas ahí no puede cargar ni editar pagos**. Hay que sembrarlo
antes de que salga esta versión, o el módulo de pagos queda inutilizable para
todos menos el superadmin. Es el mismo trámite que otorgar el permiso `budget`,
solo que ahora también condiciona a Payments.

### 14.11 Fase 10 — aprobación

Migración **040**. Un nivel y sin umbral: el designado con `can_edit` sobre el
departamento aprueba cualquier monto de su área (§14.2, decisión 4). El control
lo da el recorte por departamento — nadie aprueba plata ajena —, no un
escalamiento por monto que nadie pidió.

**Eje separado del status, no un estado más.** `new/in_process/split/completed`
vienen del legacy vbills y describen dónde está el trámite bancario;
`approved_at` dice quién dio el OK. Meter `approved` en el mismo enum obligaría
a decidir si un pago aprobado que volvió de finanzas es `approved` o
`in_process`, y la respuesta es "las dos". Es la misma separación que ya usa
`expenses`.

**Dónde tiene dientes:** un pago sin aprobar no puede pasar a `completed`, que
es exactamente el estado que consume presupuesto en `/budget/summary`. Sin esa
guarda, aprobar sería decorativo. Tampoco puede nacer `completed`, que sería la
puerta de atrás.

El backfill de la 040 deja aprobados los pagos ya completados, con
`approved_by` en NULL: no hay a quién atribuirles esa aprobación y estampar un
usuario cualquiera sería inventar un dato de auditoría. Sin ese backfill,
cualquier edición sobre un pago histórico dispararía un 400 pidiendo una
aprobación imposible de dar retroactivamente.

`GET /payments/pending-approval` **sí** filtra por departamento, a diferencia
del resto de las lecturas de Payments: es una bandeja de trabajo, y ver ahí lo
que no podés aprobar es solo ruido.

### 14.12 Fase 11 — resultado por evento

`_cost_core` suma `revenues` y devuelve dos lecturas, a propósito:

- **`result`** = recibido − ejecutado. Lo que ya pasó.
- **`projected_result`** = (recibido + esperado) − (ejecutado + comprometido).
  Cómo termina el evento si todo lo esperado entra y todo lo comprometido sale.

Una sola cifra obligaría a elegir entre ser prudente y ser útil. Con las dos, la
distancia entre ellas es en sí misma la información: si son muy distintas, el
resultado del evento depende de plata que todavía no se movió.

### 14.13 Auditoría de las fases 8 a 11 — qué se corrigió

Segunda ronda de auditoría, sobre el backend de las fases 8-11. Salió otro P0 y
cinco problemas de integridad:

1. **P0 — la aprobación no tenía dientes, tenía guillotina.** `approved_at` no
   estaba en el `select` de `update_payment`, así que la guarda "un pago sin
   aprobar no puede pasar a `completed`" leía siempre `None`. Aprobar un pago y
   después completarlo daba 400, y —peor— **cualquier edición sobre un pago ya
   completado** (corregir un comentario, reimputar la cuenta) también, porque el
   status recalculado seguía siendo `completed`. Era exactamente el escenario
   que el backfill de la 040 existe para evitar, reintroducido ignorando la
   columna que ese backfill llena.
2. **La bandeja validaba después de escribir.** `update_event_expense` llamaba a
   `update_expense` y recién entonces verificaba que el gasto siguiera colgando
   del evento. Sin transacción, un PATCH con `competition_id: null` ya había
   movido el gasto al overhead anual del departamento y el 400 llegaba con el
   daño hecho. Ahora el merge se hace antes y se valida sobre el resultado
   previsto. `delete_event_expense`, además, no validaba nada: quien tenía
   `payments` y no `budget` podía borrar por id cualquier gasto de su
   departamento, incluidas las líneas generales.
3. **Proyectar una temporada la mandaba a General.** `project_budget` copiaba
   `competition_id` pero no `budget_event_id`, así que las líneas 2028-2030 de
   Liga Sudamericana nacían sin evento: la temporada quedaba con presupuesto $0
   y ejecutado real —la mitad huérfana que la fase 8 vino a eliminar— y el
   overhead anual quedaba inflado con plata de la liga.
4. **Se podían robar las fases de un evento ajeno.**
   `PUT /events/{id}/competitions` no miraba si la competencia ya colgaba de
   otra temporada: la desprendía en silencio, y con ella todo su ejecutado.
   Ahora eso exige permiso de edición sobre el departamento del dueño actual —
   el mismo criterio que mover una línea de departamento— y si no, devuelve 409
   nombrando el evento dueño.
5. **`delete_payment` era la única escritura sin recorte.** Borrar el pago de
   otra área hace desaparecer plata de su ejecutado y de su bandeja de
   aprobación, que es la misma falla de integridad que imputarle gasto.
6. **La aprobación no se invalidaba al cambiar lo aprobado.** Se podía aprobar
   un pago por $500 y editarlo a $50.000 con el sello puesto, o moverlo a otro
   departamento con un OK que el responsable de ese departamento nunca dio.
   Ahora cambiar monto, extra, airfare, departamento o cuenta lo devuelve a
   pendiente.

Del importador: un update podía dejar cargadas **las dos** columnas de destino
y violar el CHECK a mitad de un commit que escribe fila por fila sin
transacción, o —peor, en silencio— no mover a General una línea que la planilla
mandaba ahí; el export no emitía el evento, así que el round-trip perdía el
destino; y el pool de eventos no estaba recortado al alcance del que importa.

Y tres cosas menores que valen la pena anotar: `/budget/summary` sumaba los
ingresos de **todos** los años (preexistente, pero la fase 11 los convirtió en
cifra de portada), un gasto cargado desde la bandeja podía nacer `paid` sin que
nadie lo aprobara, y `by_competition` era un campo que nunca salía del backend
porque los dos endpoints lo descartaban.

⚠️ **Sobre el alcance real de la aprobación.** Con un nivel y sin umbral, el que
puede editar es el mismo que puede aprobar: `approve_payment` exige exactamente
lo mismo que `update_payment`. La aprobación **no agrega segregación de
funciones** — agrega un acto explícito y un registro de quién lo hizo. Está
alineado con la decisión 4, pero conviene tenerlo claro: si en algún momento hace
falta que apruebe alguien distinto del que carga, hay que separar los permisos,
no ajustar esta fase.

### 14.14 Preguntas abiertas

- **`VIDEO_OPERATOR` no tiene cuenta de fee ni de travel** (14.4). ¿Va contra
  COMP-13/COMP-14 junto con los VGO, o es una línea propia que el Excel no trae?
- **Historial de montos.** El activity log no guarda valores (14.1 #6). ¿Hace
  falta historial campo a campo — quién cambió un monto, de cuánto a cuánto — en
  las líneas de presupuesto, en los gastos, o en ninguno?
- **Plan de cuentas oficial de Finance** — sigue pendiente desde §12. Mientras
  tanto los códigos `COMP-*` y `COMM-*` son provisorios.
- **Gastos ejecutados 2026** para importar: faltan los archivos.
- **A quién se le otorga `budget` y `payments`,** y qué filas de `budget_access`
  lleva cada designado. Hoy el permiso `budget` no está sembrado a nadie y
  `budget_access` vacío significa que nadie ve nada.
