-- 045_finance_fixes.sql — cuentas para el Video Operator.
--
-- `VIDEO_OPERATOR` es un rol de `personnel` desde la migración 016 (distinto
-- del VGO, que es el operador de gráficos de TV), pero el plan de cuentas
-- sembrado en la 033 no tiene líneas para él. Resultado: un pago a un Video
-- Operator nacía con `account_code = NULL` y caía en `unallocated_payments`
-- sin que nadie lo hubiera decidido — el único aviso era un warning en el log.
--
-- Se agregan las dos cuentas apareadas fee/travel, igual que el resto de los
-- roles (TD 11/12, VGO 13/14, REF 10/07, REF_INSTRUCTOR 08/09), y el backend
-- las mapea en `api/_lib/budget_accounts.py` (VIDEO_OPERATOR → COMP-29/30).
--
-- Son provisorias como todo COMP-xx (`pending_mapping = true`): cuando Finance
-- entregue el plan oficial se remapean con un UPDATE (todas las FK hacia
-- `accounts` son ON UPDATE CASCADE) y se actualiza budget_accounts.py.
--
-- No backfillea pagos viejos: hoy no hay pagos a VIDEO_OPERATOR en prod. Si
-- apareciera alguno sin imputar, alcanza con volver a guardar su budget_code
-- desde Payments (el PUT re-deriva la cuenta).
--
-- NO forma parte del deploy automático: aplicá a mano contra Supabase ANTES
-- de pushear el código que la usa. Si no, un pago a VIDEO_OPERATOR intenta
-- escribir una cuenta que no existe y el FK lo rechaza.

begin;

INSERT INTO accounts (code, label, kind, pending_mapping, sort) VALUES
    ('COMP-29', 'Video Operator Fees',            'expense', true, 129),
    ('COMP-30', 'Video Operator Travel Expenses', 'expense', true, 130)
ON CONFLICT (code) DO NOTHING;

commit;
