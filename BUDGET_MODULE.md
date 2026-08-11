# BUDGET_MODULE.md — Diseño del módulo de Presupuesto y Gastos

> Estado: **fases 1 y 2 implementadas** (agosto 2026) — migraciones 033-035
> **aplicadas a prod**, `api/_lib/routers/budget.py` (25 endpoints),
> `src/pages/Budget.jsx` (5 pestañas). Fases 3-5 pendientes (ver §7).
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
| 5 | **Solo el gasto pagado consume presupuesto** | Lo aprobado-no-pagado se reporta aparte como *comprometido*. |
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
| **3** | Migración **036**: permisos por departamento + payments consume presupuesto | Designados con acceso acotado. Va después de que el módulo funcione, para probar el scoping contra datos reales. |
| **4** | Recurrentes (panel del mes), dashboard, vista de costo del evento | Cierra el reporting. |
| **5** | Migración **037**: tarifario + headcount calculado + import histórico 2026 | Circuito completo presupuesto ↔ nominación ↔ pago. |

---

## 8. Alcance del "ejecutado" (importante)

`/budget/summary` calcula el ejecutado **solo desde `expenses`**. Los pagos a
personas nominadas (`payments`) **no se suman todavía**: esa tabla no lleva
departamento ni cuenta hasta la migración 036, y sumarla sin esas dimensiones
desbalancearía el corte por departamento.

La respuesta devuelve `excludes_person_payments: true` y la UI lo dice en
pantalla, para que nadie lea esos números de más. El costo total de un evento
—pagos + airfare + gastos— es la vista de la fase 4.

---

## 9. Pendientes

- **Plan de cuentas oficial de Finance.** Hasta que llegue, los códigos de
  Competitions son `COMP-01`…`COMP-28` con `pending_mapping = true`.
- **Gastos ejecutados 2026** para importar. Se importan al final, cuando estén
  los archivos.
- **Regla de visibilidad cruzada** dentro de una competencia (§4): decidida por
  defecto, confirmar con los designados cuando usen el módulo.
