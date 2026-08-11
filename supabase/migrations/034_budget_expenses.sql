-- 034_budget_expenses.sql — gastos, ingresos y recurrentes.
--
-- Fase 1 de BUDGET_MODULE.md, la parte que resuelve el pedido original:
-- trazabilidad de gastos que NO cuelgan de una nominación.
--
-- POR QUÉ UNA TABLA NUEVA Y NO EXTENDER `payments`. `payments.nomination_id` es
-- NOT NULL UNIQUE (migración 012): un pago es, por definición, el pago a UNA
-- persona nominada a un evento. Volverlo nullable haría condicionales el
-- prefill desde `nominations.total`, la lógica de W8/bank info y el bloqueo de
-- borrado de la migración 028 — cuatro caminos con `if nomination_id` adentro
-- de un módulo que hoy funciona. Los dos casos que faltaban son otra cosa:
--   1. gasto de departamento sin evento     → licencias, internet, leasing
--   2. gasto de evento sin persona          → shipping, branding, seguros
-- Los dos entran acá, y el reporte de costo de un evento suma las dos tablas.
--
-- VA ANTES QUE EL PRESUPUESTO (035) a propósito: se puede registrar gasto sin
-- tener el presupuesto cargado. `budget_line_id` se agrega por ALTER en la 035.
--
-- Backend-only vía service_role: RLS habilitada sin políticas.
--
-- NO forma parte del deploy automático: aplicá a mano contra Supabase.

begin;

-- ─── Plantillas de gasto recurrente ─────────────────────────────────────────
--
-- El presupuesto de IT son ~20 suscripciones mensuales fijas (Adobe, AWS, Zoom,
-- Dropbox, Crown Castle…). Cargarlas a mano cada mes se olvida.
--
-- NO hay cron ni generación automática: la plantilla solo declara lo esperado.
-- El endpoint /budget/recurring/pending compara contra los `expenses` ya
-- creados del período y devuelve lo que falta, para confirmar en bloque. Así no
-- aparecen gastos que nadie cargó ni se acumulan meses fantasma si el módulo
-- queda sin usar.
CREATE TABLE IF NOT EXISTS recurring_expenses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department_code text NOT NULL REFERENCES departments(code) ON UPDATE CASCADE,
    account_code    text NOT NULL REFERENCES accounts(code)    ON UPDATE CASCADE,
    vendor_id       uuid REFERENCES vendors(id) ON DELETE SET NULL,
    description     text NOT NULL,
    amount          numeric(12,2) NOT NULL DEFAULT 0,   -- USD
    frequency       text NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'annual')),
    -- Día nominal de vencimiento. Solo informativo: la generación es por
    -- período (mes/trimestre/año), no por fecha exacta.
    day_of_month    integer CHECK (day_of_month BETWEEN 1 AND 28),
    start_date      date NOT NULL,
    end_date        date,
    active          boolean NOT NULL DEFAULT true,
    notes           text,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recurring_dates_ordered CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_recurring_active ON recurring_expenses(active);
CREATE INDEX IF NOT EXISTS idx_recurring_dept   ON recurring_expenses(department_code);

-- ─── Gastos ejecutados ──────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS expense_record_seq START 1;

CREATE TABLE IF NOT EXISTS expenses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Correlativo humano, en paralelo al EP-##### de payments.
    record_no       text NOT NULL UNIQUE
                      DEFAULT 'GA-' || lpad(nextval('expense_record_seq')::text, 5, '0'),

    -- Las tres dimensiones. `competition_id` NULL = gasto general, que es
    -- exactamente la columna "General Expenses (not associated to the
    -- competitions)" del Excel de Competitions.
    department_code text NOT NULL REFERENCES departments(code) ON UPDATE CASCADE,
    account_code    text NOT NULL REFERENCES accounts(code)    ON UPDATE CASCADE,
    competition_id  uuid REFERENCES competitions(id) ON DELETE SET NULL,

    -- A quién se le paga. Tres formas, y por eso no alcanza una sola FK:
    --   vendor   → proveedor del catálogo (el caso normal)
    --   employee → reembolso a staff FIBA que adelantó plata
    --   other    → pago suelto sin ficha; el nombre queda en payee_name
    payee_type      text NOT NULL DEFAULT 'vendor'
                      CHECK (payee_type IN ('vendor', 'employee', 'other')),
    vendor_id       uuid REFERENCES vendors(id)   ON DELETE SET NULL,
    employee_id     uuid REFERENCES employees(id) ON DELETE SET NULL,
    -- Fallback y, a la vez, el nombre congelado si el proveedor o el empleado
    -- se borran: el gasto histórico no puede quedar sin destinatario.
    payee_name      text,

    description     text NOT NULL,
    amount          numeric(12,2) NOT NULL DEFAULT 0,   -- USD, siempre
    -- Fecha del gasto / de la factura: es la que define a qué año fiscal imputa.
    expense_date    date NOT NULL,
    -- Cuándo se pagó de verdad. NULL mientras no esté pagado.
    payment_date    date,

    -- SOLO `paid` consume presupuesto. `approved` se reporta aparte como
    -- comprometido (decisión explícita, ver BUDGET_MODULE.md §2).
    status          text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'approved', 'paid', 'rejected', 'cancelled')),
    approved_by     uuid,
    approved_at     timestamptz,

    payment_method    text,
    bank_confirmation text,
    invoice_no        text,

    recurring_id    uuid REFERENCES recurring_expenses(id) ON DELETE SET NULL,
    -- Período que cubre el gasto recurrente ('2027-03'). Junto con recurring_id
    -- es lo que impide generar dos veces el mismo mes.
    recurring_period text,

    comments        text,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    -- Un gasto pagado tiene fecha de pago, y viceversa. Sin esto el reporte de
    -- ejecutado por mes queda con filas sin fecha que no caen en ningún período.
    CONSTRAINT expense_paid_has_date CHECK (
        (status = 'paid' AND payment_date IS NOT NULL)
        OR (status <> 'paid' AND payment_date IS NULL)
    ),
    -- El destinatario tiene que estar identificado de alguna de las tres formas.
    CONSTRAINT expense_payee_present CHECK (
        (payee_type = 'vendor'   AND vendor_id   IS NOT NULL)
        OR (payee_type = 'employee' AND employee_id IS NOT NULL)
        OR (payee_type = 'other'  AND payee_name IS NOT NULL AND btrim(payee_name) <> '')
    )
);

CREATE INDEX IF NOT EXISTS idx_expenses_department  ON expenses(department_code);
CREATE INDEX IF NOT EXISTS idx_expenses_account     ON expenses(account_code);
CREATE INDEX IF NOT EXISTS idx_expenses_competition ON expenses(competition_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status      ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_date        ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_vendor      ON expenses(vendor_id);

-- Idempotencia de los recurrentes: un solo gasto por plantilla y período.
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_recurring_period
    ON expenses(recurring_id, recurring_period)
    WHERE recurring_id IS NOT NULL;

-- ─── Adjuntos (factura, recibo, contrato) ───────────────────────────────────
-- Mismo patrón que payment_attachments: bucket privado `nominations`, prefijo
-- expenses/, descarga por blob autenticado. Nunca URL pública.
CREATE TABLE IF NOT EXISTS expense_attachments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id   uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    storage_path text NOT NULL,   -- storage://nominations/expenses/<id>/<uuid>.<ext>
    file_name    text NOT NULL,
    kind         text,            -- INVOICE / RECEIPT / CONTRACT / …
    uploaded_by  uuid,
    uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_attachments_expense ON expense_attachments(expense_id);

-- ─── Ingresos ───────────────────────────────────────────────────────────────
--
-- Tabla propia y no una columna `kind` en expenses: un ingreso no tiene
-- destinatario, ni aprobación, ni factura que adjuntar, y su ciclo es
-- esperado → recibido, no draft → aprobado → pagado. Compartir tabla obligaría
-- a que la mitad de las columnas y los dos CHECK de arriba sean condicionales.
-- El volumen además es bajo: el Summary de Competitions 2027 son dos líneas.
CREATE TABLE IF NOT EXISTS revenues (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department_code text NOT NULL REFERENCES departments(code) ON UPDATE CASCADE,
    account_code    text NOT NULL REFERENCES accounts(code)    ON UPDATE CASCADE,
    competition_id  uuid REFERENCES competitions(id) ON DELETE SET NULL,
    source_name     text NOT NULL,   -- 'FIBA HQ Grant', 'Enjoy Contract', …
    description     text,
    amount          numeric(12,2) NOT NULL DEFAULT 0,   -- USD
    expected_date   date,
    received_date   date,
    status          text NOT NULL DEFAULT 'expected'
                      CHECK (status IN ('expected', 'received', 'cancelled')),
    comments        text,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT revenue_received_has_date CHECK (
        (status = 'received' AND received_date IS NOT NULL)
        OR (status <> 'received' AND received_date IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_revenues_department  ON revenues(department_code);
CREATE INDEX IF NOT EXISTS idx_revenues_competition ON revenues(competition_id);
CREATE INDEX IF NOT EXISTS idx_revenues_status      ON revenues(status);

-- Solo cuentas de ingreso en revenues y solo cuentas de gasto en expenses.
-- Se valida en el backend (accounts.kind) y no con un CHECK, porque un CHECK
-- no puede mirar otra tabla; queda anotado acá para que no se pierda.

-- ─── RLS: habilitada, sin políticas → backend-only vía service_role ─────────
ALTER TABLE recurring_expenses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenues            ENABLE ROW LEVEL SECURITY;

-- ─── Permiso del módulo ─────────────────────────────────────────────────────
-- Mantener en sync con MODULES en api/_lib/routers/permissions.py y en
-- src/pages/Users.jsx (ver CLAUDE.md §10: son TRES lugares).
--
-- `budget` es restringido igual que `payments`: no se siembra a nadie. Hasta
-- que un admin lo otorgue en la página de Usuarios, solo lo ve el superadmin.
-- El recorte por departamento (budget_access) llega en la migración 036; hasta
-- entonces quien tiene el permiso ve todos los departamentos.
ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_module_check;

ALTER TABLE user_permissions
  ADD CONSTRAINT user_permissions_module_check CHECK (module IN (
    'calendar', 'nominations', 'personnel', 'competitions', 'templates',
    'users', 'logistics', 'availability', 'training', 'games', 'assets',
    'loans', 'employees', 'payments', 'reports', 'evaluations', 'comp_days',
    'budget'
  ));

COMMENT ON TABLE expenses IS
    'Gastos por departamento, con o sin competencia. Complementa payments (que solo paga nominaciones). Solo status=paid consume presupuesto.';
COMMENT ON TABLE recurring_expenses IS
    'Plantillas de gasto fijo. NO generan solas: /budget/recurring/pending propone y el usuario confirma.';
COMMENT ON TABLE revenues IS
    'Ingresos esperados/recibidos. Tabla propia: ciclo y campos distintos a expenses.';

commit;
