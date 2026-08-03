-- Crew role: varchar(10) → text.
--
-- `competition_assignments.role` nació como varchar(10) cuando la tabla solo
-- guardaba TD y VGO. La migración 022 abrió el CHECK a todos los roles de
-- personnel, pero no tocó el ancho de la columna: 'REF_INSTRUCTOR' y
-- 'VIDEO_OPERATOR' miden 14 caracteres, así que agregar un instructor o un
-- video operator al crew moría con Postgres 22001 ("value too long for type
-- character varying(10)") → 500 en POST /api/games/crew.
--
-- Todas las demás columnas de rol del schema (personnel, game_assignments,
-- logistics_participants, availability_links) ya son `text`: el largo lo
-- gobierna el CHECK, no el tipo. Esta alinea la última que faltaba.

ALTER TABLE competition_assignments ALTER COLUMN role TYPE text;
