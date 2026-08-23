-- 038_payments_budget_bridge.sql — el pago a una persona imputa a presupuesto.
--
-- Fase 6 de BUDGET_MODULE.md §14.
--
-- QUÉ ARREGLA. La migración 036 agregó `payments.department_code` y
-- `account_code` y backfilleó lo que existía en ese momento, pero el alta de un
-- pago nunca los escribió: `create_payment` inserta `budget_code` y la UI sigue
-- ofreciendo el catálogo viejo `payment_budgets` — justamente el que mezcla
-- departamento con línea presupuestaria y que la 036 vino a separar. Resultado:
-- todo pago cargado desde la 036 en adelante cae en `unallocated_payments` y no
-- aparece en ningún total por departamento ni por cuenta.
--
-- Esta migración hace tres cosas:
--   1. agrega la cuenta del AIRFARE, que es una línea distinta de la del fee;
--   2. libera `budget_code` de su NOT NULL, porque la UI deja de pedirlo;
--   3. vuelve a correr el backfill de la 036 sobre lo que se cargó desde
--      entonces, y le suma la cuenta de travel.
--
-- El backend pasa a EXIGIR departamento y cuenta al crear un pago (ver
-- routers/payments.py), así que esto es lo último que hay que backfillear: de
-- acá en adelante no puede volver a entrar un pago sin imputar.
--
-- NO forma parte del deploy automático: aplicá a mano contra Supabase.

begin;

-- ─── La cuenta del vuelo ────────────────────────────────────────────────────
--
-- Un pago paga DOS cosas que son líneas distintas del presupuesto: el fee de la
-- persona (COMP-11 para un TD) y su vuelo (COMP-12). Con una sola `account_code`
-- el airfare se imputaba a la cuenta del fee o a ninguna; con esta columna cada
-- mitad va a la línea que le corresponde y las cuentas de travel — COMP-07, 09,
-- 12 y 14 — dejan de mostrar 100% de remanente para siempre.
--
-- Nullable a propósito: un pago sin vuelo no necesita cuenta de vuelo, y el
-- backend solo la exige cuando `airfare > 0`.
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS airfare_account_code text
        REFERENCES accounts(code) ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS idx_payments_airfare_account ON payments(airfare_account_code);

-- ─── `budget_code` deja de ser obligatorio ──────────────────────────────────
--
-- `payment_budgets` se mantiene: los pagos históricos lo tienen cargado y es lo
-- que hace legible un registro de 2024. Pero la dimensión pasa a ser
-- (departamento, cuenta) y la UI deja de ofrecerlo, así que un pago nuevo entra
-- sin él. Sin este DROP NOT NULL el insert falla.
ALTER TABLE payments ALTER COLUMN budget_code DROP NOT NULL;

-- ─── Backfill: lo cargado desde la 036 ──────────────────────────────────────
--
-- Mismos dos CASE que la 036, palabra por palabra. Se repiten en vez de
-- referenciarse porque una migración tiene que poder leerse sola, y el
-- `WHERE ... IS NULL` los vuelve idempotentes: lo que la 036 ya imputó no se
-- toca.
UPDATE payments SET department_code = CASE budget_code
    WHEN 'comms'          THEN 'comms'
    WHEN 'competitions'   THEN 'competitions'
    WHEN 'administration' THEN 'admin'
    WHEN 'referees'       THEN 'competitions'
    WHEN 'bcla'           THEN 'club_competitions'
    WHEN 'it'             THEN 'it'
END
WHERE department_code IS NULL AND budget_code IS NOT NULL;

UPDATE payments p SET account_code = CASE per.role
    WHEN 'TD'             THEN 'COMP-11'   -- Technical Delegate Fees
    WHEN 'VGO'            THEN 'COMP-13'   -- TV Graphics Operator Fees
    WHEN 'REF'            THEN 'COMP-10'   -- Referees Fees
    WHEN 'REF_INSTRUCTOR' THEN 'COMP-08'   -- Referee Instructor / Commissioners Fees
END
FROM nominations n
JOIN personnel per ON per.id = n.personnel_id
WHERE p.nomination_id = n.id
  AND p.account_code IS NULL
  AND per.role IN ('TD', 'VGO', 'REF', 'REF_INSTRUCTOR');

-- ─── Backfill: la cuenta de travel ──────────────────────────────────────────
--
-- La columna paralela del Excel de Competitions: cada rol tiene su línea de fee
-- y su línea de viaje. El mapeo vive también en `_ROLE_ACCOUNTS` de
-- routers/payments.py, que es el que rellena los pagos nuevos — si cambia uno,
-- cambian los dos.
--
--   TD             → COMP-12 Technical Delegate Travel Expense
--   VGO            → COMP-14 TV Graphics Operator Travel Expenses
--   REF            → COMP-07 Referees Travel Expense
--   REF_INSTRUCTOR → COMP-09 Referee Instructor / Commissioners Travel Expense
--
-- `VIDEO_OPERATOR` queda afuera a propósito: el sheet Fees Breakdown no lo trae
-- y la 036 tampoco le dio cuenta de fee. Sus pagos siguen sin imputar y se ven
-- en `unallocated_payments` hasta que se decida su línea (BUDGET_MODULE §14.6).
UPDATE payments p SET airfare_account_code = CASE per.role
    WHEN 'TD'             THEN 'COMP-12'
    WHEN 'VGO'            THEN 'COMP-14'
    WHEN 'REF'            THEN 'COMP-07'
    WHEN 'REF_INSTRUCTOR' THEN 'COMP-09'
END
FROM nominations n
JOIN personnel per ON per.id = n.personnel_id
WHERE p.nomination_id = n.id
  AND p.airfare_account_code IS NULL
  AND COALESCE(p.airfare, 0) > 0
  AND per.role IN ('TD', 'VGO', 'REF', 'REF_INSTRUCTOR');

COMMENT ON COLUMN payments.airfare_account_code IS
    'Cuenta del vuelo, distinta de la del fee (TD: fee COMP-11 / travel COMP-12). Solo se exige cuando airfare > 0.';
COMMENT ON COLUMN payments.budget_code IS
    'Catálogo viejo payment_budgets, que mezclaba departamento y línea. Histórico: los pagos nuevos usan department_code + account_code (migración 038).';

commit;
