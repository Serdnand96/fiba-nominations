-- 048_budget_approval.sql — aprobación de gastos con aprobador separado.
--
-- WP4 del flujo de finanzas. Hasta acá el gasto tenía un solo sello: el mismo
-- designado que lo cargaba lo aprobaba y lo marcaba pagado, sin motivo de
-- rechazo ni traza. Esto agrega las dos piezas que faltaban en la base:
--
-- 1. `budget_access.can_approve` — quién aprueba gastos de qué departamento.
--    Es una tercera columna del mismo modelo por fila (`'*'` = todos), y NO
--    se deduce de `can_edit`: el que carga y el que aprueba son roles
--    distintos a propósito. Implica `can_view` (lo valida el backend en
--    PUT /budget/access/{user_id}). Además el backend exige
--    `created_by <> aprobador`; el superadmin puede aprobar lo propio solo con
--    motivo, y queda en `finance_status_history` con `meta.override`.
--
-- 2. Sellos de cada salida del borrador en `expenses`, en paralelo al
--    `approved_by/at` que ya existía (034): rechazo (con motivo), pago (quién
--    lo marcó y cuándo — distinto de `payment_date`, que es cuándo salió la
--    plata) y cancelación (con motivo). El historial completo vive en
--    `finance_status_history` (046); estas columnas son la foto del estado
--    actual para listar y filtrar sin un join.
--
-- El `status` de un gasto ya no se edita por PATCH: solo por
-- POST /budget/expenses/{id}/transition, que valida la transición, sella estas
-- columnas y escribe el historial.
--
-- Los 129 gastos `paid` de IT 2026 (scripts/import_it_2026.py) quedan con
-- `paid_by` NULL: son carga histórica, nadie los "marcó pagados" acá.
--
-- Backfill: el administrador general que hoy existe (fila `'*'` con
-- `can_edit`) pasa a ser también aprobador general. Sin esto, al deployar
-- nadie podría aprobar un gasto (salvo un superadmin con override).
--
-- NO forma parte del deploy automático: aplicá a mano contra Supabase ANTES
-- de pushear el código que la usa (CLAUDE.md, punto 17). Si no, el PUT de
-- acceso y las transiciones escriben columnas que no existen.

begin;

ALTER TABLE budget_access
    ADD COLUMN IF NOT EXISTS can_approve boolean NOT NULL DEFAULT false;

ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS rejected_by      uuid,
    ADD COLUMN IF NOT EXISTS rejected_at      timestamptz,
    ADD COLUMN IF NOT EXISTS rejection_reason text,
    ADD COLUMN IF NOT EXISTS paid_by          uuid,
    ADD COLUMN IF NOT EXISTS paid_at          timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled_by     uuid,
    ADD COLUMN IF NOT EXISTS cancelled_at     timestamptz,
    ADD COLUMN IF NOT EXISTS cancel_reason    text;

-- La bandeja "pendientes de aprobación" filtra drafts por departamento.
CREATE INDEX IF NOT EXISTS idx_expenses_status_dept ON expenses(status, department_code);

UPDATE budget_access
   SET can_approve = true
 WHERE department_code = '*'
   AND can_edit;

COMMENT ON COLUMN budget_access.can_approve IS
    'Aprueba/rechaza gastos del departamento (''*'' = todos). Implica can_view. Nadie aprueba lo que cargó (superadmin: solo con motivo, queda como override).';
COMMENT ON COLUMN expenses.paid_at IS
    'Cuándo se marcó pagado en el sistema (sello). payment_date es cuándo salió la plata.';

commit;
