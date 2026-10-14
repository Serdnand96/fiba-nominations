-- 050_finance_edit_trace.sql — quién tocó la plata por última vez.
--
-- Segunda pata de la separación de funciones del flujo de finanzas. Hasta la
-- 049 la regla era "el que crea no aprueba / no paga" (`created_by` contra el
-- usuario que transiciona). Eso deja un agujero obvio: B carga un gasto de
-- $100, A se lo cambia a $10.000 mientras está en borrador y después A lo
-- aprueba — `created_by` sigue siendo B, así que la regla no lo frena.
--
-- Estas columnas sellan al ÚLTIMO usuario que cambió un campo financiero:
--
--   expenses → department_code, account_code, competition_id, amount,
--              expense_date, payee_type, vendor_id, employee_id, payee_name,
--              budget_line_id   (PATCH /budget/expenses/{id})
--   payments → amount, extra, airfare, budget_code
--              (PUT /payments/{id} y POST /payments/sync-amount)
--
-- y el backend bloquea con 403 que ese usuario apruebe el gasto
-- (draft → approved), complete el pago (in_process → completed) o registre un
-- pago parcial (POST /payments/{id}/record-partial). El superadmin puede, con
-- motivo, y queda en `finance_status_history` con
-- `meta.override = 'edited_then_approved'`. El detalle de cada cambio (de qué
-- valor a cuál) también va al historial, como fila con
-- `from_status = to_status` y `meta.edit`.
--
-- `last_financial_edit_by_email` es una FOTO del email al momento de editar
-- (mismo criterio que `finance_status_history.changed_by_email` y
-- `feed_posts.author_name`): la UI muestra "editado por X" sin consultar
-- auth.users, y sigue legible aunque se borre el usuario.
--
-- Sin backfill: NULL = nadie editó montos desde que existe la columna, y la
-- regla de `created_by` sigue valiendo sola.
--
-- NO forma parte del deploy automático: aplicá a mano contra Supabase ANTES
-- de pushear el código que la usa (CLAUDE.md, punto 17). Si no, cada edición
-- de un gasto o de un pago escribe columnas que no existen y falla.

begin;

ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS last_financial_edit_by       uuid,
    ADD COLUMN IF NOT EXISTS last_financial_edit_by_email text,
    ADD COLUMN IF NOT EXISTS last_financial_edit_at       timestamptz;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS last_financial_edit_by       uuid,
    ADD COLUMN IF NOT EXISTS last_financial_edit_by_email text,
    ADD COLUMN IF NOT EXISTS last_financial_edit_at       timestamptz;

COMMENT ON COLUMN expenses.last_financial_edit_by IS
    'Último usuario que cambió un campo financiero (monto, departamento, cuenta, destinatario, fecha, línea). Segunda pata de la separación de funciones: no puede aprobar el gasto (superadmin: solo con motivo, queda como override edited_then_approved).';
COMMENT ON COLUMN expenses.last_financial_edit_by_email IS
    'Email de last_financial_edit_by al momento de editar (foto, como finance_status_history.changed_by_email).';
COMMENT ON COLUMN payments.last_financial_edit_by_email IS
    'Email de last_financial_edit_by al momento de editar (foto, como finance_status_history.changed_by_email).';
COMMENT ON COLUMN expenses.last_financial_edit_at IS
    'Cuándo se hizo el último cambio financiero (ver last_financial_edit_by).';
COMMENT ON COLUMN payments.last_financial_edit_by IS
    'Último usuario que cambió amount, extra, airfare o budget_code. Segunda pata de la separación de funciones: no puede completar el pago ni registrar un pago parcial (superadmin: solo con motivo, queda como override edited_then_approved).';
COMMENT ON COLUMN payments.last_financial_edit_at IS
    'Cuándo se hizo el último cambio financiero (ver last_financial_edit_by).';

commit;
