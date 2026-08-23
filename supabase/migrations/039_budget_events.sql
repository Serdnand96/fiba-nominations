-- 039_budget_events.sql — gasto que no es competencia del calendario.
--
-- Fase 8 de BUDGET_MODULE.md §14.
--
-- EL PROBLEMA, QUE SON DOS Y RESULTAN SER UNO. Quedaban afuera del modelo dos
-- clases de gasto que no encajan ni en "competencia del calendario" ni en
-- "overhead anual del departamento" (que es `competition_id NULL`, la columna
-- General, y está bien así — el presupuesto administrativo de IT y Admin es la
-- operación anual de FIBA Américas, no un evento):
--
--   1. Los Draws de AmeriCup ($82.900 en 2027) y los workshops de TDs. Son
--      operaciones reales con gasto propio, pero no son competencias: no tienen
--      partidos, ni crew, ni cartas de nominación.
--   2. Liga Sudamericana ($323.316), LSF ($44.800) y WBLA ($112.400). El Excel
--      presupuesta la TEMPORADA entera; `competitions` tiene las fases sueltas
--      (Group A-D, QFs, Finals) y ninguna noción de temporada — no hay parent,
--      ni grupo, ni nada que las una.
--
-- Las dos necesitan lo mismo: un contenedor de gasto con identidad propia que
-- no es una competencia. Sin hijos es un Draw; con las fases colgadas es una
-- temporada. De ahí una sola tabla.
--
-- Entre las dos son los $563.416 de $1.533.832 que el import de 2027 dejó
-- afuera porque sus columnas del Excel no matcheaban contra `competitions`
-- (§10). No se mandaron a General a propósito: General es una columna real del
-- Excel y ensuciarla arruina el reporte.
--
-- POR QUÉ NO DARLOS DE ALTA COMO `competitions` CON UNA MARCA. Porque media
-- docena de módulos —nominaciones, logística, juegos, training, availability—
-- tendrían que aprender a filtrarlas, y el primero que se olvide manda un Draw
-- a la lista de gente nominable. Un `budget_event` es una entidad del módulo
-- Budget y no la ve nadie más.
--
-- NO forma parte del deploy automático: aplicá a mano contra Supabase.

begin;

CREATE TABLE IF NOT EXISTS budget_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    year            integer NOT NULL,
    department_code text NOT NULL REFERENCES departments(code) ON UPDATE CASCADE,
    -- 'season' es el único que agrupa competencias; los otros tres son bolsas
    -- sueltas. Texto acotado y no libre porque la UI decide con esto si ofrece
    -- el panel de fases.
    kind            text NOT NULL DEFAULT 'other'
                      CHECK (kind IN ('season', 'draw', 'workshop', 'other')),
    start_date      date,
    end_date        date,
    active          boolean NOT NULL DEFAULT true,
    notes           text,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT budget_events_year_sane CHECK (year BETWEEN 2020 AND 2100),
    CONSTRAINT budget_events_dates_ordered CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- Case-insensitive y por año: "Draw AmeriCup" existe en 2027 y en 2028 como dos
-- eventos distintos, pero no dos veces en el mismo año. Mismo criterio que el
-- índice de `vendors` (migración 033).
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_events_name_year
    ON budget_events (lower(name), year);
CREATE INDEX IF NOT EXISTS idx_budget_events_year ON budget_events(year);
CREATE INDEX IF NOT EXISTS idx_budget_events_dept ON budget_events(department_code);

-- ─── Las fases de una temporada cuelgan de su evento ────────────────────────
--
-- NULL es el caso normal: el 90% del calendario son competencias sueltas que no
-- pertenecen a ninguna temporada. ON DELETE SET NULL y no CASCADE — borrar la
-- temporada no puede llevarse puesta una competencia real del calendario.
ALTER TABLE competitions
    ADD COLUMN IF NOT EXISTS budget_event_id uuid
        REFERENCES budget_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_competitions_budget_event ON competitions(budget_event_id);

-- ─── Presupuesto, gasto e ingreso pueden apuntar al contenedor ──────────────
--
-- UNO U OTRO, NUNCA LOS DOS. Con las dos columnas cargadas la fila contaría en
-- el rollup de la competencia y en el del evento, y el total del año quedaría
-- inflado sin que se note dónde. El CHECK lo hace imposible en vez de dejarlo
-- librado a que todas las escrituras se acuerden.
ALTER TABLE budget_lines
    ADD COLUMN IF NOT EXISTS budget_event_id uuid
        REFERENCES budget_events(id) ON DELETE SET NULL;
ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS budget_event_id uuid
        REFERENCES budget_events(id) ON DELETE SET NULL;
ALTER TABLE revenues
    ADD COLUMN IF NOT EXISTS budget_event_id uuid
        REFERENCES budget_events(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_lines_one_target') THEN
        ALTER TABLE budget_lines ADD CONSTRAINT budget_lines_one_target
            CHECK (competition_id IS NULL OR budget_event_id IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_one_target') THEN
        ALTER TABLE expenses ADD CONSTRAINT expenses_one_target
            CHECK (competition_id IS NULL OR budget_event_id IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revenues_one_target') THEN
        ALTER TABLE revenues ADD CONSTRAINT revenues_one_target
            CHECK (competition_id IS NULL OR budget_event_id IS NULL);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_budget_lines_budget_event ON budget_lines(budget_event_id);
CREATE INDEX IF NOT EXISTS idx_expenses_budget_event     ON expenses(budget_event_id);
CREATE INDEX IF NOT EXISTS idx_revenues_budget_event     ON revenues(budget_event_id);

-- ─── RLS: habilitada, sin políticas → backend-only vía service_role ─────────
ALTER TABLE budget_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE budget_events IS
    'Contenedor de gasto que no es competencia del calendario ni overhead anual. Sin hijos es un Draw o un workshop; con competencias colgadas (competitions.budget_event_id) es una temporada que presupuesta lo que sus fases ejecutan.';
COMMENT ON COLUMN competitions.budget_event_id IS
    'Temporada a la que pertenece esta fase, si pertenece a alguna. Solo lo usa el módulo Budget para el rollup: NULL en el 90% del calendario.';

commit;
