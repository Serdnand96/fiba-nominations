-- 060_officiating_department.sql: Officiating como departamento de Budget.
--
-- El catálogo `departments` (033) nació con nueve áreas y Officiating no estaba:
-- lo de árbitros se cargaba dentro de Competitions. Officiating tiene su propio
-- presupuesto y su propio responsable, así que pasa a ser un departamento más.
--
-- Qué hace:
--
--   * Inserta `officiating` al final de la lista (`sort` 10).
--
-- Qué NO hace:
--
--   * No mueve nada de lo ya cargado. Las líneas de presupuesto, los gastos y
--     los pagos que hoy están en `competitions` siguen ahí.
--   * No cambia `payment_budgets`: el budget `referees` pasa a `officiating`
--     en la 061, aparte.
--   * No le da acceso a nadie. Como cualquier departamento, lo ve quien tiene
--     la fila `'*'` en `budget_access` o el superadmin, hasta que se asigne en
--     Usuarios.
--
-- NO forma parte del deploy automático: se aplica a mano contra Supabase. Es
-- solo datos, ningún código depende de ella. Idempotente.

begin;

INSERT INTO departments (code, label, sort) VALUES
    ('officiating', 'Officiating', 10)
ON CONFLICT (code) DO NOTHING;

commit;
