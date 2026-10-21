-- Vínculo de cada competencia con FIBA GDAP: qué competencia de FIBA es, qué
-- tramo de ella (grupos, además de la ventana de la 040) y qué fechas le da FIBA.
--
-- Se aplica A MANO contra Supabase ANTES de pushear el código que la usa
-- (services/fiba_sync.py, scripts/fiba_sync.py): si no, el sync encuentra
-- columnas que no existen.
--
-- El problema que resuelve: la LSB 2026 es UNA competencia en FIBA (209059, 40
-- partidos) y acá son siete — Grupo A..D, QF E, QF F y Finals — cada una con su
-- crew y sus nominaciones. FIBA no separa la liga por ventana sino por
-- `groupPairingCode` (A..F, y 37/38/39/40 para semis, 3er puesto y final), así
-- que `fiba_window_code` no alcanza y el sync metía la liga entera en el grupo
-- al que se le apuntara. Mismo problema que la 040, otra columna.

-- El ID de GDAP. `fiba_games_url` sigue valiendo: el primer sync resuelve el ID
-- desde la URL y lo guarda acá, y de ahí en más no se scrapea la web de FIBA.
ALTER TABLE competitions ADD COLUMN fiba_competition_id integer;

COMMENT ON COLUMN competitions.fiba_competition_id IS
  'ID de la competencia en FIBA GDAP. Varias competencias nuestras pueden compartirlo (ventanas, grupos): el tramo lo acotan fiba_window_code y fiba_group_codes.';

-- Lista separada por comas, comparada contra `groupPairingCode`. NULL = sin
-- filtro. Falla del lado seguro como la ventana: si ningún partido del feed trae
-- grupo, no filtra.
ALTER TABLE competitions ADD COLUMN fiba_group_codes text;

COMMENT ON COLUMN competitions.fiba_group_codes IS
  'Grupos de FIBA (groupPairingCode) de esta competencia, separados por coma: "A", o "37,38,39,40" para un Final Four. NULL = sin filtro.';

-- Las fechas que FIBA le da al tramo. NO reemplazan start_date/end_date: esas
-- las carga el equipo e incluyen viaje (W3 de FIBA termina el 07-08 y la
-- competencia declara hasta el 07-07). El calendario muestra la diferencia y
-- una persona decide si la aplica.
ALTER TABLE competitions ADD COLUMN fiba_start_date date;
ALTER TABLE competitions ADD COLUMN fiba_end_date date;

-- Salud del sync automático (cron): cuándo corrió bien por última vez y, si la
-- última corrida falló, por qué. Sin esto un cron roto pasa inadvertido hasta
-- que alguien ve un resultado viejo.
ALTER TABLE competitions ADD COLUMN fiba_synced_at timestamptz;
ALTER TABLE competitions ADD COLUMN fiba_sync_error text;

-- Siembra: las competencias que ya apuntan a FIBA por un ID numérico pelado.
-- Las que tienen URL se resuelven solas en la primera corrida.
UPDATE competitions
SET fiba_competition_id = trim(fiba_games_url)::integer
WHERE fiba_games_url ~ '^\s*\d+\s*$';
