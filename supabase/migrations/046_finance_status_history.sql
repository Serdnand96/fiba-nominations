-- Historial de estados de gastos y pagos: quién movió qué, de dónde a dónde,
-- cuándo y por qué.
--
-- Una sola tabla para las dos máquinas de estado del área de finanzas:
--
--   expense  → expenses.status  (draft / approved / paid / rejected / cancelled)
--   payment  → payments.status  (new / in_process / completed / cancelled)
--
-- Dos máquinas, una timeline, un componente (src/components/StatusHistory.jsx).
-- Por eso `entity_id` NO lleva FK: apunta a `expenses.id` o a `payments.id`
-- según `entity_type`. Tampoco hay FK a auth.users en `changed_by` (mismo patrón
-- que payments.created_by); `changed_by_email` se guarda como foto, para que la
-- traza siga legible aunque se borre el usuario.
--
-- El `status` de un gasto o de un pago NUNCA se edita por PATCH/PUT: solo por
-- `POST /{id}/transition`, que valida la transición y escribe una fila acá vía
-- api/_lib/services/finance_history.py `record_transition()`. El `activity_log`
-- no alcanza como traza porque no guarda bodies (no sabe a qué estado pasó ni
-- con qué motivo).
--
--   from_status → NULL en el alta (no había estado anterior).
--   reason      → motivo de rechazo / cancelación / override.
--   meta        → contexto libre: {"override": true} cuando un superadmin
--                 aprueba lo propio, {"bulk": true} en cambios en lote,
--                 payment_date, paid_amount, etc.
--
-- Es append-only por convención: el backend inserta y lee, nunca actualiza ni
-- borra. Si se borra el gasto o el pago, su historial queda (huérfano) a
-- propósito.
--
-- Aplicar a mano contra Supabase ANTES de pushear el código que la usa
-- (CLAUDE.md, punto 17).

CREATE TABLE IF NOT EXISTS finance_status_history (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type       text NOT NULL CHECK (entity_type IN ('expense', 'payment')),
    entity_id         uuid NOT NULL,
    from_status       text,
    to_status         text NOT NULL,
    changed_by        uuid,
    changed_by_email  text,
    changed_at        timestamptz NOT NULL DEFAULT now(),
    reason            text,
    meta              jsonb
);

CREATE INDEX IF NOT EXISTS idx_finance_status_history_entity
    ON finance_status_history (entity_type, entity_id, changed_at DESC);

-- ─── RLS: habilitada, sin políticas → backend-only vía service_role ─────────
ALTER TABLE finance_status_history ENABLE ROW LEVEL SECURITY;
