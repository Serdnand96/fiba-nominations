# BUDGET_MODULE.md — Diseño del módulo de Presupuesto y Gastos

> Estado: **completo** (agosto 2026) — las 5 fases implementadas — más el
> **flujo de trabajo** de octubre 2026 (rama `feat/finance-workflow`): aprobación
> de gastos con aprobador separado, pagos como pipeline, historial de estados,
> campana de notificaciones, dashboard con gráficos y exports a Excel.
>
> Migraciones del módulo: **033-037** (aplicadas a prod), **041** y **045-050**.
> Las 038-040 son de otros módulos (checklists, hora UTC, ventanas FIBA). Todas
> se aplican **a mano** antes del push (CLAUDE.md §17).
>
> Código: `api/_lib/routers/budget.py` (**55 endpoints**),
> `api/_lib/routers/payments.py` (26), `api/_lib/routers/notifications.py` (4);
> `src/pages/Budget.jsx` es un shell de 6 pestañas (+ Cuentas para el admin
> general) que viven en `src/pages/budget/`, y `src/pages/Payments.jsx` uno de 2
> en `src/pages/payments/`.
>
> Queda pendiente de terceros: el plan de cuentas de Finance, los gastos
> históricos 2026 de Competitions y Comms (los de IT ya están, §10) y la
> cadencia de los recurrentes de IT (ver §12).
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
| 3 | Aprobación con **aprobador separado** (`budget_access.can_approve`, migración 048) e **historial** | Hasta octubre 2026 era un solo sello (`approved_by` + `approved_at`): el mismo designado cargaba, aprobaba y marcaba pagado. Ahora quien carga no aprueba (`created_by ≠ aprobador`); el superadmin puede sobre lo propio solo con motivo, y queda como override (§4, §14). |
| 4 | Presupuesto **multi-año**, por departamento **y** por competencia | El de IT proyecta 2027-2030; el de Competitions presupuesta por evento. |
| 5 | **Solo el gasto pagado consume presupuesto** | Lo aprobado-no-pagado se reporta aparte como *comprometido*. |
| 6 | **Una sola versión vigente** del presupuesto, editable | Sin tabla de versiones. Los cambios quedan en el activity log existente (migración 018). |
| 7 | Todo en **USD** | Sin multi-moneda, sin tipo de cambio. |
| 8 | Recurrentes por **plantilla con generación perezosa** | Nada corre por cron; los gastos esperados del mes se muestran al abrir el mes y se confirman en bloque. |
| 9 | Hotel y transporte: **Logística queda puramente operativa** | El host los asume casi siempre. Cuando FIBA sí paga (ej. "Hotel Extra Nights" de AmeriCup W), va como gasto normal. Nunca se derivan costos desde Logística → cero doble conteo. |
| 10 | **Ingresos** también se registran | El Summary de Competitions tiene *Expected Revenue* y *Grant Requested*. |
| 11 | `status` **nunca por PATCH/PUT**: solo por `POST /{id}/transition`, con una función pura por máquina | Es lo que hace cumplir la máquina de estados, el motivo obligatorio y la traza (§14). Con el status en el PATCH, un `{"status": "paid"}` se saltea todo. |
| 12 | Completar un pago exige el permiso no-página **`payments_approve`**, además de `payments:edit` | Completar es soltar la plata. Payments no está recortado por departamento, así que un flag en `budget_access` no aplica; el precedente es `comp_days` (migración 030). |
| 13 | **`split` eliminado** (migración 047): el pago parcial es un `in_process` con `paid_amount` | `split` escondía cuánto se había pagado y el summary no sabía qué contar como ejecutado (§8). |
| 14 | Notificaciones **in-app, sin cron ni email** | Las *novedades* se escriben en el mismo handler que produce el evento; los *pendientes* se calculan en vivo en cada poll. Volumen ínfimo, nada que operar en el droplet (§15). |
| 15 | Gráficos con **`recharts`** en un chunk propio (`charts`), cargado con `React.lazy` solo desde el Dashboard | Las barras CSS no dan para una serie mensual; ninguna otra página paga el chunk. |
| 16 | Datos bancarios y W-8 **por persona** (`personnel_banking`), no adjuntos a cada pago | Se cargaban como PDF en cada pago porque `personnel` no tenía campos bancarios (§16). |

---

## 3. Schema

Migraciones `033` → `037`, `041` y `045` → `050`. Todas las tablas con RLS
activada y **sin políticas** (backend-only vía `service_role`), igual que
`payments` — son datos financieros sensibles.

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

### 041 — Departamento de cada budget de pagos

`payment_budgets.department_code` (FK a `departments`, `ON UPDATE CASCADE`),
con backfill de los 6 códigos. Es de dónde sale el departamento de un pago (§8).

### 045 — Cuentas del Video Operator

`INSERT` de `COMP-29` (Video Operator Fees) y `COMP-30` (Video Operator Travel
Expenses), `pending_mapping = true`. `VIDEO_OPERATOR` es rol de `personnel` desde
la 016 pero no tenía cuentas: sus pagos nacían sin imputar.
`api/_lib/budget_accounts.py` lo mapea a 29/30. No backfillea: no había pagos a
ese rol en prod.

### 046 — Historial de estados

```sql
CREATE TABLE finance_status_history (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type       text NOT NULL CHECK (entity_type IN ('expense', 'payment')),
    entity_id         uuid NOT NULL,     -- sin FK: expenses.id o payments.id
    from_status       text,              -- NULL en el alta
    to_status         text NOT NULL,
    changed_by        uuid,
    changed_by_email  text,              -- foto, por si se borra el usuario
    changed_at        timestamptz NOT NULL DEFAULT now(),
    reason            text,
    meta              jsonb              -- {"override": …}, {"bulk": true}, payment_date, …
);
CREATE INDEX idx_finance_status_history_entity
    ON finance_status_history (entity_type, entity_id, changed_at DESC);
```

Append-only por convención. Si se borra el gasto o el pago, su historial queda
huérfano a propósito (§14).

### 047 — Pipeline de pagos

- `payments.status`: CHECK `('new','in_process','completed','cancelled')`. Los
  `split` pasaron a `in_process` **sin** `paid_amount` (no hay forma de saber
  cuánto se había pagado).
- Columnas nuevas: `paid_amount numeric(12,2)`, `completed_by`, `completed_at`,
  `cancelled_by`, `cancelled_at`, `cancel_reason`.
- CHECKs: `payments_paid_amount_range` (`paid_amount` entre 0 y
  `amount + extra`) y `payments_completed_has_date`
  (`status <> 'completed' OR payment_date IS NOT NULL`). Backfill: los
  completados sin fecha toman la de su última edición y `paid_amount = amount + extra`.
- `payment_attachments.kind` NOT NULL, default `OTHER`, CHECK
  `('EXPENSES','W8','BANK_INFO','INVOICE','RECEIPT','OTHER')`, con las etiquetas
  viejas normalizadas.
- Tabla `personnel_banking` (§16):

```sql
CREATE TABLE personnel_banking (
    personnel_id        uuid PRIMARY KEY REFERENCES personnel(id) ON DELETE CASCADE,
    payment_method      text CHECK (payment_method IN ('wire', 'ach', 'other')),
    bank_name           text,
    bank_address        text,
    account_holder      text,
    account_number      text,
    routing_number      text,
    swift               text,
    iban                text,
    currency            text NOT NULL DEFAULT 'USD',
    notes               text,
    tax_form_kind       text CHECK (tax_form_kind IN ('W-8BEN', 'W-8BEN-E', 'W-9', 'exempt')),
    tax_form_path       text,   -- storage://nominations/banking/<personnel_id>/<uuid>.pdf
    tax_form_file_name  text,
    tax_form_signed_at  date,
    tax_form_expires_at date,
    updated_by          uuid,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
```

- Permiso **`payments_approve`** en el CHECK de `user_permissions.module` (los
  otros dos lugares: `MODULES` en `permissions.py` y `MODULES` +
  `VIEW_ONLY_MODULES` en `src/pages/Users.jsx`).

### 048 — Aprobación de gastos

- `budget_access.can_approve boolean NOT NULL DEFAULT false`.
- `expenses`: `rejected_by`, `rejected_at`, `rejection_reason`, `paid_by`,
  `paid_at`, `cancelled_by`, `cancelled_at`, `cancel_reason`. `paid_at` es
  cuándo se marcó pagado en el sistema; `payment_date`, cuándo salió la plata.
- Índice `idx_expenses_status_dept (status, department_code)` para la bandeja
  de pendientes.
- Backfill: la fila `'*'` con `can_edit` pasa a `can_approve = true`; sin eso,
  al deployar nadie podía aprobar (salvo un superadmin con override). Los 129
  gastos `paid` de IT 2026 quedan con `paid_by` NULL: son carga histórica.

### 049 — Notificaciones

```sql
CREATE TABLE notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL,          -- destinatario, sin FK (insert en lote)
    kind        text NOT NULL,          -- clave estable; el front traduce por kind
    title       text NOT NULL,          -- fallback legible (≤ 300)
    body        text,                   -- ≤ 2000
    entity_type text,
    entity_id   text,
    link        text,                   -- ruta del front, p.ej. /budget?tab=expenses&open=<id>
    read_at     timestamptz,            -- NULL = no leída
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_inbox ON notifications (user_id, read_at, created_at DESC);
```

Solo las *novedades* se guardan; los *pendientes* no (§15).

### 050 — Traza de la última edición financiera

`expenses` y `payments` ganan `last_financial_edit_by uuid`,
`last_financial_edit_by_email text` (foto del email al editar, como
`changed_by_email`) y `last_financial_edit_at timestamptz`: el **último** usuario que cambió un campo
de plata (en gastos: departamento, cuenta, competencia, monto, fecha, tipo y
destinatario, línea de presupuesto; en pagos: `amount`, `extra`, `airfare`,
`budget_code`, también vía `sync-amount`). Es la segunda pata de la separación
de funciones: sin esto, A podía llevar a $10.000 un gasto de $100 que cargó B y
después aprobarlo, porque `created_by` seguía siendo B (§4, §14). Sin backfill:
`NULL` = nadie editó montos desde que existe la columna.

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

### Tres acciones: ver, editar, aprobar

`_departments_for(request, action)` resuelve los departamentos del caller para
`'view'` | `'edit'` | `'approve'` (columnas `can_view` / `can_edit` /
`can_approve` de `budget_access`). Devuelve `None` = todos (superadmin o fila
`'*'`), o la lista. Una acción desconocida **levanta** `ValueError`: antes caía
en `can_view` y un typo se convertía en permiso de lectura en silencio.

- **`can_approve` no se deduce de `can_edit`.** El que carga y el que aprueba
  son roles distintos; un aprobador puede no tener `can_edit`. Sí implica
  `can_view`: `PUT /budget/access/{user_id}` responde 400 si llega sin él, y
  `_departments_for` ignora una fila con `can_approve` sin `can_view` (por si
  alguien la carga a mano en SQL).
- **Ni el que cargó ni el último que tocó la plata.** Nadie aprueba un gasto
  que cargó (`created_by`) **ni uno cuyo último cambio financiero hizo él**
  (`last_financial_edit_by`, migración 050). El superadmin puede, **con
  motivo**, y queda `meta.override` en el historial (`self_approval` /
  `edited_then_approved`): Finance es una persona en la práctica, así que el
  control es la traza, no el bloqueo. La bandeja `?status=pending_approval` ya
  excluye los propios.
- `GET /budget/access/me/scope` devuelve `{is_superadmin, view, edit, approve}`;
  el front lo consume vía `BudgetScopeContext` (`src/pages/budget/scope.jsx`).
  En Usuarios, la grilla de departamentos tiene una tercera columna "Aprueba".
- Lecturas con otra acción (`_scoped(…, action='approve')`) intersectan con
  `view`: la bandeja de pendientes muestra drafts de los departamentos donde el
  caller aprueba **y** ve.

⚠️ **`POST /expenses/{id}/transition` y `/approve` no llevan `require_edit` en
el decorador, a propósito.** Aprobar es de `can_approve`, que no implica el
`can_edit` del módulo. El router ya exige `require_view("budget")` y
`check_expense_transition()` exige, por transición, `can_approve` sobre el
departamento del gasto, o ser "editor" (= `has_edit("budget")` **más**
`can_edit` del departamento), o superadmin. No hay camino que escriba sin uno de
los tres. No lo "arregles" agregando `require_edit`: dejaría afuera al aprobador
que no carga.

### Lo transversal: solo el admin general

"Admin general" = superadmin o fila `'*'` con `can_edit`
(`_is_general_admin()`; `_assert_general_admin()` levanta 403). Es para lo que
no pertenece a ningún departamento y por lo tanto no se puede recortar por fila:

- **Plan de cuentas:** `POST /accounts`, `PATCH /accounts/{code}` y
  `POST /accounts/{code}/remap`. Con solo `require_edit("budget")` el designado
  de IT podía renombrar una cuenta de Competitions.
- **Proveedores:** `DELETE /vendors/{id}`, cambiar `name` o `active` (renombrar
  o dar de baja un proveedor cambia el catálogo de todos los departamentos), y
  leer o escribir `bank_info` y `tax_id`. El resto recibe `has_bank_info: bool`;
  un POST/PATCH que traiga esos campos (aunque sea en `null`) es 403, la respuesta del PATCH también va
  recortada, y la búsqueda por `tax_id` solo corre para el admin (si no, sirve
  de oráculo). Cambiar el CBU de un proveedor es el fraude de manual.
- **Carga histórica:** crear un gasto directamente `paid`.

El **headcount** y los **supuestos** no son de admin general sino del
departamento que alimentan: `PUT /headcount` y `PUT /assumptions/{year}` exigen
`_assert_can_edit(request, "competitions")`, y `POST /headcount/generate` exige
edición del `department` que se le pasa (default `competitions`). Los GET
(`/headcount`, `/assumptions/{year}`) exigen **ver** Competitions: son el
insumo de su presupuesto de viaje.

---

## 5. Endpoints

Router `api/_lib/routers/budget.py`, prefijo `/api/budget/*`,
`dependencies=[Depends(require_view("budget"))]` a nivel `APIRouter` y
`require_edit("budget")` en cada escritura, **más** el filtro por departamento.

Son **55** (`grep -c "@router\." api/_lib/routers/budget.py`). Las marcas
entre corchetes son lo que se exige **además** de eso:

```
# Acceso por departamento
GET/PUT  /budget/access/{user_id}          [superadmin]
GET      /budget/access/me/scope           # {is_superadmin, view, edit, approve}; null = todos

# Catálogos
GET      /budget/departments?include_inactive=      # solo los que ve, cada uno con can_edit
GET      /budget/accounts?kind=&include_inactive=   # con used_by, recortado por scope
POST     /budget/accounts                  [admin general]
PATCH    /budget/accounts/{code}           [admin general]
POST     /budget/accounts/{code}/remap     [admin general]  # {new_code, force}; 409 si budget_accounts.py la usa
GET      /budget/vendors?search=&include_inactive=  # bank_info / tax_id solo para el admin general
POST     /budget/vendors                   # bank_info / tax_id solo admin general
PATCH    /budget/vendors/{id}              # ídem; name / active también solo admin general
DELETE   /budget/vendors/{id}              [admin general]  # baja lógica si tiene gastos

# Presupuesto
GET      /budget/lines?year=&department=&account=&competition_id=&general_only=&kind=
POST     /budget/lines
PATCH    /budget/lines/{id}
DELETE   /budget/lines/{id}
GET      /budget/lines/series/{series_id}  # la misma línea a lo largo de los años
POST     /budget/lines/project             # genera años siguientes con escalación
GET      /budget/lines/export.xlsx?year=&department=&kind=&lang=   # la plantilla y el round-trip (§13)
POST     /budget/import/lines/preview      # no escribe; propone el mapeo de columnas
POST     /budget/import/lines/commit       # con el mapeo que confirmó el usuario
GET      /budget/summary?year=&department=          # totales, rollups, by_month, by_status (§8)
GET      /budget/summary/export.xlsx?year=&department=&lang=   # 5 hojas, mismo _summary_data
GET      /budget/headcount?year=           [ver competitions]
PUT      /budget/headcount                 [edit de competitions]
POST     /budget/headcount/generate?year=&department=&replace_manual=   [edit del department]
GET      /budget/assumptions/{year}        [ver competitions]
PUT      /budget/assumptions/{year}        [edit de competitions]

# Gastos
GET      /budget/expenses?year=&department=&account=&competition_id=&general_only=
                         &status=&vendor_id=&date_from=&date_to=&search=&mine=
         # status=pending_approval → drafts que el caller aprueba, sin los propios
         # mine=1 → solo los que cargó el caller
GET      /budget/expenses/summary?year=&department=&account=&competition_id=&general_only=&date_from=&date_to=
GET      /budget/expenses/export.xlsx?(los filtros de la bandeja)&lang=
POST     /budget/expenses                  # nace draft; `paid` directo solo admin general
PATCH    /budget/expenses/{id}             # sin status ni payment_date (§14)
DELETE   /budget/expenses/{id}             # solo draft / rejected / cancelled
POST     /budget/expenses/{id}/transition  [sin require_edit, ver §4]  # única forma de cambiar status
POST     /budget/expenses/{id}/approve     [sin require_edit, ver §4]  # alias de transition → approved
GET      /budget/expenses/{id}/history
GET      /budget/expenses/{id}/attachments
POST     /budget/expenses/{id}/attachments
GET      /budget/attachments/{aid}/download          # blob + JWT, bucket privado
DELETE   /budget/attachments/{aid}

# Recurrentes
GET      /budget/recurring?include_inactive=
POST     /budget/recurring
PATCH    /budget/recurring/{id}
DELETE   /budget/recurring/{id}
GET      /budget/recurring/pending?month=YYYY-MM
POST     /budget/recurring/generate        # confirma en bloque

# Ingresos
GET      /budget/revenues?year=&department=&competition_id=&status=
POST     /budget/revenues
PATCH    /budget/revenues/{id}
DELETE   /budget/revenues/{id}

# Vista de costo de evento
GET      /budget/competitions/{id}/cost    # sin _scoped, a propósito (§9)

# Tarifario
GET      /budget/fee-schedule?event_type=
PUT      /budget/fee-schedule              [superadmin]
POST     /budget/fee-schedule/apply        [budget:edit + competitions:edit]
```

Toda escritura lleva `require_edit("budget")` salvo las dos de transición (§4)
y las de superadmin. Los dos exports nuevos (`/expenses/export.xlsx` y
`/summary/export.xlsx`) salen de la misma función que la pantalla
(`_expense_rows` → `_fetch_expenses` y `_summary_data`), así que pasan por el
mismo `_scoped()`: el Excel no trae nada que la pantalla no muestre.

Los adjuntos van al bucket privado `nominations` bajo `expenses/<id>/`, con
descarga por blob autenticado — **nunca** URL pública (ver CLAUDE.md §4 y §5).

### Pagos (`/api/payments/*`, router `payments.py`)

`require_view("payments")` a nivel router, `require_edit("payments")` en cada
escritura. 26 rutas; las de `/queue`, `/export.xlsx`, `/bulk*`, `/sync-amount`,
`/personnel/*` y `/attachments/*` están declaradas **antes** de `/{payment_id}`
para que no entren como id.

```
GET      /payments/budgets                 # catálogo payment_budgets (activos)
GET      /payments/nominees?competition_id=   # nominados del evento + su pago
GET      /payments?competition_id=&budget=&status=
GET      /payments/summary?competition_id=&budget=&status=
GET      /payments/queue?status=&year=&budget=&competition_id=&missing_docs=&stale=&cm_pending=&search=&limit=&offset=
         # → {items, total, limit, offset, totals}; status admite varios separados por coma
GET      /payments/export.xlsx?(los filtros de la cola)&lang=   # sin datos bancarios
POST     /payments                         # nace new
POST     /payments/bulk                    # {competition_id, budget_code, nomination_ids?} → {created, skipped}
POST     /payments/bulk-status             # {ids, status, reason?, payment_date?, bank_confirmation?} → {ok, failed}
POST     /payments/sync-amount             # {ids} → amount = nominations.total en new/in_process
GET      /payments/personnel/{pid}/banking            # enmascarado (§16)
POST     /payments/personnel/{pid}/banking/reveal     # números completos, auditado
PUT      /payments/personnel/{pid}/banking            # upsert parcial
POST     /payments/personnel/{pid}/banking/tax-form   # PDF ≤ 10 MB
POST     /payments/personnel/{pid}/banking/tax-form/download   # [payments:edit], auditado como reveal
DELETE   /payments/personnel/{pid}/banking/tax-form
DELETE   /payments/attachments/{aid}
GET      /payments/attachments/{aid}/download
POST     /payments/{id}/transition         # única forma de cambiar status (§14)
POST     /payments/{id}/record-partial     # {paid_amount, reason?}: pago parcial, mismo gating que completar
GET      /payments/{id}/history
POST     /payments/{id}/attachments        # kind normalizado a la lista de la 047
GET      /payments/{id}/attachments
GET      /payments/{id}                    # la fila de la cola (para ?open=<id>)
PUT      /payments/{id}                    # sin status ni paid_amount; según estado (§14)
DELETE   /payments/{id}                    # solo new / cancelled
```

### Notificaciones (`/api/me/notifications/*`, router `notifications.py`)

`require_user`, sin permiso de módulo (§15).

```
GET      /me/notifications?unread=&limit=&offset=   # → {items, unread_count, has_more}
POST     /me/notifications/read-all
POST     /me/notifications/{id}/read
GET      /me/notifications/pending                 # [{key, count, link}], calculado en vivo
```

---

## 6. Pantallas

Ruta `/budget`, lazy-loaded, envuelta en `<PermissionGuard module="budget">`.
`src/pages/Budget.jsx` es solo el shell: carga los catálogos compartidos y el
`BudgetScopeProvider`, y dibuja la pestaña activa con `<Tabs>`. La pestaña va en
la URL (`?tab=expenses`) y una pestaña puede abrir un registro con `?open=<id>`:
así los links de la campana caen directo en el detalle. Pestañas, en orden:
`dashboard` (Resumen) · `plan` (Presupuesto) · `expenses` (Gastos) ·
`recurring` (Recurrentes) · `revenues` (Ingresos) · `vendors` (Proveedores) ·
`accounts` (Cuentas, solo admin general). Cada una en
`src/pages/budget/*Tab.jsx`, los editores en `src/pages/budget/editors/`.

Los botones se deciden **por fila** con `useBudgetScope()`: "Nuevo" solo si el
usuario edita algún departamento, el select de departamento ofrece solo los
editables, y editar/borrar/aprobar sale de `canEditDept(row.department_code)` /
`canApproveDept(...)`. Es UX: el backend vuelve a decidir.

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
   - **Importar Excel** (§13), **proyectar** y **Ver serie** (en la vista
     Lista: la misma línea 2026-2030 en un modal, vía `/lines/series/{id}`).
   - Panel colapsable **Headcount y supuestos** (`HeadcountPanel.jsx`), visible
     para quien edita Competitions (o el admin general): grilla por evento y
     rol, costo de vuelo promedio y "Generar líneas de travel", con el aviso de
     doble conteo y los conflictos salteados (§11).
2. **Gastos** — bandeja con chips **Todos / Pendientes de aprobación (con
   contador) / Mis gastos** y filtros (departamento, cuenta, competencia,
   estado, proveedor, rango de fechas). Acciones por fila según la máquina de
   estados (`expenseActions()` en `ExpenseActionModals.jsx`, compartida con el
   editor): aprobar, rechazar, pagar, cancelar, reabrir, con modales de motivo o
   fecha. "Aprobar" no aparece sobre lo propio, salvo al superadmin, que lo ve
   como override con motivo. El editor (`ExpenseEditor`) muestra el
   `StatusHistory` y bloquea los campos financieros en `approved` (y todo menos
   comentarios y factura en `paid`).
3. **Recurrentes** — plantillas + el panel "pendientes de este mes".
4. **Ingresos** — bandeja simple; los ingresos sin fecha (que no imputan a
   ningún año, §8) se marcan en ámbar.
5. **Proveedores** — catálogo. `bank_info` y `tax_id` solo para el admin
   general; el resto ve el badge "Datos bancarios cargados".
6. **Cuentas** (solo admin general, `AccountsTab.jsx`) — plan de cuentas con
   las provisorias (`pending_mapping`) en ámbar, alta/edición y **"Asignar
   código oficial"** (`/accounts/{code}/remap`, con confirmación de `force` si
   la cuenta está en `budget_accounts.py`).
7. **Resumen** (dashboard) — año por defecto el actual, recordado en
   `localStorage.fiba_budget_year`. Tiles `Stat` (presupuestado / ejecutado /
   comprometido / restante, y "Sin imputar" en ámbar con link a la cola de
   pagos cuando hay), chips por estado (`by_status`), botones **Exportar
   resumen** / **Exportar gastos**, y tres gráficos (`src/components/charts/`,
   `recharts` con `React.lazy`): barras por departamento (presupuestado vs.
   ejecutado + comprometido), acumulado mensual contra el presupuesto
   prorrateado, y top 10 cuentas en barras horizontales; después, las tablas por
   departamento, competencia y cuenta. Debajo, el **costo del evento** — `pagos a personas (nominaciones) + airfare + gastos del evento`
   vs. presupuestado, con el delta — y el tarifario.

**Pagos** (`/payments`, `src/pages/Payments.jsx`) es otro shell con `<Tabs>`:

- **Cola de pagos** (`queue`, por defecto, `QueueTab.jsx`) — todos los pagos de
  todos los eventos. Filtros en la URL (`?status=&year=&budget=&missing_docs=1
  &stale=1&cm_pending=1&q=&page=`), tabla con selección múltiple y badges (W-8 ok / falta /
  vencido, sin banco, monto ≠ nominación, CM pendiente, parcial). Barra de
  acciones: **Cambiar estado…** (`BulkStatusModal.jsx`, muestra `failed[]` fila
  por fila), **Sincronizar monto**, **Exportar Excel**.
- **Por evento** (`event`, `EventTab.jsx`) — los nominados de una competencia y
  su pago, con **"Crear pagos para los nominados"** (`/payments/bulk`, muestra
  `skipped[]` con el motivo).
- Las dos abren `PaymentDrawer.jsx` (`?open=<id>`): botones de transición
  válidos (`validTransitions` en `payments/shared.js`; el backend manda),
  modal de motivo / fecha, **registrar pago parcial** (`/record-partial`; el
  monto pagado no es un campo editable del formulario), `BankingSummary`, `AttachmentList` con las
  etiquetas cerradas de la 047 y `StatusHistory`.
- La ficha bancaria completa (`BankingPanel.jsx`) se monta también en el perfil
  de la persona (`PersonProfilePanel`), **solo con `hasView('payments')`**.

**Campana** (`NotificationsBell.jsx`, en el topbar de `App.jsx`) — §15.

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
| **6** ✅ | Migraciones **045-050** (octubre 2026, rama `feat/finance-workflow`): bugs de reporte y permisos, historial, traza de la última edición financiera, pipeline de pagos, aprobación de gastos, notificaciones, UIs de cuentas / headcount / serie, dashboard con gráficos y exports, tests | El módulo pasa de formulario a flujo de trabajo (§14-§17). |

---

## 8. Alcance del "ejecutado"

Desde la migración 036, `/budget/summary` suma **las dos fuentes de gasto**:

| Fuente | Cuenta como ejecutado | Cuenta como comprometido | No cuenta |
|--------|----------------------|--------------------------|-----------|
| `expenses` | `paid` | `approved` | `draft`, `rejected`, `cancelled` |
| `payments` | `completed` (todo) · `in_process` hasta `paid_amount` | `new` (todo) · `in_process` el resto (`total − paid_amount`) | `cancelled` |

Desde la 047 los estados de un pago son `new` / `in_process` / `completed` /
`cancelled`; **`split` ya no existe**. El pago parcial es un `in_process` con
`paid_amount > 0` (se registra con `POST /payments/{id}/record-partial`, §14),
y `_payment_buckets(status, amount, paid_amount)` lo parte en
dos filas: lo pagado (con tope en el total) va a ejecutado y el resto a
comprometido. Es la misma función que usa `/competitions/{id}/cost`.
`paid_amount` es **del fee**: el pasaje se llama con `paid_amount=None` y sigue
entero como comprometido hasta `completed`.

### A qué año cae cada cosa

| Qué | Año | Helper |
|---|---|---|
| Gasto | `expense_date` | (filtro, ver abajo) |
| Pago `completed` | `payment_date`; si no tiene, el de la competencia | `payment_fiscal_year` |
| Pago `new` / `in_process` | el de la competencia (`competitions.year`, o el de `start_date`) | `payment_fiscal_year` |
| Pago `cancelled` | ninguno (no imputa); para **listarlo** (cola, `by_status`), el de `payment_date` o la competencia | `payment_fiscal_year` → `None` · `payment_status_year` |
| Ingreso `received` | `received_date` | `_revenue_year` |
| Ingreso `expected` | `expected_date`; sin fecha → ninguno | `_revenue_year` |
| Ingreso `cancelled` | ninguno | `_revenue_year` → `None` |

Las dos funciones de pagos viven en **`api/_lib/finance_years.py`**, compartido
por `budget.py` (que las re-exporta como `_payment_fiscal_year` /
`_payment_status_year`) y la cola de `payments.py`: antes había dos copias que
no coincidían en los cancelados.

Hasta octubre 2026 había tres bugs acá: un `completed` sin fecha desaparecía de
**todos** los años (la UI de Payments nunca la pedía; la 047 ahora la exige con
un CHECK y backfilleó los viejos), un pago abierto contaba como comprometido en
**cualquier** año que se consultara, y los ingresos no se filtraban por año. Los
años de pagos e ingresos se calculan en Python porque hace falta mirar el embed
(`nominations(competition_id, personnel(role), competitions(year, start_date))`)
o elegir entre dos columnas según el estado, y este builder no hace OR entre
columnas.

⚠️ **El bug de `gte` + `lte` sobre la misma columna.** El query builder de
`database.py` guarda **un filtro por columna**: `.gte("expense_date", a).lte("expense_date", b)`
deja vivo solo el `.lte`, y "gastos de 2027" devolvía también todos los
anteriores (los $41.667 de IT 2026 aparecían en 2027). Ahora a la base va solo
la cota inferior y el tope se aplica en Python (`_summary_data` y
`_fetch_expenses`). Es la misma trampa que obliga a `_scoped()` a resolver el
scope y el filtro del usuario en un solo `.eq`/`.in_` (más abajo).

### `by_month` y `by_status`

Salen de las mismas filas recortadas que los totales:

- **`by_month`**: siempre 12 meses (`YYYY-MM`, en cero los vacíos), con
  `executed` y `committed`. Un gasto `paid` va al mes de `payment_date` si cae en
  el año pedido, si no al de `expense_date`; uno `approved`, al de
  `expense_date`. Un pago comprometido va al mes en que arranca la competencia;
  uno ejecutado, al de `payment_date` (o al de la competencia si no tiene o cae
  en otro año). **Ninguna fila queda afuera**: si el mes calculado no es del año
  pedido (competencia 2027 que arranca en diciembre de 2026, pago sin
  `start_date`), `_clamp_month` la lleva a **enero** (anterior o sin mes) o a
  **diciembre** (posterior). Así `Σ by_month == totals.executed /
  totals.committed` y el acumulado del gráfico termina en la tarjeta.
- **`by_status`**: `{expenses: {draft…cancelled}, payments: {new…cancelled}}`,
  cada uno `{count, amount}`, en orden fijo aunque un estado no tenga filas.
  Incluye lo que no imputa (borradores, rechazados, cancelados): es "qué hay
  cargado", no "qué consume". Un pago `cancelled` se ubica en el año de su
  `payment_date` o de su competencia (`payment_status_year`). El monto de un
  pago es fee + pasaje.

### De dónde sale la imputación de un pago

La imputación de un pago (`department_code`, `account_code`) es **derivada, no
pedida al usuario**: sale del `budget_code` que ya eligió el formulario y del
rol de la persona nominada. La migración 036 lo hizo por SQL para los pagos que
ya existían; desde entonces lo hace también el write path de `payments.py`.
Editar el `budget_code` de un pago lo reimputa; el frontend de pagos no toca
esas columnas.

Ninguno de los dos mapeos vive dentro de `payments.py`, a propósito:

| | Dónde | Por qué ahí |
|---|---|---|
| budget → departamento | columna `payment_budgets.department_code` (migración **041**) | Es dato: agregar un budget obliga a decir de qué área sale. Un dict en código no sigue al catálogo. |
| rol → cuenta | `api/_lib/budget_accounts.py` | Lo comparte el read path: `budget.py` usa el mismo mapa para mandar el pasaje a la cuenta de travel. |

Cuando alguno devuelve `None` el backend **loguea un warning**. Sin eso el
agujero se abre en silencio y recién se nota cuando alguien pregunta por qué
creció el ámbar del dashboard.

### El pasaje va a la línea de travel, no a la de fees

Un pago aporta **dos** imputaciones, no una: el fee (`total` = amount + extra) a
la cuenta de fees del rol, y el pasaje (`airfare`, migración 013) a la de
travel. El plan de cuentas viene apareado, así que el destino no hay que
inventarlo:

| Rol | Fee | Travel |
|---|---|---|
| TD | COMP-11 | COMP-12 |
| VGO | COMP-13 | COMP-14 |
| REF | COMP-10 | COMP-07 |
| REF_INSTRUCTOR | COMP-08 | COMP-09 |
| VIDEO_OPERATOR | COMP-29 | COMP-30 (migración 045) |

Hasta agosto 2026 el pasaje **no consumía presupuesto en ningún lado**: el
summary ni lo miraba y la vista de costo lo mostraba como un número suelto que
no entraba en el ejecutado. Eran $284.446 de líneas de travel presupuestadas
para 2027 condenadas a figurar 100% disponibles para siempre. Ahora se suma
como una fila más del mismo pago, así que el ejecutado, el comprometido, los
tres rollups y el sin-imputar lo cuentan sin saber que existe un segundo
concepto.

⚠️ **Nunca imputar el pasaje a la cuenta del fee.** Infla una línea y deja la
otra en cero: es peor que dejarlo afuera, porque encima parece correcto.

Los pagos **sin departamento** se reportan aparte en `unallocated_payments` y no
se reparten a ciegas en ningún total por área — así se ve qué falta clasificar
en vez de esconderlo. La UI los muestra en ámbar. Con la derivación en el alta,
lo único que puede caer ahí es un `budget_code` o un rol sin mapeo: hoy los 6
códigos de `payment_budgets` y los 5 roles de `personnel` están cubiertos
(`VIDEO_OPERATOR` desde la 045; antes sus pagos caían acá), así
que **un pago nuevo nace imputado**. Un rol nuevo (o un budget nuevo) sin agregar
al mapeo vuelve a llenar esa bolsa en silencio.

`excludes_person_payments` ahora devuelve `false`. El campo se mantiene para que
un frontend viejo cacheado no muestre una advertencia que ya no aplica.

### Cómo se aplica el recorte por departamento

Todo pasa por dos helpers de `budget.py` y hay tests que lo verifican
(`tests/test_budget_scope.py`; `_scoped` en cada lectura, `_assert_can_edit` /
`_row_or_403` en cada escritura):

- **`_scoped(q, request, requested, action='view')`** resuelve el scope **y** el filtro que
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
| `payments.airfare` | pasajes, **línea aparte** — se liquidan con la agencia y no son parte de lo que cobra la persona (migración 013) |
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

**IT 2026: presupuesto y ejecutado** (2026-09-14, `scripts/import_it_2026.py`,
dos pasos e idempotente por marca en `notes` / `comments`):

| Qué | Filas | Total |
|-----|-------|-------|
| Presupuesto 2026 (mail de Finance, 8 cuentas) | 8 | $280.111 |
| Ledger enero–julio (`IT Budget July 2026.xlsx`, hoja `Data`) | 129 gastos `paid` | $41.667 |

- El presupuesto no vino en planilla sino en un mail de Finance, así que va
  hardcodeado en el script con el signo dado vuelta (el ledger lo muestra en
  negativo). Se crearon tres cuentas reales que faltaban en el plan: 610300
  (Office equipment / furniture), 611200 (Supplies, photocopies & printed
  materials) y 648500 (Technology Applications).
- **648500 ($82.711) es de `it` aunque la plata salga de Competitions.** Son los
  equipos de VGO y estadístico; el mail lo dice explícitamente. Mismo criterio
  que «IT on Events» en 2027: el departamento es quién ejecuta (§2).
- Cada gasto entra `paid` con `expense_date = payment_date` (el ledger tiene una
  sola fecha), `payee_type = 'other'` con el proveedor normalizado en
  `payee_name` (AT&T aparece de seis formas en el ledger) y la descripción de
  tarjeta cruda en `description`. No se crearon `vendors`. Cada gasto queda
  vinculado por `budget_line_id` a la línea 2026 de su cuenta.
- ⚠️ **612100 y 612200 vienen idénticas en el ledger** (ver §12). Se importaron
  las dos tal cual: el ledger es la fuente y elegir una sería adivinar. Sin el
  duplicado el ejecutado real es $38.796.
- Ejecutado a julio contra presupuesto: 611000 41%, 612100 24%, 612200 10%,
  612300 8%. Las otras cuatro cuentas no tienen movimientos en el ledger de IT.

**Recurrentes de IT 2027** (2026-08-27): 23 plantillas sembradas con
`scripts/seed_recurring_from_budget.py` desde las líneas ya importadas — 20
mensuales + 3 anuales, equivalente anual $215.015,04, el total de IT 2027 al
centavo. El panel del mes las empieza a pedir en **enero 2027** (23 en enero:
las 20 mensuales más las 3 anuales, que caen en el mes de inicio; 20 de febrero
en adelante), porque el presupuesto sembrado es el de 2027. Una segunda corrida
del script **no pisa lo editado a mano**: solo agrega lo que falte, salvo que se
le pase `--replace`.

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

- **Plan de cuentas oficial de Finance.** Hasta que llegue, los códigos de
  Competitions son `COMP-01`…`COMP-30` con `pending_mapping = true` (29 y 30
  son del Video Operator, migración 045). El remap ya tiene UI (Budget →
  Cuentas → "Asignar código oficial"): el `ON UPDATE CASCADE` mueve las filas
  ya escritas, pero `ACCOUNT_BY_ROLE` / `TRAVEL_ACCOUNT_BY_ROLE` en
  `api/_lib/budget_accounts.py` son dicts en Python y no lo siguen. Por eso
  `/remap` responde 409 sobre una cuenta que figura ahí, salvo `force=true`
  cuando el cambio a ese archivo va en el mismo deploy.
- **Gastos ejecutados 2026 de Competitions y Comms.** Los de IT ya están
  (§10, `scripts/import_it_2026.py`); los otros dos departamentos siguen sin
  archivo.
- **612100 / 612200 duplicadas en el ledger de IT 2026.** Finance imputó las
  mismas 8 filas ($2.870,98) a las dos cuentas. Están cargadas las dos con marca
  `DUP` en `comments`; cuando Finance diga cuál vale, se corrige el Excel y se
  reimporta.
- **Afinar la cadencia de los recurrentes de IT.** Las 23 plantillas ya están
  sembradas (§10). La cadencia sale de la CUENTA y no del proveedor —la
  planilla presupuesta un anual y no dice cada cuánto se factura, así que mirar
  el nombre sería adivinar—: servicios y suscripciones entran `monthly` con
  monto anual/12, y las compras puntuales (612100 hardware, 612200 reemplazos y
  mantenimiento) entran `annual` con el monto tal cual. Es un punto de partida:
  cada plantilla se ajusta en **Budget → Recurrentes**, que ya edita frecuencia,
  monto, día, proveedor y vigencia. Ojo al pasar una a anual: el monto sembrado
  es el mensual, hay que multiplicarlo.
- **Regla de visibilidad cruzada** dentro de una competencia (§4): decidida por
  defecto, confirmar con los designados cuando usen el módulo.
- **Datos bancarios y W-8 de cada persona.** `personnel_banking` existe (§16)
  pero arranca vacía: hay que cargar la ficha y el PDF de cada oficial antes de
  poder completar sus pagos.
- **Quién tiene `payments_approve` y `can_approve`.** Nadie tiene
  `payments_approve` por defecto, y `can_approve` solo lo recibió la fila `'*'`
  con `can_edit` (backfill de la 048). Lo asigna un superadmin en Usuarios.


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

## 14. Máquinas de estado e historial

Gastos y pagos tienen cada uno su máquina de estados. La regla es la misma para
los dos: **el `status` nunca se edita por PATCH/PUT**. Cambia solo por
`POST /{id}/transition`, que pasa por una **función pura** —recibe la fila, el
destino, el body y los derechos del caller ya resueltos; no toca la base—,
escribe, deja traza con `record_transition()` y avisa con `notify()`.

Por qué: con el status editable, el mismo designado que cargaba un gasto lo
aprobaba y lo marcaba pagado en un solo formulario, sin motivo ni traza, y
cualquiera con `payments:edit` marcaba `completed` sin fecha ni W-8. Un
`{"status": "paid"}` en el PATCH se saltearía la separación de funciones, el
motivo obligatorio y el historial.

Códigos de error de las dos funciones: **400** falta un dato que el usuario
puede mandar (fecha, motivo, monto); **403** no le corresponde al caller
(permiso, separación de funciones); **409** la transición no existe desde el
estado actual o una regla de negocio no la deja. Mismo estado de origen y
destino también es 409.

### Gastos — `check_expense_transition()` (`budget.py`)

`can_edit` = `has_edit("budget")` **y** `can_edit` sobre el departamento del
gasto; `can_approve` = `can_approve` sobre ese departamento. Los resuelve
`_run_expense_transition()`; la fila se trae con `_row_or_403(…, "view")` (sin
acceso al departamento → 404).

| De → A | Quién | Requisitos | Escribe |
|---|---|---|---|
| `draft → approved` | aprobador del depto; ni `created_by` ni `last_financial_edit_by` pueden ser el caller (403) | superadmin sobre lo propio o lo que editó él: `reason` (400 sin) → `meta.override = "self_approval"` / `"edited_then_approved"` | `approved_by/at` |
| `draft → rejected` | aprobador del depto | `reason` | `rejected_by/at`, `rejection_reason` |
| `draft → cancelled` | editor del depto | `reason` | `cancelled_by/at`, `cancel_reason` |
| `approved → paid` | editor del depto | `payment_date`; opcionales `payment_method`, `bank_confirmation` | `payment_date`, `paid_by/at` |
| `approved → draft` | aprobador del depto o superadmin | — | limpia `approved_*` |
| `rejected → draft` / `cancelled → draft` | editor del depto | — | limpia todos los sellos |
| `paid → approved` | solo superadmin | `reason` | limpia `paid_*` y `payment_date`; `meta.reverted_payment_date` |

**No hay `approved → cancelled`:** un aprobado se reabre (→ `draft`) y recién
ahí se cancela, así la cancelación la decide el editor sobre un borrador y no se
pierde el rastro de la aprobación.

Alrededor de la máquina:

- `POST /expenses` nace `draft`. `status = 'approved'` en el alta → 400; `paid`
  directo solo para el admin general (carga histórica, como los 129 de IT
  2026), con `meta.historical_load`.
- `PATCH /expenses/{id}`: `status` o `payment_date` distintos de los actuales →
  400 (iguales se ignoran: el editor manda el formulario entero). En
  `approved`, cambiar un campo financiero (departamento, cuenta, competencia,
  monto, fecha, destinatario) → 409 "reabrilo primero". En `paid` solo
  `comments` e `invoice_no`. Si el PATCH cambia un campo financiero, sella
  `last_financial_edit_by/at` (migración 050) y deja una fila en el historial
  (ver abajo).
- `DELETE` solo en `draft` / `rejected` / `cancelled`; lo demás → 409. El
  borrado también queda en el historial.
- `POST /expenses/{id}/approve` es un alias de `transition` con
  `status=approved` (body opcional, solo para el `reason` del override).

### Pagos — `check_payment_transition()` (`payments.py`)

El endpoint ya exige `payments:edit`. `has_approve` = superadmin o
`has_view(request, "payments_approve")`.

| De → A | Quién | Requisitos | Escribe |
|---|---|---|---|
| `new → in_process` | `payments:edit` | nominación `generated` (409); no `declined` (409). Sin W-8 vigente **no bloquea**: 200 con `warnings: ["tax_form_missing" \| "tax_form_expired"]` y novedad a los editores de payments | — |
| `in_process → completed` | `payments:edit` **+** `payments_approve` (o superadmin) (403); ni `created_by` ni `last_financial_edit_by` pueden ser el caller (403) — superadmin con `reason` (400 sin) → `meta.override = "self_completion"` / `"edited_then_approved"` | `payment_date` del body o la que ya tenía (400 sin); `paid_amount` **igual al total** si viene (400 si no; si no viene se fuerza al total); nominación no `declined`; `nominations.cm_approved` (409); W-8 `ok` o `exempt` (409); `has_bank_info` (409) | `payment_date`, `paid_amount = total`, `completed_by/at`, `bank_confirmation` si viene |
| `in_process → new` | `payments:edit` | sin plata pagada: `paid_amount > 0` → 409 | — |
| `new → cancelled` / `in_process → cancelled` | `payments:edit` | `reason` (400); sin plata pagada (409) | `cancelled_by/at`, `cancel_reason` |
| `cancelled → new` | `payments:edit` | — | limpia `cancelled_*` |
| `completed → in_process` | solo superadmin (403) | `reason` (400) | limpia `completed_by/at`; `payment_date` y `paid_amount` **quedan** |

Lo de "sin plata pagada" es porque budget solo lee `paid_amount` en
`in_process`: volver a `new` o cancelar con plata ya pagada la haría
desaparecer del ejecutado. Por lo mismo, reabrir un completado deja la fecha y
el monto: como `in_process` con `paid_amount`, budget lo sigue contando
ejecutado mientras se corrige. No hay `completed → cancelled`.

**Completar es pagar todo.** Un `completed` cuenta entero como ejecutado, así
que no puede llevar un `paid_amount` menor al total: eso es un pago parcial, y
tiene su propio endpoint.

**Pago parcial: `POST /payments/{id}/record-partial {paid_amount, reason?}`**
(`check_partial_payment()`, también pura). Registra cuánto lleva pagado un
`in_process` sin cambiar el estado; `paid_amount` es el **total pagado a la
fecha** (reemplaza al anterior, no se suma). Soltar plata es soltar plata, así
que lleva **el mismo gating que completar**: `payments_approve`, no ser el
creador ni el último que editó montos (superadmin con motivo, mismo
`meta.override`), nominación no declinada, CM aprobado, W-8 vigente y datos
bancarios. Además: solo sobre `in_process` (409), `0 ≤ paid_amount < total`
(el total entero es completar → 400), y **0 exige `reason`**: es la forma de
deshacer un parcial cargado por error. El UPDATE lleva lock sobre el estado
**y** el `paid_amount` anterior (dos parciales simultáneos → 409), y deja una
fila `in_process → in_process` en el historial con `meta.paid_amount` y
`meta.previous`. Es el único camino para escribir `paid_amount` fuera de
`completed`: el `PUT` ya no lo acepta.

Un pago parcial no vuelve a `new` ni se cancela (409): la salida es ajustar
`amount` / `extra` a lo que se pagó mientras está `in_process` y completarlo.

Alrededor de la máquina:

- `POST /payments` y `POST /payments/bulk` nacen `new`; otro `status` en el
  alta → 400.
- `PUT /payments/{id}`: cualquier `status` en el body → 400 "use /transition";
  `paid_amount` tampoco va por acá (400, `/record-partial`), y `amount + extra`
  no puede quedar por debajo de lo ya pagado (400). En `cancelled` → 409
  (solo lectura; se vuelve a `new` primero). En `completed` solo `comments` y
  `bank_confirmation`; lo demás → 409 "reabrilo primero". Usa `exclude_unset`:
  `null` limpia `comments` / `payment_date` / `bank_confirmation`; los montos y
  el budget no aceptan `null`. Si cambia `amount`, `extra`, `airfare` o
  `budget_code`, sella `last_financial_edit_by/at` y deja una fila en el
  historial. `POST /payments/sync-amount` hace lo mismo con cada pago que toca.
- `DELETE` solo en `new` / `cancelled`; lo demás → 409. El borrado queda en el
  historial.
- `POST /payments/bulk-status` aplica la misma transición ítem por ítem y
  **nunca aborta el lote**: `{ok: [{id, record_no, status, warnings}], failed:
  [{id, record_no, error, status_code}]}`, con `meta.bulk = true`. No acepta
  `paid_amount`: al completar en lote cada pago toma su total.
- `tax_form_status(banking) → ok | missing | expired | exempt` y
  `has_bank_info(banking)` también son puras; las usan la máquina, la cola y la
  campana, para que los tres digan lo mismo.

### Concurrencia

Cada `UPDATE` de una transición (y del PATCH/PUT/DELETE que dependen del
estado) lleva `.eq("status", <el que se validó>)`. Si otro usuario lo movió en
el medio, no matchea ninguna fila y la respuesta es 409 "changed meanwhile":
dos aprobadores que aprietan a la vez → uno gana, el otro recarga.

### Historial — `finance_status_history` (migración 046)

`api/_lib/services/finance_history.py`:

- `record_transition(entity_type, entity_id, from_status, to_status, request,
  reason=None, meta=None)` — inserta una fila con `changed_by` y
  `changed_by_email` del `request.state.user`. **Best-effort**, como
  `record_activity()`: si falla, warning y el request sigue (el estado ya se
  aplicó). Además de cada transición, deja traza de:
  - el **alta** (`from_status = NULL`);
  - cada **edición de plata** (PUT de un pago con `amount` / `extra` /
    `airfare` / `budget_code`, PATCH de un gasto con campos financieros,
    `sync-amount`, `record-partial`): fila con `from_status = to_status` y el
    detalle en `meta.edit` (de qué valor a cuál);
  - cada **borrado**: `to_status = 'deleted'`.
- `history_for(entity_type, entity_id)` — más reciente primero. **No autoriza**:
  el router lo hace antes. `GET /budget/expenses/{id}/history` valida el scope
  del gasto (`_row_or_403`); `GET /payments/{id}/history` no da 404 si el pago
  ya no existe, porque el historial sobrevive al borrado a propósito.

Convenciones de `meta`: `override` (el superadmin salteó la separación de
funciones, siempre con `reason`: `self_approval` / `self_completion` si lo creó
él, `edited_then_approved` si fue el último en tocar los montos), `edit`
(edición de plata sin cambio de estado: `{campo: {from, to}}`), `sync_amount`,
`previous` (el `paid_amount` anterior de un parcial), en los borrados la foto de
lo borrado (`record_no`, `amount`, …), `bulk: true`, `historical_load: true`, `payment_date`, `paid_amount`,
`reverted_payment_date`.

El `activity_log` no alcanza como traza: registra método + path + id pero no
guarda bodies, así que no sabe a qué estado pasó ni con qué motivo.

En el front, `src/components/StatusHistory.jsx` dibuja la timeline (badge por
estado, usuario, fecha, motivo) en el editor de gastos y en el drawer de pagos.

---

## 15. Notificaciones

La campana del topbar (`src/components/NotificationsBell.jsx`) muestra dos
cosas distintas, a propósito separadas:

| | Qué es | Dónde vive | Cómo se va |
|---|---|---|---|
| **Novedades** | algo puntual que pasó ("cargaron un gasto de IT para aprobar") | tabla `notifications` (049) | se marca leída |
| **Pendientes** | lo que espera una acción del caller ("tenés 3 gastos para aprobar") | **no se guarda**: `GET /me/notifications/pending` lo calcula en cada poll | desaparece al resolverse |

Persistir los pendientes obligaría a recalcularlos en cada alta, aprobación,
cambio de permiso y cambio de mes. **No hay cron ni email.** El front hace poll
cada 60 s y vuelve a pedir al recuperar el foco (`visibilitychange`); el badge
es `unread_count + Σ pending.count` (99+ como tope visual).

### El router: `/api/me/notifications`

Como `/me` (profile.py), **no lleva permiso de módulo**: es lo propio del
logueado, con `require_user` a nivel router (401 sin usuario, falla cerrado).
El aislamiento entre usuarios vive en el código, no en RLS: **toda** query
filtra por `user_id = caller`, incluido el `UPDATE` de marcar leída (id **y**
`user_id` en el mismo update: una ajena da 404, igual que una inexistente, sin
un SELECT previo que distinga "existe pero no es tuya").

`/pending` sí mira permisos de módulo, pero solo para decidir **qué contar**:
cada ítem se calcula únicamente si el caller tiene el permiso, devuelve
contadores y un link (nunca filas), solo aparece con `count > 0`, y si uno
falla se omite con warning sin tirar los demás. Sin permisos → `[]` sin
consultar nada.

| `key` | Se calcula si | Cuenta | `link` |
|---|---|---|---|
| `expenses_to_approve` | `has_view("budget")` | drafts de los departamentos donde aprueba (`_departments_for(…, "approve")`), sin los propios. Si las filas de `budget_access` no traen `can_approve` (048 sin aplicar) cuenta 0, salvo superadmin | `/budget?tab=expenses&status=pending_approval` |
| `payments_missing_docs` | `has_view("payments")` | pagos `in_process` cuya persona no tiene W-8 `ok`/`exempt` **o** no tiene datos bancarios (misma regla que la cola) | `/payments?tab=queue&status=in_process&missing_docs=1` |
| `payments_awaiting_cm` | `has_view("payments")` | pagos `in_process` con `cm_approved = false` | `/payments?tab=queue&status=in_process&cm_pending=1` |
| `recurring_pending` | `has_edit("budget")` | recurrentes del mes actual sin generar (`_pending_recurring`, pasa por `_scoped`) | `/budget?tab=recurring` |

### Quién recibe qué novedad

Las escribe `notify(user_ids, kind, title, body, entity_type, entity_id, link,
exclude)` (`api/_lib/services/notify.py`): un solo INSERT, deduplica,
**best-effort** (nunca levanta: el aviso es accesorio, la transición no). Se
llama desde el mismo handler que produce el evento. El autor de la acción
siempre va en `exclude`.

| `kind` | Cuándo | A quién |
|---|---|---|
| `expense_submitted` | alta de un `draft` (incluidos los que crea `/recurring/generate`: con varios en un departamento, **una** novedad que los resume y abre la bandeja de pendientes), o vuelta a `draft` (`approved`/`rejected`/`cancelled → draft`) | `budget_approvers_for(depto)`: filas de `budget_access` con `can_approve` para ese departamento o `'*'`, **y que además puedan entrar al módulo** (`budget` con `can_view`, o superadmin; una fila huérfana en `budget_access` no recibe avisos de algo que no puede abrir). **No suma superadmins sin fila** (aprobar es un rol asignado). Sin el creador |
| `expense_approved` | `draft → approved` (no la reversión `paid → approved`) | el creador |
| `expense_rejected` | `draft → rejected`, con el motivo como cuerpo | el creador |
| `expense_paid` | `approved → paid` | el creador |
| `payment_tax_form_missing` | `new → in_process` con warning de W-8 | `module_editors("payments")`: `can_edit` sobre payments **más** todos los superadmins |
| `payment_completed` | `→ completed` | el creador del pago |
| `payment_cancelled` | `→ cancelled`, con el motivo | el creador del pago |

El `link` de cada novedad abre el registro: `/budget?tab=expenses&open=<id>` o
`/payments?tab=queue&open=<id>`. El front traduce el título por `kind`
(`notifications.*` en i18n); `title` queda como fallback.

---

## 16. Datos bancarios por persona

`personnel_banking` (migración 047) es la ficha bancaria y fiscal **de la
persona**, no del pago: se carga una vez y vale para todos sus pagos. Antes el
W-8 y los datos bancarios se re-subían como PDF en cada pago porque `personnel`
no tiene ningún campo bancario.

- **Solo por el router `payments`**, bajo `/payments/personnel/{id}/banking`.
  Hereda el `require_view("payments")` del router: quien tiene `personnel` sin
  `payments` no llega ni al GET enmascarado. Nunca exponerla por `personnel.py`,
  que tiene otro permiso y otra audiencia. En el front, `BankingPanel` se monta
  en el perfil de la persona solo con `hasView('payments')` (UX; el backend es
  el que corta).
- **`GET …/banking` enmascara** `account_number`, `routing_number` e `iban`
  (`****` + últimos 4; un valor de 4 o menos caracteres sale `****`). SWIFT y
  banco no: son públicos y sin ellos no se reconoce la ficha. Si la persona no
  tiene ficha devuelve **200 con `exists: false`**, no 404 (404 es solo si la
  persona no existe). Nunca devuelve `tax_form_path`: el PDF se baja por
  `…/tax-form/download`.
- **`POST …/banking/reveal`** devuelve los números completos. Es POST (y exige
  `payments:edit`) **a propósito**: el middleware de `activity_log` audita
  POST/PUT/PATCH/DELETE y no los GET, así que cada vez que alguien ve una cuenta
  completa queda registrado. Además loguea `[payments] banking reveal`.
- **`PUT …/banking`** es un upsert parcial (`exclude_unset`: `null` limpia). Un
  valor que empieza con `****` se ignora: es la máscara que el formulario
  reenvió, no un número nuevo.
- **W-8 / W-9.** `POST …/tax-form` (multipart: `file`, `kind`, `signed_at`,
  `expires_at`): solo PDF (magic bytes `%PDF`), ≤ 10 MB, al bucket privado
  `nominations` bajo `banking/<personnel_id>/<uuid>.pdf`. El anterior se borra
  **después** de guardar el nuevo. `exempt` no lleva archivo (lo decide Finance
  con el PUT). `DELETE …/tax-form` borra archivo y fechas pero deja el tipo.
  **Bajar el PDF es `POST …/tax-form/download` con `payments:edit`**, por la
  misma razón que `reveal`: el formulario fiscal lleva datos personales y cada
  descarga tiene que quedar en el activity log.
- **Vencimiento.** Si no se carga `tax_form_expires_at` y es un W-8, vale hasta
  el **31/12 del tercer año calendario posterior a la firma** (regla del IRS); el
  W-9 no vence. `tax_form_status()`: `missing` (sin ficha, sin tipo, o con tipo
  pero **sin PDF**: lo que habilita a pagar es el documento firmado), `expired`,
  `exempt`, `ok`.
- **Qué bloquea qué.** `new → in_process` sin W-8 vigente **advierte** (todavía
  hay tiempo de pedirlo); `in_process → completed` y `record-partial` lo
  **exigen** (`ok` o `exempt`). `has_bank_info` = hay `account_number` o
  `iban`: también es requisito para completar o registrar un parcial (no hay a
  dónde transferir), y entra en el filtro `missing_docs` de la cola y en el
  pendiente `payments_missing_docs` de la campana.
- **El export de pagos no lleva datos bancarios**: solo "sí/no" de ficha y el
  estado del formulario fiscal. Los números completos salen únicamente de
  `/reveal`, que es lo auditado.

---

## 17. Tests

`tests/` (pytest, ver DEVELOPMENT.md → Tests): 279 tests unitarios **sin red
ni base**. `tests/conftest.py` reemplaza el cliente de `api/_lib/database.py`
por un supabase falso en memoria que hereda del `_QueryBuilder` real (así la
regla de "un filtro por columna" es la de producción) y trae un `FakeRequest`
con `state.user` y `state._is_superadmin` precargados.

```bash
./venv/bin/pip install -r requirements-dev.txt
./venv/bin/python -m pytest tests -q
```

| Archivo | Qué cubre |
|---|---|
| `test_budget_scope.py` | `_scoped()` mirando el filtro que viaja a PostgREST, `_departments_for` (`view`/`edit`/`approve`), `_assert_can_approve`, `_is_general_admin` |
| `test_expense_transitions.py` | cada fila de la tabla de gastos, positiva y negativa; self-approval y override |
| `test_payment_transitions.py` | cada fila de la tabla de pagos; W-8 (`tax_form_status`), `has_bank_info`, `mask_value` |
| `test_summary_year.py` | `_payment_fiscal_year`, `_revenue_year`, `_payment_buckets` |
| `test_notifications.py` | `notify()`, `budget_approvers_for`, `module_editors`, `/pending` por permiso y el aislamiento por usuario de `/me/notifications` |
| `test_authorization.py` | `require_view` / `require_edit` / `require_superadmin` y la autoría del Muro |
| `test_finance_review.py` | lo que cerró la revisión de la rama: `record-partial` y `completed ⇒ paid == total`, `last_financial_edit_by`, `by_month == totals`, descarga del W-8 por POST, vendors `name`/`active`, `cm_pending`, traza de ediciones y borrados, `generate_recurring`, headcount/supuestos con Competitions |

Las funciones de transición y de año/balde son puras justamente para poder
testear las reglas de plata sin base. **Si agregás una transición**, sumá la
fila a la tabla del test: `test_transition_table_is_the_documented_one` (en los
dos archivos de transiciones) falla hasta que lo hagas, y esta sección (§14) se
actualiza en el mismo PR. No hay job de CI: correlos antes de pushear.
