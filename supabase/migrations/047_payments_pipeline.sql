-- 047_payments_pipeline.sql — pagos como pipeline: máquina de estados, pago
-- parcial explícito, ficha bancaria por persona y permiso de aprobación.
--
-- WP3 del flujo de finanzas. Hasta acá Payments era un formulario por
-- nominado: cualquiera con `payments:edit` podía marcar `completed` sin fecha
-- ni W-8, y el W-8 / los datos bancarios se re-subían como PDF en cada pago
-- porque `personnel` no tiene ningún campo bancario. Esta migración:
--
-- 1. **Estados.** `split` desaparece: lo que escondía (se pagó una parte) pasa
--    a ser explícito con `paid_amount` sobre un pago `in_process`. Se agrega
--    `cancelled` (antes un pago caído solo se podía borrar, y con él su
--    historia). Los `split` existentes pasan a `in_process` SIN `paid_amount`:
--    no hay forma de saber cuánto se había pagado; quien los mire lo completa.
--    El status ya NO se edita por PUT: solo por POST /payments/{id}/transition
--    (api/_lib/routers/payments.py, check_payment_transition), que deja traza
--    en finance_status_history (046).
--
-- 2. **Sellos.** `completed_by/at`, `cancelled_by/at`, `cancel_reason`. Sin FK a
--    auth.users, mismo patrón que `created_by`.
--
-- 3. **Un completado tiene fecha.** CHECK `status <> 'completed' OR
--    payment_date IS NOT NULL`. La UI vieja nunca la pedía y el resumen de
--    budget no sabía a qué año imputarlo. Los completados sin fecha que haya
--    se backfillean con la fecha de su última edición (o de alta): es la mejor
--    aproximación disponible a "cuándo se marcó pagado". En prod hay 1 pago.
--
-- 4. **Clases de adjunto.** `payment_attachments.kind` era texto libre
--    ("BANK INFO", "W8", "w-8"…). Se normaliza a un conjunto cerrado; lo que no
--    se reconoce queda `OTHER`.
--
-- 5. **personnel_banking.** Ficha bancaria y fiscal por PERSONA (no por pago):
--    se carga una vez y vale para todos sus pagos. Datos sensibles: RLS on sin
--    policies (backend-only, service_role) y se lee/escribe SOLO por
--    /api/payments/personnel/{id}/banking — nunca por el router `personnel`,
--    que tiene otro permiso y otra audiencia. El GET devuelve los números
--    enmascarados; verlos completos es un POST /reveal (POST a propósito, para
--    que el middleware de activity_log lo audite). El W-8 vive en el bucket
--    privado `nominations` bajo `banking/<personnel_id>/<uuid>.pdf`.
--
-- 6. **Permiso `payments_approve`.** Es un permiso que NO es página (como
--    `comp_days`, migración 030): solo usa can_view y habilita
--    `in_process → completed`, que es soltar la plata. Nadie lo tiene por
--    defecto. Mantener en sync con MODULES en api/_lib/routers/permissions.py
--    y en src/pages/Users.jsx (CLAUDE.md punto 10: tres lugares).
--
-- NO forma parte del deploy automático: aplicá a mano contra Supabase ANTES
-- de pushear el código que la usa (CLAUDE.md punto 17). Si no, el backend
-- escribe `cancelled` / `paid_amount` / `personnel_banking` que no existen.

begin;

-- ─── 1. Estados ────────────────────────────────────────────────────────────
-- El CHECK de la 012 es inline, así que su nombre es el generado por Postgres.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;

UPDATE payments SET status = 'in_process', updated_at = now() WHERE status = 'split';

ALTER TABLE payments
    ADD CONSTRAINT payments_status_check
    CHECK (status IN ('new', 'in_process', 'completed', 'cancelled'));

-- ─── 2. Pago parcial y sellos ──────────────────────────────────────────────
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS paid_amount   numeric(12,2),
    ADD COLUMN IF NOT EXISTS completed_by  uuid,
    ADD COLUMN IF NOT EXISTS completed_at  timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled_by  uuid,
    ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
    ADD COLUMN IF NOT EXISTS cancel_reason text;

COMMENT ON COLUMN payments.paid_amount IS
    'Cuánto del total (amount + extra) ya salió. En in_process > 0 = pago parcial: budget lo cuenta como ejecutado y el resto como comprometido. Al completar, default = total.';

-- Completados viejos: fecha y monto pagado, para que entren en los CHECKs de
-- abajo y el resumen de budget los impute a un año.
UPDATE payments
   SET payment_date = COALESCE(updated_at, created_at, now())::date
 WHERE status = 'completed' AND payment_date IS NULL;

UPDATE payments
   SET paid_amount = amount + extra
 WHERE status = 'completed' AND paid_amount IS NULL;

-- Se referencia amount + extra y no `total`: `total` es una columna generada y
-- así el CHECK no depende de que Postgres la calcule antes de evaluarlo.
ALTER TABLE payments
    ADD CONSTRAINT payments_paid_amount_range
    CHECK (paid_amount IS NULL OR (paid_amount >= 0 AND paid_amount <= amount + extra));

ALTER TABLE payments
    ADD CONSTRAINT payments_completed_has_date
    CHECK (status <> 'completed' OR payment_date IS NOT NULL);

-- ─── 3. Clases de adjunto ──────────────────────────────────────────────────
UPDATE payment_attachments
   SET kind = CASE upper(regexp_replace(coalesce(kind, ''), '[^A-Za-z0-9]', '', 'g'))
       WHEN 'W8'        THEN 'W8'
       WHEN 'W8BEN'     THEN 'W8'
       WHEN 'W8BENE'    THEN 'W8'
       WHEN 'BANKINFO'  THEN 'BANK_INFO'
       WHEN 'BANK'      THEN 'BANK_INFO'
       WHEN 'EXPENSES'  THEN 'EXPENSES'
       WHEN 'EXPENSE'   THEN 'EXPENSES'
       WHEN 'INVOICE'   THEN 'INVOICE'
       WHEN 'RECEIPT'   THEN 'RECEIPT'
       ELSE 'OTHER'
   END;

ALTER TABLE payment_attachments ALTER COLUMN kind SET DEFAULT 'OTHER';
ALTER TABLE payment_attachments ALTER COLUMN kind SET NOT NULL;
ALTER TABLE payment_attachments DROP CONSTRAINT IF EXISTS payment_attachments_kind_check;
ALTER TABLE payment_attachments
    ADD CONSTRAINT payment_attachments_kind_check
    CHECK (kind IN ('EXPENSES', 'W8', 'BANK_INFO', 'INVOICE', 'RECEIPT', 'OTHER'));

-- ─── 4. Ficha bancaria y fiscal por persona ────────────────────────────────
CREATE TABLE IF NOT EXISTS personnel_banking (
    personnel_id        uuid PRIMARY KEY REFERENCES personnel(id) ON DELETE CASCADE,
    payment_method      text CHECK (payment_method IN ('wire', 'ach', 'other')),
    bank_name           text,
    bank_address        text,
    account_holder      text,
    account_number      text,
    routing_number      text,
    swift               text,
    iban                text,
    currency            text NOT NULL DEFAULT 'USD',
    notes               text,
    tax_form_kind       text CHECK (tax_form_kind IN ('W-8BEN', 'W-8BEN-E', 'W-9', 'exempt')),
    tax_form_path       text,   -- storage://nominations/banking/<personnel_id>/<uuid>.pdf
    tax_form_file_name  text,
    tax_form_signed_at  date,
    tax_form_expires_at date,   -- W-8BEN: 31/12 del tercer año desde la firma
    updated_by          uuid,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE personnel_banking ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE personnel_banking IS
    'Datos bancarios y formulario fiscal (W-8/W-9) por persona nominable. Sensible: backend-only (service_role, RLS on sin policies). Se accede SOLO vía /api/payments/personnel/{id}/banking (permiso payments; GET enmascarado, POST /reveal auditado), NUNCA por el router personnel. El PDF vive en el bucket privado nominations bajo banking/.';

-- ─── 5. Permiso payments_approve ───────────────────────────────────────────
-- Lista completa vigente (MODULES de permissions.py) + el nuevo.
ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_module_check;

ALTER TABLE user_permissions
  ADD CONSTRAINT user_permissions_module_check CHECK (module IN (
    'feed', 'calendar', 'nominations', 'payments', 'budget', 'personnel',
    'competitions', 'templates', 'users', 'logistics', 'availability',
    'training', 'games', 'assets', 'loans', 'employees', 'reports',
    'evaluations', 'comp_days', 'payments_approve'
  ));

commit;
