-- Tramo de FIBA por fechas: el tercer filtro del sync, después de la ventana
-- (040) y los grupos (051).
--
-- Se aplica A MANO contra Supabase ANTES de pushear el código que la usa
-- (services/fiba_sync.py, routers/competitions.py): si no, el sync encuentra
-- columnas que no existen.
--
-- El problema que resuelve: la BCLA Season 8 es UNA competencia en FIBA (209060)
-- y acá la fase de grupos son tres — W1, W2, W3 — cada una con su crew y sus
-- nominaciones. FIBA no le pone `windowCode` a ningún partido ni publica
-- /windows, y las ventanas no se separan por grupo: B, C y D juegan en las tres.
-- Lo único que las separa es la fecha. Sin esto, vincular las tres metía los 36
-- partidos en cada una.
--
-- NO son start_date/end_date. Esas las carga el equipo e incluyen viaje, y
-- filtrar por ellas se come partidos (W3 del WCQ, CLAUDE.md punto 13). Estas
-- son las fechas de los PARTIDOS del tramo, declaradas a propósito, y valen NULL
-- en toda competencia que no las necesita — la mayoría.

ALTER TABLE competitions ADD COLUMN fiba_segment_from date;
ALTER TABLE competitions ADD COLUMN fiba_segment_to date;

-- Las dos o ninguna, y en orden. El router devuelve 400 antes de llegar acá;
-- esto es la red por si alguien edita la tabla a mano.
ALTER TABLE competitions ADD CONSTRAINT competitions_fiba_segment_pair
  CHECK ((fiba_segment_from IS NULL) = (fiba_segment_to IS NULL));
ALTER TABLE competitions ADD CONSTRAINT competitions_fiba_segment_order
  CHECK (fiba_segment_from IS NULL OR fiba_segment_from <= fiba_segment_to);

COMMENT ON COLUMN competitions.fiba_segment_from IS
  'Primer día (fecha local de la sede) de los partidos de FIBA que son de esta competencia. Para feeds sin windowCode cuyas ventanas solo se separan por fecha (BCLA). NULL = sin filtro. No es start_date.';
COMMENT ON COLUMN competitions.fiba_segment_to IS
  'Último día (fecha local de la sede), inclusive, del tramo de FIBA de esta competencia. Va con fiba_segment_from.';
