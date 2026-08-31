-- 036_budget_access.sql — acceso por departamento + payments consume presupuesto.
--
-- Fase 3 de BUDGET_MODULE.md.
--
-- ⚠️ ESTE ES EL PRIMER FILTRADO POR FILA DEL SISTEMA. Hasta hoy un permiso
-- abre o cierra un endpoint entero: quien tiene `logistics` ve toda la
-- logística. Acá no alcanza — el designado de IT tiene que ver los gastos de IT
-- y no los de Competitions.
--
-- Y no se puede resolver con RLS: el backend pega a Supabase con el
-- `service_role`, que la bypassa por diseño (ver CLAUDE.md). El recorte vive en
-- el código, en CADA query del router. Una query de budget sin el filtro de
-- departamento es un agujero P0, igual que un endpoint sin require_view.
--
-- POR QUÉ UNA TABLA Y NO COLUMNAS EN user_permissions. El pedido fue "varios
-- designados por área, con diferentes permisos": un usuario puede editar IT y
-- solo mirar Competitions. Eso es una relación N-a-N usuario↔departamento con
-- su propio par (can_view, can_edit); en `user_permissions` sería una fila por
-- (usuario, módulo) y no hay dónde poner el departamento.
--
-- NO forma parte del deploy automático: aplica a mano contra Supabase.

begin;

CREATE TABLE IF NOT EXISTS budget_access (
    user_id         uuid NOT NULL,
    -- '*' = todos los departamentos (el "administrador general" del pedido).
    -- Es un valor centinela y no una FK para no tener que crear un
    -- departamento falso; la validación de que existe la hace el backend.
    department_code text NOT NULL,
    can_view        boolean NOT NULL DEFAULT true,
    can_edit        boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, department_code)
);

CREATE INDEX IF NOT EXISTS idx_budget_access_user ON budget_access(user_id);

ALTER TABLE budget_access ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE budget_access IS
    'Departamentos que ve/edita cada usuario dentro del módulo budget. department_code = ''*'' significa todos. El filtro se aplica en el backend: service_role bypassa RLS.';

-- ─── Los pagos a personas también consumen presupuesto ──────────────────────
--
-- Sin esto el "ejecutado" del módulo cuenta solo `expenses` y deja afuera lo
-- que se le paga a TDs, VGOs y árbitros — que en el presupuesto de Competitions
-- 2027 son las líneas 3, 8, 10, 11 y 13. El summary lo venía declarando con
-- `excludes_person_payments`; a partir de acá ese flag pasa a false.
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS department_code text REFERENCES departments(code) ON UPDATE CASCADE,
    ADD COLUMN IF NOT EXISTS account_code    text REFERENCES accounts(code)    ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS idx_payments_department ON payments(department_code);
CREATE INDEX IF NOT EXISTS idx_payments_account    ON payments(account_code);

-- Backfill desde el `budget_code` viejo (payment_budgets, migración 012), que
-- mezclaba departamento y línea presupuestaria en una sola columna. El mapeo no
-- es 1-a-1 y por eso se hace explícito acá:
--   comms          → comms
--   competitions   → competitions
--   administration → admin
--   referees       → competitions  (los árbitros los paga Competitions; el
--                                   "de dónde sale" pasa a ser la cuenta)
--   bcla           → club_competitions
--   it             → it
UPDATE payments SET department_code = CASE budget_code
    WHEN 'comms'          THEN 'comms'
    WHEN 'competitions'   THEN 'competitions'
    WHEN 'administration' THEN 'admin'
    WHEN 'referees'       THEN 'competitions'
    WHEN 'bcla'           THEN 'club_competitions'
    WHEN 'it'             THEN 'it'
END
WHERE department_code IS NULL AND budget_code IS NOT NULL;

-- La cuenta según a quién se le paga. `personnel.role` es lo que distingue un
-- fee de TD del de un árbitro o un VGO, y esas son líneas distintas del
-- presupuesto de Competitions.
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

-- Se dejan NULLABLE a propósito: hay pagos históricos sin budget_code o sin rol
-- mapeable, y forzarlos a NOT NULL rompería el módulo de pagos que ya funciona.
-- El summary trata el NULL como "sin imputar" y lo reporta aparte, así se ve
-- qué falta clasificar en vez de esconderlo en un total.

commit;
