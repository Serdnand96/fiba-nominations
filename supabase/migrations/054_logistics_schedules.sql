-- 054: Cronogramas de logística (transporte y comidas) por audiencia.
--
-- APLICAR A MANO en Supabase ANTES de pushear el código que la usa: el deploy
-- no corre migraciones y el router nuevo pega contra estas tablas.
--
-- Logística manda dos planillas que hasta hoy vivían fuera del sistema:
--
--   * el cronograma de transporte ("Schedule Horario de Entrenamientos y
--     Partidos"): por día, el entrenamiento de cada equipo con su PICK UP
--     HOTEL / RETURN HOTEL, y los partidos. La versión de staff ("Schedule
--     Arbitros") trae solo partidos.
--   * el cronograma de comidas que se le manda al hotel: la misma base con
--     ALMUERZO / MERIENDA / CENA por equipo.
--
-- Son DOCUMENTOS, no una vista derivada de training_slots / game_schedule: la
-- gerente de logística los arma a mano, con horarios que no salen de ninguna
-- regla (el pick-up no es siempre "50 minutos antes"), y los vuelve a subir
-- cuando cambian. Por eso cada fila guarda su propio texto y sus propias horas
-- en vez de apuntar a un slot o a un partido.
--
-- Transporte y comidas son dos documentos aunque repitan la base de
-- entrenamientos: así se mantienen afuera, y fusionarlos obligaría a casar dos
-- planillas que pueden estar en versiones distintas.
--
-- Un documento por (competencia, sección, audiencia). La audiencia es la
-- división que pidió logística para todo el módulo: staff / delegación / VIP.
--
-- Backend-only vía service_role: RLS habilitado sin políticas, igual que el
-- resto de logística (025).

CREATE TABLE logistics_schedules (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    section        text NOT NULL CHECK (section IN ('transport', 'meals')),
    audience       text NOT NULL CHECK (audience IN ('staff', 'delegation', 'vip')),
    -- Encabezado de la planilla: "GRUPO F (QF)" y "Medellin, COL · 13 - 15 de
    -- noviembre". Texto libre, tal como lo escribe logística.
    title          text,
    subtitle       text,
    -- Lo que es del día y no de una fila: [{date, label, notes}]. El label
    -- ("DÍA DE PARTIDO -2") se guarda en vez de derivarse porque la planilla
    -- puede rotular un día como quiera ("DÍA DE LLEGADA").
    days           jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- El Excel original, como storage://nominations/… (bucket privado). NULL si el
    -- documento se cargó a mano.
    file_path      text,
    file_name      text,
    uploaded_by    uuid,
    uploaded_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT logistics_schedules_unique UNIQUE (competition_id, section, audience)
);

CREATE INDEX idx_logistics_schedules_competition ON logistics_schedules(competition_id);

ALTER TABLE logistics_schedules ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE logistics_schedules IS
  'Cronograma de logística (transporte o comidas) de una competencia para una audiencia. Un documento por (competencia, sección, audiencia). Accedido solo por el backend FastAPI con service_role.';


CREATE TABLE logistics_schedule_rows (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id uuid NOT NULL REFERENCES logistics_schedules(id) ON DELETE CASCADE,
    date        date NOT NULL,
    -- training: una fila por equipo (team). game: los dos equipos (team, team_b).
    kind        text NOT NULL DEFAULT 'training' CHECK (kind IN ('training', 'game')),
    -- Orden dentro del día, el de la planilla.
    position    integer NOT NULL DEFAULT 0,
    start_time  time,
    end_time    time,
    team        text,
    team_b      text,
    pickup_time time,
    return_time time,
    -- Texto y no time: el hotel recibe "TAKE AWAY" y "15:30 al IN".
    lunch       text,
    snack       text,
    dinner      text,
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_logistics_schedule_rows_schedule ON logistics_schedule_rows(schedule_id);

ALTER TABLE logistics_schedule_rows ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE logistics_schedule_rows IS
  'Filas de un cronograma de logística: un entrenamiento o un partido con sus horas de pick-up/return o sus comidas. Accedido solo por el backend FastAPI con service_role.';
