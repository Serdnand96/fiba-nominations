-- 024: Ligar los viajes de transporte al partido que los motiva.
--
-- El cronograma que arma logística (planilla "Schedule Referee and Comm") se
-- organiza por partido: cada fila es PICK UP → hora del partido → RETURN HOTEL,
-- con la columna PARTIDOS al lado. El modelo anterior sólo tenía origin/
-- destination en texto libre, así que el partido había que tipearlo a mano y
-- quedaba desactualizado apenas se resolvían los cruces (los brackets se cargan
-- como "CF #1" / "Equipo A SF#1" y después se reemplazan por el equipo real).
--
--   game_id   → el partido; el nombre de los equipos y la fase salen de ahí.
--   trip_type → 'pickup' (hotel→venue) / 'return' (venue→hotel) / 'transfer'.
--               La fila de la planilla es un par pickup+return del mismo game.

ALTER TABLE transport_trips
  ADD COLUMN IF NOT EXISTS game_id uuid REFERENCES game_schedule(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_type text NOT NULL DEFAULT 'transfer';

ALTER TABLE transport_trips
  DROP CONSTRAINT IF EXISTS transport_trips_trip_type_check;

ALTER TABLE transport_trips
  ADD CONSTRAINT transport_trips_trip_type_check
  CHECK (trip_type IN ('pickup', 'return', 'transfer'));

CREATE INDEX IF NOT EXISTS idx_transport_trips_game ON transport_trips(game_id);
CREATE INDEX IF NOT EXISTS idx_transport_trips_date ON transport_trips(date);
