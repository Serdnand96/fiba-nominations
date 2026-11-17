-- 056_budget_expense_hotel.sql — un gasto puede ser de un hotel.
--
-- Logística necesita ver, por hotel, qué pagó FIBA (noches extra, salones,
-- adicionales). La plata sigue viviendo en `expenses` y se sigue cargando,
-- aprobando y pagando en Budget: esta columna es solo el vínculo que le faltaba
-- al gasto para poder decir "de qué hotel es".
--
--   expenses.hotel_id → logistics_hotels(id), nullable.
--
-- Reglas que aplica el backend:
--
--   * Solo se acepta si el gasto tiene `competition_id` y el hotel es de esa
--     competencia (400 si no).
--   * NO es un campo financiero: cambiarlo no toca `last_financial_edit_by` ni
--     escribe en `finance_status_history`.
--   * Logística lo lee por `GET /logistics/hotels/{id}/payments`, en solo
--     lectura, con una proyección angosta y sin pasar por `_scoped()`. Es una
--     excepción documentada (BUDGET_MODULE.md, CLAUDE.md punto 16), igual que
--     `competition_cost`: quien tiene `logistics` ve los pagos de SUS hoteles
--     aunque no tenga acceso al departamento que los imputó.
--
-- ON DELETE SET NULL: borrar un hotel no borra ni bloquea el gasto, solo le
-- quita el vínculo.
--
-- Sin backfill: los gastos que ya existen quedan sin hotel.
--
-- NO forma parte del deploy automático: aplicá a mano contra Supabase ANTES
-- de pushear el código que la usa (CLAUDE.md, punto 17). Necesita la 025
-- (logistics_hotels).

begin;

ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS hotel_id uuid REFERENCES logistics_hotels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_hotel ON expenses(hotel_id) WHERE hotel_id IS NOT NULL;

COMMENT ON COLUMN expenses.hotel_id IS
  'Hotel de logística al que corresponde el gasto (noches extra, salones, adicionales). Opcional; exige competition_id y que el hotel sea de esa competencia.';

commit;
