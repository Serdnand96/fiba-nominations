-- 061_referees_budget_to_officiating.sql: los pagos a árbitros salen de Officiating.
--
-- La 041 dejó el budget de pagos `referees` imputando a `competitions` porque
-- Officiating no existía como departamento. Desde la 060 existe, así que un
-- pago cargado con el budget "Referees" pasa a contar como ejecutado de
-- Officiating.
--
-- Qué hace:
--
--   * `payment_budgets.referees` → `department_code = 'officiating'`.
--
-- Qué NO hace:
--
--   * No reimputa pagos existentes. `payments.department_code` se escribe al
--     crear el pago o al cambiarle el budget; al aplicar esta migración no
--     había ningún pago con el budget `referees`, así que no hay nada que mover.
--   * No cambia la cuenta. El rol sigue eligiendo la cuenta de fees y la de
--     travel (`api/_lib/budget_accounts.py`): REF 10/07, REF_INSTRUCTOR 08/09.
--   * No mueve el presupuesto. Las líneas de honorarios y viajes de árbitros
--     siguen cargadas en `competitions`; hasta que se pasen a `officiating`, el
--     ejecutado de estos pagos sale en un departamento y su presupuesto en otro.
--
-- NO forma parte del deploy automático: se aplica a mano contra Supabase. Es
-- solo datos, ningún código depende de ella. Idempotente. Requiere la 060.

begin;

UPDATE payment_budgets
   SET department_code = 'officiating'
 WHERE code = 'referees';

commit;
