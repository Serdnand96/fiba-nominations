-- El instante del partido, para poder mostrarlo en más de una zona horaria.
--
-- El seguimiento de la competencia se hace desde un war room en Miami: quien
-- mira el calendario necesita saber a qué hora tiene que estar mirando ESE
-- partido, no solo a qué hora arranca en la sede.
--
-- `date` + `time` son hora local de la sede y así se quedan: es lo que le sirve
-- al TD y al VGO que están en el gimnasio, y es lo que muestra la web de FIBA.
-- Lo que faltaba era el ancla para convertir. Se guarda el instante en UTC, que
-- es lo que ya manda FIBA en `gameDateTimeUTC`, y no un offset: un offset se
-- vuelve mentira dos veces al año, y en esta competencia conviven zonas que
-- cambian de horario de verano en fechas distintas (o no cambian).
--
-- Que no engañe la aritmética simple: México juega 20:10 local y eso es 02:10
-- UTC del DÍA SIGUIENTE. Por eso es un timestamptz y no una columna de hora.
--
-- `venue_timezone` es la IANA de la sede (`ianaTimeZone` de FIBA). No hace
-- falta para convertir —el UTC alcanza— pero sí para etiquetar la hora local
-- sin adivinar, y para reconstruir el instante si algún día hay que recalcular.

ALTER TABLE game_schedule
    ADD COLUMN datetime_utc    timestamptz,
    ADD COLUMN venue_timezone  text;

COMMENT ON COLUMN game_schedule.datetime_utc IS
  'Instante del partido en UTC (gameDateTimeUTC de FIBA). Ancla para mostrar la hora en cualquier zona; date/time siguen siendo hora local de la sede. NULL cuando FIBA todavía no fijó horario (hasTimeGameDateTime=false).';
COMMENT ON COLUMN game_schedule.venue_timezone IS
  'Zona IANA de la sede (ianaTimeZone de FIBA), ej. America/Santiago. Para etiquetar la hora local sin adivinar.';
