-- Payments module.
--
-- Records the payments made to the people that work an event. Each payment
-- hangs off a nomination (the person nominated to a competition), which is
-- where the payable value comes from. A payment picks the budget it comes
-- out of, adds an optional extra, comments and financial-control files, and
-- carries a status the team advances as the payment moves through finance.
--
-- Access: RLS is enabled with no policies, so anon/authenticated roles
-- cannot touch these tables directly — everything goes through the FastAPI
-- backend with the service_role key (same pattern as game_assignments,
-- migration 006). This matters because payments hold sensitive financial
-- data (amounts, bank confirmations, W8 / bank-info documents).

-- ─── Editable catalogue of budgets a payment can come out of ────────────────
CREATE TABLE payment_budgets (
    code   text PRIMARY KEY,
    label  text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    sort   integer DEFAULT 0
);

INSERT INTO payment_budgets (code, label, sort) VALUES
    ('comms',          'Comms',          1),
    ('competitions',   'Competitions',   2),
    ('administration', 'Administration', 3),
    ('referees',       'Referees',       4),
    ('bcla',           'BCLA',           5),
    ('it',             'IT',             6);

-- ─── Payments ───────────────────────────────────────────────────────────────
-- Human-facing correlative EP-#####, mirroring the legacy vbills system.
CREATE SEQUENCE payment_record_seq START 1;

CREATE TABLE payments (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    record_no         text NOT NULL UNIQUE
                        DEFAULT 'EP-' || lpad(nextval('payment_record_seq')::text, 5, '0'),
    nomination_id     uuid NOT NULL UNIQUE REFERENCES nominations(id) ON DELETE CASCADE,
    budget_code       text NOT NULL REFERENCES payment_budgets(code),
    amount            numeric(12,2) NOT NULL DEFAULT 0,   -- prefilled from nomination.total, editable
    extra             numeric(12,2) NOT NULL DEFAULT 0,
    total             numeric(12,2) GENERATED ALWAYS AS (amount + extra) STORED,
    comments          text,
    status            text NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new', 'in_process', 'split', 'completed')),
    payment_date      date,
    bank_confirmation text,
    created_by        uuid,
    created_at        timestamptz DEFAULT now(),
    updated_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_payments_nomination ON payments(nomination_id);
CREATE INDEX idx_payments_status     ON payments(status);
CREATE INDEX idx_payments_budget     ON payments(budget_code);

-- ─── Financial-control attachments (EXPENSES, W8, BANK INFO, …) ──────────────
CREATE TABLE payment_attachments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id   uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    storage_path text NOT NULL,   -- storage://nominations/payments/<payment_id>/<uuid>.<ext>
    file_name    text NOT NULL,   -- original filename, for display
    kind         text,            -- free label: EXPENSES / W8 / BANK INFO / …
    uploaded_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_payment_attachments_payment ON payment_attachments(payment_id);

-- ─── RLS: enabled, no policies → backend-only via service_role ───────────────
ALTER TABLE payment_budgets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attachments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE payments IS
    'Payments to event personnel, anchored to a nomination. Backend-only (service_role); RLS on with no policies.';
COMMENT ON TABLE payment_attachments IS
    'Financial-control files for a payment (EXPENSES/W8/BANK INFO). Stored in the private nominations bucket under payments/.';
