-- Airfare on payments.
--
-- Airfare (the flight cost) is tracked per payment but is NOT part of what the
-- person is paid: the payment `total` stays amount + extra. Airfare is reported
-- as a separate cost line (typically settled with the travel agency), mirroring
-- the legacy vbills system where Payment = Amount and Airfare sat apart.

ALTER TABLE payments
    ADD COLUMN airfare numeric(12,2) NOT NULL DEFAULT 0;
