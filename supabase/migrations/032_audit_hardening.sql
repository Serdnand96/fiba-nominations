-- 032_audit_hardening.sql
--
-- Constraints e integridad que salieron de la auditoría de 2026-08.
-- TODO lo de acá se verificó contra los datos de prod antes de escribirlo:
-- cero filas violan estos constraints hoy (nominations sin duplicados de
-- (competition_id, personnel_id), staff_evaluations sin duplicados con
-- created_by, ningún fee_type/month/score/pax fuera de rango), así que los
-- ADD no fallan. Igual, aplicá en staging primero.
--
-- NO forma parte del deploy automático: es un cambio de schema en prod,
-- revisalo y aplicalo a mano cuando quieras (ver DEPLOYMENT / runbook).
--
-- Nota aparte (no cubierta acá, es P0 de mantenibilidad): 17 tablas no tienen
-- DDL versionado en supabase/migrations/. El fix de fondo es un
-- `pg_dump --schema-only` → 000_baseline.sql. Requiere la connection string de
-- prod, así que queda como acción manual del checklist, no en esta migración.

begin;

-- 1. nominations.total: NULL + N = NULL. 12 nominaciones tienen window_fee o
--    incidentals vacío → total NULL, y el pago las tomaba como $0. La expresión
--    de una columna GENERATED no se puede ALTERar: hay que recrearla.
alter table nominations drop column total;
alter table nominations
  add column total numeric
  generated always as (coalesce(window_fee, 0) + coalesce(incidentals, 0)) stored;

-- 2. nominations: una sola nominación por (competencia, persona). El sync lo
--    simulaba en memoria; dos syncs concurrentes (o sync + alta manual) creaban
--    dos filas → dos cartas, dos window fees, dos pagos. Prod hoy: 0 duplicados.
alter table nominations
  add constraint nominations_competition_personnel_key
  unique (competition_id, personnel_id);

-- 3. staff_evaluations: el UNIQUE (competition_id, personnel_id, created_by) no
--    frena duplicados cuando created_by es NULL (los NULL son distintos entre
--    sí en Postgres). Índice parcial, igual que hizo la migración 029.
create unique index if not exists staff_evaluations_uniq_not_null
  on staff_evaluations (competition_id, personnel_id, created_by)
  where created_by is not null;

-- 4. Enums que solo se validaban en Python. Los valores viven en tablas sin DDL
--    versionado, pero el ALTER corre contra la tabla real de prod igual.
alter table competitions
  add constraint competitions_fee_type_check
  check (fee_type in ('per_game', 'tournament'));

alter table competitions
  add constraint competitions_month_check
  check (month is null or (month >= 1 and month <= 12));

alter table game_schedule
  add constraint game_schedule_scores_nonneg_check
  check ((score_a is null or score_a >= 0) and (score_b is null or score_b >= 0));

alter table logistics_participants
  add constraint logistics_participants_pax_check
  check (pax >= 1);

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- OPCIONAL — decisión de producto, NO lo apliqués sin definirlo.
--
-- Hoy borrar una competencia con force=true cascadea y destruye sus reportes y
-- evaluaciones en silencio. El fix de código (competitions.py) ya avisa antes de
-- borrar, pero si querés que la base lo IMPIDA directamente, cambiá esas dos FKs
-- a RESTRICT: el force-delete de una competencia con reportes/evaluaciones
-- fallará con 23503 → 409 legible (ya mapeado en api/index.py). El costo es que
-- para borrar la competencia habrá que borrar antes sus reportes/evaluaciones.
--
-- begin;
-- alter table competition_reports
--   drop constraint competition_reports_competition_id_fkey,
--   add  constraint competition_reports_competition_id_fkey
--     foreign key (competition_id) references competitions(id) on delete restrict;
-- alter table staff_evaluations
--   drop constraint staff_evaluations_competition_id_fkey,
--   add  constraint staff_evaluations_competition_id_fkey
--     foreign key (competition_id) references competitions(id) on delete restrict;
-- commit;
