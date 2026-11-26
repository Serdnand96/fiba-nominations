-- Tramo de FIBA por número de partido: el cuarto filtro del sync, después de la
-- ventana (040), los grupos (051) y las fechas (053).
--
-- Se aplica A MANO contra Supabase ANTES de pushear el código que la usa
-- (services/fiba_sync.py, routers/competitions.py): si no, el formulario de
-- Competencias guarda una columna que no existe.
--
-- El problema que resuelve: en la BCLA cada grupo juega 9 partidos en tres
-- sedes de 3, y FIBA los numera del 1 al 9 dentro del grupo (`gameNumber`). La
-- Window 1 son los partidos 1 a 3 de cada grupo, la Window 2 los 4 a 6 y la
-- Window 3 los 7 a 9: 12 por ventana. Las fechas (053) no alcanzan para
-- separarlas porque el grupo A juega sus tres sedes entre enero y febrero: con
-- un rango de fechas, La Asunción y Managua caían en la Window 3 y el reparto
-- quedaba 9, 9 y 18. Un rango no puede decir "9 al 14 de diciembre más 23 al 25
-- de enero"; el número de partido sí, y no cambia si FIBA mueve una fecha.
--
-- Vale NULL en toda competencia que no lo necesita, que es la mayoría.

ALTER TABLE competitions ADD COLUMN fiba_game_numbers text;

COMMENT ON COLUMN competitions.fiba_game_numbers IS
  'Números de partido dentro del grupo (gameNumber de FIBA) que son de esta competencia, separados por coma: 1,2,3 para la Window 1 de la BCLA. NULL = sin filtro.';
