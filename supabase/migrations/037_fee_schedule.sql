-- 037_fee_schedule.sql — tarifario oficial de fees por rol y tipo de evento.
--
-- Fase 5 de BUDGET_MODULE.md. Cierra el circuito presupuesto ↔ nominación ↔ pago.
--
-- Sale del sheet `Fees Breakdown` de CompsDraftBudget2027: una grilla de rol
-- (REF / TD / VGO) × tipo de evento → fee + incidentals. Hoy esos números se
-- tipean a mano en cada competencia.
--
-- NO ES UN CAMINO PARALELO. El sistema ya resuelve fees por rol: cada
-- competencia tiene `{td,vgo,ref,ref_instructor,video_operator}_window_fee` y
-- `_incidentals` (migraciones 003 y 016), que `sync-nominations` copia a cada
-- nominación vía `_build_default_overrides` en games.py. El tarifario RELLENA
-- esas columnas; no las reemplaza ni agrega una segunda fuente de verdad. Así
-- lo que ya funciona sigue funcionando y los valores quedan editables por
-- competencia — el tarifario es el default, no una imposición.
--
-- OJO con `incidentals`: en el Excel la columna es "Incidentals x City", o sea
-- POR CIUDAD. Se siembra el valor tal cual y se copia tal cual. Para un evento
-- multi-sede hay que multiplicarlo a mano — el sistema no sabe cuántas sedes
-- tiene una competencia, y multiplicar por una cuenta inventada sería peor que
-- dejarlo explícito.
--
-- NO forma parte del deploy automático: aplicá a mano contra Supabase.

begin;

CREATE TABLE IF NOT EXISTS fee_schedule (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Los mismos prefijos que usan las columnas de `competitions`, para poder
    -- construir el nombre de columna sin una tabla de traducción en el medio.
    role_prefix text NOT NULL
                  CHECK (role_prefix IN ('td', 'vgo', 'ref', 'ref_instructor', 'video_operator')),
    event_type  text NOT NULL,
    fee         numeric(12,2) NOT NULL,
    incidentals numeric(12,2) NOT NULL DEFAULT 0,   -- POR CIUDAD (ver arriba)
    valid_from  date NOT NULL DEFAULT '2026-01-01',
    active      boolean NOT NULL DEFAULT true,
    notes       text,
    UNIQUE (role_prefix, event_type, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_fee_schedule_event ON fee_schedule(event_type) WHERE active;

-- El tipo de evento a efectos de FEES. NO es `template_key` (WCQ/BCLA/LSB/
-- GENERIC), que gobierna el formato de la carta y la asignación por partido:
-- son ejes distintos — una WCQ y una LSB pueden pagar lo mismo, y dos
-- competencias con el mismo template pueden estar en escalones distintos.
ALTER TABLE competitions
    ADD COLUMN IF NOT EXISTS fee_event_type text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_fee_event_type_check') THEN
        ALTER TABLE competitions ADD CONSTRAINT competitions_fee_event_type_check
            CHECK (fee_event_type IS NULL OR fee_event_type IN (
                'single_game_mens_qualifiers', 'single_game_other',
                'tournament_6d_youth', 'tournament_6d_senior',
                'tournament_8d_youth', 'tournament_8d_senior',
                'womens_americup', 'americup'
            ));
    END IF;
END $$;

-- ─── Seed: sheet "Fees Breakdown" tal cual ──────────────────────────────────
INSERT INTO fee_schedule (role_prefix, event_type, fee, incidentals) VALUES
    -- Árbitros
    ('ref', 'single_game_mens_qualifiers',  550, 100),
    ('ref', 'single_game_other',            400, 100),
    ('ref', 'tournament_6d_youth',          850, 100),
    ('ref', 'tournament_6d_senior',         950, 100),
    ('ref', 'tournament_8d_youth',          950, 100),
    ('ref', 'tournament_8d_senior',        1050, 100),
    ('ref', 'womens_americup',             1400, 100),
    ('ref', 'americup',                    1700, 100),
    -- Technical Delegates
    ('td',  'single_game_mens_qualifiers', 1000, 100),
    ('td',  'single_game_other',            900, 100),
    ('td',  'tournament_6d_youth',          800, 100),
    ('td',  'tournament_6d_senior',        1000, 100),
    ('td',  'tournament_8d_youth',         1000, 100),
    ('td',  'tournament_8d_senior',        1200, 100),
    ('td',  'womens_americup',             1400, 100),
    ('td',  'americup',                    1700, 100),
    -- VGOs — ojo, incidentals 150 y no 100
    ('vgo', 'single_game_mens_qualifiers',  500, 150),
    ('vgo', 'single_game_other',            500, 150),
    ('vgo', 'tournament_6d_youth',          850, 150),
    ('vgo', 'tournament_6d_senior',         950, 150),
    ('vgo', 'tournament_8d_youth',          950, 150),
    ('vgo', 'tournament_8d_senior',        1050, 150),
    ('vgo', 'womens_americup',             1500, 150),
    ('vgo', 'americup',                    1700, 150)
ON CONFLICT (role_prefix, event_type, valid_from) DO NOTHING;

-- `ref_instructor` y `video_operator` NO se siembran: el sheet no los tiene.
-- La tabla los acepta para cuando FIBA publique sus montos; hasta entonces
-- esas competencias siguen con el valor que se cargue a mano.

-- ─── Headcount: a qué línea de presupuesto alimenta cada rol ────────────────
-- Del sheet "Staffing (travel)": el bloque Summary mapea cada rol a la línea
-- de gasto que su headcount multiplica (TD → línea 12, VGO → 14, etc.).
ALTER TABLE budget_headcount
    ADD COLUMN IF NOT EXISTS account_code text REFERENCES accounts(code) ON UPDATE CASCADE;

ALTER TABLE fee_schedule ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE fee_schedule IS
    'Tarifario oficial rol × tipo de evento (sheet Fees Breakdown). Rellena las columnas {prefix}_window_fee/_incidentals de competitions; no las reemplaza. incidentals es POR CIUDAD.';

commit;
