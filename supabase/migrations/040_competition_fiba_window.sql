-- Qué ventana del clasificatorio es esta competencia.
--
-- El problema que resuelve: la API de FIBA no devuelve una ventana, devuelve el
-- clasificatorio entero. `getgdapgamesbycompetitionid` para el WC 2027 Americas
-- Qualifiers trae los 84 partidos de las SEIS ventanas, de noviembre 2025 a
-- marzo 2027. En este sistema, en cambio, cada ventana es una competencia
-- aparte con su propio crew, sus nominaciones y sus fees.
--
-- Sin este filtro el sync metía los 84 partidos en la competencia a la que se
-- le apuntara: Window 3 y Window 4 terminaron con el calendario completo (84
-- filas cada una, de las cuales 17 y 12 eran realmente suyas), y los partidos
-- de agosto se veían dentro de la ventana de julio.
--
-- Se filtra por `windowCode`, que FIBA manda en cada partido, y NO por el rango
-- de fechas de la competencia: Window 3 de FIBA termina el 2026-07-08 y la
-- competencia declara hasta el 07-07, así que un filtro por fechas se comería
-- un partido. Los bordes de una ventana no coinciden con las fechas que carga
-- el equipo, que incluyen viaje.
--
-- NULL = sin filtro, traer todo lo que devuelva FIBA. Es el comportamiento
-- correcto para una competencia que no está dividida en ventanas (una AmeriCup,
-- un CentroBasket), que son la mayoría.

ALTER TABLE competitions ADD COLUMN fiba_window_code text;

COMMENT ON COLUMN competitions.fiba_window_code IS
  'Código de ventana de FIBA (W1..W6) al que pertenece esta competencia. Si está seteado, sync-results importa solo los partidos con ese windowCode. NULL = sin filtro (competencia no dividida en ventanas).';

-- Siembra: las competencias de ventana ya se llaman "… – Window N", así que el
-- código sale del propio nombre. Se limita a las que tienen ventana de verdad
-- (WCQ y AmeriCup Qualifiers); el resto queda en NULL.
UPDATE competitions
SET fiba_window_code = 'W' || substring(name from '– Window ([1-6])$')
WHERE name ~ '– Window [1-6]$';
