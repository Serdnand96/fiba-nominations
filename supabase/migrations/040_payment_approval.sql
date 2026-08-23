-- 040_payment_approval.sql — los pagos a personas entran al circuito de aprobación.
--
-- Fase 10 de BUDGET_MODULE.md §14.
--
-- HASTA ACÁ HABÍA DOS CICLOS QUE NO SE HABLABAN. Un gasto es
-- `draft → approved → paid` y lleva `approved_by` / `approved_at` (migración
-- 034); un pago a una persona es `new → in_process → split → completed` y **no
-- tiene aprobación de ningún tipo**: cualquiera con `payments.can_edit` podía
-- marcarlo `completed` y esa plata pasaba a consumir presupuesto.
--
-- La decisión fue aprobación de UN nivel y sin umbral (§14.2, decisión 4): el
-- designado con `can_edit` sobre el departamento aprueba cualquier monto de su
-- área. No hay escalamiento por monto porque el control real ya lo da el
-- recorte por departamento — nadie aprueba plata ajena.
--
-- NO SE TOCA EL ENUM DE STATUS. `new/in_process/split/completed` son los
-- estados del legacy vbills y describen dónde está el trámite bancario;
-- la aprobación es otro eje (quién dio el OK), igual que en `expenses`. Meter
-- 'approved' en el mismo enum obligaría a decidir si un pago aprobado que
-- volvió de finanzas es 'approved' o 'in_process', y la respuesta es "las dos".
--
-- NO forma parte del deploy automático: aplicá a mano contra Supabase.

begin;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS approved_by uuid,
    ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_payments_approved ON payments(approved_at);

-- ─── Los pagos ya completados quedan aprobados ──────────────────────────────
--
-- Sin esto, la regla nueva ("solo un pago aprobado puede pasar a completed")
-- dejaría en falta a todo lo histórico: cualquier edición sobre un pago viejo
-- ya completado —cambiarle un comentario, corregir la imputación— dispararía un
-- 400 pidiendo una aprobación que nadie puede dar retroactivamente.
--
-- `approved_by` queda NULL a propósito: no hay a quién atribuirle esa
-- aprobación y estampar un usuario cualquiera sería inventar un dato de
-- auditoría. La fecha es la del pago, que es lo más cercano a la verdad.
UPDATE payments
SET approved_at = COALESCE(payment_date::timestamptz, created_at, now())
WHERE status = 'completed' AND approved_at IS NULL;

COMMENT ON COLUMN payments.approved_at IS
    'Aprobación del pago, eje separado del status (que describe el trámite bancario). Requisito para pasar a completed desde la migración 040.';
COMMENT ON COLUMN payments.approved_by IS
    'Quién aprobó. NULL en los pagos históricos aprobados por el backfill de la 040: no había a quién atribuirlos.';

commit;
