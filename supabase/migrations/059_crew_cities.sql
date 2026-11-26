-- Sedes de cada miembro del crew del torneo.
--
-- Se aplica A MANO contra Supabase ANTES de pushear el código que la usa
-- (api/_lib/crew.py, routers/games.py): si no, elegir la sede de un oficial
-- escribe una columna que no existe.
--
-- El problema que resuelve: con `fee_type = 'tournament'` el crew
-- (`competition_assignments`) cubría todos los partidos de la competencia. Eso
-- es cierto en un torneo de una sola sede, que es la mayoría, pero no en una
-- ventana de la BCLA: se juega en tres o cuatro ciudades a la vez y cada TD o
-- VGO trabaja una. La tabla solo guardaba competencia, persona y cargo, así
-- que los cuatro TD de la Window 1 figuraban en los doce partidos, y la
-- sincronización de nominaciones les ponía las fechas y las sedes de toda la
-- ventana.
--
-- La sede es la CIUDAD, no el grupo (Montevideo recibe a dos grupos en el mismo
-- estadio con un solo TD), y es una lista porque una persona puede cubrir dos
-- sedes seguidas. Se compara por nombre contra `game_schedule.city`, sin
-- distinguir mayúsculas ni acentos (`city_key` en api/_lib/crew.py).
--
-- NULL = cubre toda la competencia, como hasta ahora. Ninguna fila existente
-- cambia de significado.

ALTER TABLE competition_assignments ADD COLUMN cities text[];

COMMENT ON COLUMN competition_assignments.cities IS
  'Sedes (ciudades de game_schedule.city) que cubre esta persona en la competencia. NULL o vacío = toda la competencia.';
