-- 035_budget_lines.sql — el presupuesto en sí.
--
-- Fase 2 de BUDGET_MODULE.md. Acá entran los dos Excel al sistema.
--
-- UNA SOLA TABLA PARA DOS FORMAS. Los presupuestos reales de FIBA se ven
-- distintos pero son el mismo objeto:
--
--   IT           → lista de líneas por código contable, proyectada 2027→2030
--                  con % de escalación. Sin relación con eventos.
--   Competitions → matriz de 28 líneas × 18 competencias, más una columna
--                  "General Expenses (not associated to the competitions)".
--
-- Una línea es (año, departamento, cuenta, competencia|NULL, monto). Las filas
-- de IT tienen competition_id NULL; las celdas de la matriz son (línea,
-- competencia) y la columna "General" es, otra vez, competition_id NULL. Lo que
-- cambia es la VISTA, no el dato.
--
-- MULTI-AÑO = UNA FILA POR AÑO, no columnas amount_2027..2030. Permite editar
-- 2028 sin tocar 2027 y hace triviales las queries por año (el reporte de
-- ejecutado ya filtra por año). `series_id` une la misma línea a través de los
-- años para poder mostrarla como una sola fila con cuatro columnas.
--
-- SIN CONSTRAINT ÚNICO sobre (year, department, account, competition): el
-- presupuesto de IT tiene 15 líneas distintas sobre la misma cuenta 612300
-- (Adobe, AWS, Zoom, Dropbox…). La celda de la matriz es la SUMA de las líneas
-- que caen ahí; con una sola se edita inline, con varias se abre el detalle.
--
-- NO forma parte del deploy automático: aplicá a mano contra Supabase.

begin;

CREATE TABLE IF NOT EXISTS budget_lines (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    year            integer NOT NULL,
    department_code text NOT NULL REFERENCES departments(code) ON UPDATE CASCADE,
    account_code    text NOT NULL REFERENCES accounts(code)    ON UPDATE CASCADE,
    -- NULL = gasto general del año, no atribuible a una competencia.
    competition_id  uuid REFERENCES competitions(id) ON DELETE SET NULL,
    kind            text NOT NULL DEFAULT 'expense'
                      CHECK (kind IN ('expense', 'revenue')),
    description     text NOT NULL,

    -- qty y monthly_amount son los del Excel de IT ("23 líneas × $2.600/mes").
    -- Informativos: el que manda es `amount`, el anual.
    qty             numeric(10,2),
    monthly_amount  numeric(12,2),
    amount          numeric(12,2) NOT NULL DEFAULT 0,   -- anual, USD

    -- % que aplica la proyección al generar el año siguiente. Se copia de
    -- accounts.escalation_pct al crear la línea y después se puede pisar.
    escalation_pct  numeric(5,4) NOT NULL DEFAULT 0,

    -- 'calculated' = derivada de budget_headcount × avg_flight_cost. Si alguien
    -- edita el monto a mano pasa a 'manual' y deja de recalcularse (fase 5).
    source          text NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('manual', 'calculated')),

    notes           text,
    -- La misma línea a lo largo de los años. Default distinto por fila: una
    -- línea nueva arranca su propia serie; la proyección copia el series_id.
    series_id       uuid NOT NULL DEFAULT gen_random_uuid(),

    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT budget_year_sane CHECK (year BETWEEN 2020 AND 2100)
);

CREATE INDEX IF NOT EXISTS idx_budget_lines_year_dept   ON budget_lines(year, department_code);
CREATE INDEX IF NOT EXISTS idx_budget_lines_competition ON budget_lines(competition_id);
CREATE INDEX IF NOT EXISTS idx_budget_lines_account     ON budget_lines(account_code);
CREATE INDEX IF NOT EXISTS idx_budget_lines_series      ON budget_lines(series_id);

-- Una serie no puede tener dos filas del mismo año: la proyección se puede
-- correr dos veces sin duplicar, y "editar 2028" siempre apunta a una sola fila.
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_lines_series_year
    ON budget_lines(series_id, year);

-- ─── Ata el gasto ejecutado a la línea que lo presupuestó ───────────────────
-- Opcional: un gasto sin línea igual cuenta contra el par (departamento,
-- cuenta) del año. Sirve para el seguimiento fino de una línea concreta.
ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS budget_line_id uuid REFERENCES budget_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_budget_line ON expenses(budget_line_id);

-- ─── Headcount de staffing (sheet "Staffing (travel)") ──────────────────────
-- 235 persona-evento en 2027. Multiplicado por el costo de vuelo promedio da
-- las líneas de travel. La UI de esto llega en la fase 5; la tabla va acá
-- porque es parte del modelo del presupuesto.
CREATE TABLE IF NOT EXISTS budget_headcount (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    year           integer NOT NULL,
    competition_id uuid REFERENCES competitions(id) ON DELETE CASCADE,
    -- 'Technical Delegates', 'VGOs', 'VIP hold', 'Competition Staff'… Texto
    -- libre igual que competition_staffing.event_role: son roles de
    -- planificación presupuestaria, no cargos que el sistema nomine.
    role_label     text NOT NULL,
    headcount      integer NOT NULL DEFAULT 0 CHECK (headcount >= 0),
    UNIQUE (year, competition_id, role_label)
);

CREATE INDEX IF NOT EXISTS idx_budget_headcount_year ON budget_headcount(year);

CREATE TABLE IF NOT EXISTS budget_assumptions (
    year            integer PRIMARY KEY CHECK (year BETWEEN 2020 AND 2100),
    -- $1.050 en el presupuesto 2027 (subió de $950, ver notas del Excel).
    avg_flight_cost numeric(12,2) NOT NULL DEFAULT 1050,
    notes           text,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── Metadata de competencia que el presupuesto reporta y no existía ────────
ALTER TABLE competitions
    ADD COLUMN IF NOT EXISTS subzone text,
    ADD COLUMN IF NOT EXISTS tier    integer;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_subzone_check') THEN
        ALTER TABLE competitions ADD CONSTRAINT competitions_subzone_check
            CHECK (subzone IS NULL OR subzone IN
                ('AMERICAS', 'CONSUBASQUET', 'CONCENCABA', 'CBC', 'GLOBAL'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_tier_check') THEN
        ALTER TABLE competitions ADD CONSTRAINT competitions_tier_check
            CHECK (tier IS NULL OR tier BETWEEN 1 AND 3);
    END IF;
END $$;

-- ─── RLS: habilitada, sin políticas → backend-only vía service_role ─────────
ALTER TABLE budget_lines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_headcount   ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_assumptions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE budget_lines IS
    'Presupuesto: (año, departamento, cuenta, competencia|NULL, monto). Una fila por año; series_id une la misma línea entre años. Cubre la lista de IT y la matriz de Competitions.';
COMMENT ON TABLE budget_headcount IS
    'Headcount por rol y competencia (sheet Staffing (travel)). Base de las líneas de travel calculadas.';
COMMENT ON TABLE budget_assumptions IS
    'Supuestos del año: hoy solo el costo de vuelo promedio que multiplica el headcount.';

commit;
