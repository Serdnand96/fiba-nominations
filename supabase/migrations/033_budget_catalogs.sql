-- 033_budget_catalogs.sql — catálogos del módulo Budget.
--
-- Fase 1 de BUDGET_MODULE.md. Tres catálogos que sostienen todo lo demás:
-- departamentos (quién gasta), plan de cuentas (en qué se gasta) y proveedores
-- (a quién se le paga).
--
-- POR QUÉ DOS DIMENSIONES Y NO UNA. El caso testigo está en el presupuesto de
-- Competitions 2027: la línea 16 "TV Production / Streaming (COMMS)" son
-- $267.000 — la línea más grande del presupuesto entero — y vive dentro del
-- presupuesto de Competitions, pero el trabajo es de Comms. Lo mismo la 26 "IT
-- on Events". Si departamento y cuenta fueran la misma columna no habría forma
-- de responder "cuánto gastó Comms este año" sin leer los nombres a mano.
-- `payment_budgets` (migración 012) mezcló las dos cosas; acá se separan.
--
-- Backend-only vía service_role: RLS habilitado sin políticas, mismo patrón que
-- payments (012), availability_links (017) y logística (025). Son datos
-- financieros: montos, datos bancarios de proveedores, tax IDs.
--
-- NO forma parte del deploy automático: aplicá a mano contra Supabase.

begin;

-- ─── Departamentos: quién gasta ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
    code   text PRIMARY KEY,
    label  text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    sort   integer NOT NULL DEFAULT 0
);

INSERT INTO departments (code, label, sort) VALUES
    ('competitions',       'Competitions',       1),
    ('club_competitions',  'Club Competitions',  2),
    ('comms',              'Comms',              3),
    ('events',             'Events',             4),
    ('3x3',                '3x3',                5),
    ('youth_development',  'Youth Development',  6),
    ('it',                 'IT',                 7),
    ('admin',              'Admin',              8),
    ('finance',            'Finance',            9)
ON CONFLICT (code) DO NOTHING;

-- ─── Plan de cuentas: en qué se gasta ───────────────────────────────────────
--
-- El plan oficial lo administra Finance y todavía no está entregado. Se siembra
-- con lo que ya existe en los Excel y las cuentas sin código real quedan
-- marcadas con `pending_mapping` para poder listarlas y remapearlas después.
--
-- El remapeo COMP-xx → código real es un UPDATE sobre esta tabla: todas las FK
-- que apuntan acá llevan ON UPDATE CASCADE justamente para eso.
CREATE TABLE IF NOT EXISTS accounts (
    code            text PRIMARY KEY,
    label           text NOT NULL,
    kind            text NOT NULL DEFAULT 'expense'
                      CHECK (kind IN ('expense', 'revenue')),
    -- Agrupación para subtotales. Auto-referencia: hoy nadie la usa, existe
    -- para cuando llegue el plan de Finance, que sí tiene jerarquía.
    parent_code     text REFERENCES accounts(code) ON UPDATE CASCADE ON DELETE SET NULL,
    -- Default de escalación anual para la proyección multi-año (migración 035).
    -- Los valores de IT salen del sheet `Assumptions` de FIBA_IT_Budget_2027-2030.
    escalation_pct  numeric(5,4) NOT NULL DEFAULT 0,
    -- true = el código es provisorio, falta el oficial de Finance.
    pending_mapping boolean NOT NULL DEFAULT false,
    active          boolean NOT NULL DEFAULT true,
    sort            integer NOT NULL DEFAULT 0,
    notes           text
);

CREATE INDEX IF NOT EXISTS idx_accounts_kind ON accounts(kind) WHERE active;

-- Códigos contables REALES (FIBA_IT_Budget_2027-2030.xlsx, sheet Assumptions).
-- Estos no son provisorios: son el plan de cuentas que IT ya usa.
INSERT INTO accounts (code, label, escalation_pct, pending_mapping, sort) VALUES
    ('610400', 'Utilities (Electricity & Water)',        0.05, false, 10),
    ('610500', 'Leasing Equipment',                      0.00, false, 20),
    ('611000', 'Telephone, Internet, Mail & Courier',    0.03, false, 30),
    ('612100', 'IT Hardware & Equipment',                0.03, false, 40),
    ('612200', 'IT Maintenance & Repairs',               0.04, false, 50),
    ('612300', 'IT Software & Licenses',                 0.06, false, 60)
ON CONFLICT (code) DO NOTHING;

-- Las 28 líneas de CompsDraftBudget2027, en el orden del Excel. Provisorias:
-- la planilla las numera 1..28 sin código contable.
INSERT INTO accounts (code, label, pending_mapping, sort) VALUES
    ('COMP-01', 'Court Signage (Advertising Boards)',                        true, 101),
    ('COMP-02', 'Shipping (DHL or Sea)',                                     true, 102),
    ('COMP-03', 'FIBA Coordinator Fees',                                     true, 103),
    ('COMP-04', 'FIBA Coordinator Travel Expense',                           true, 104),
    ('COMP-05', 'Floor Stickers',                                            true, 105),
    ('COMP-06', 'Graphic Designs (Logo/Stationary/Branding etc)',            true, 106),
    ('COMP-07', 'Referees Travel Expense',                                   true, 107),
    ('COMP-08', 'Referee Instructor / Commissioners Fees',                   true, 108),
    ('COMP-09', 'Referee Instructor / Commissioners Travel Expense',         true, 109),
    ('COMP-10', 'Referees Fees',                                             true, 110),
    ('COMP-11', 'Technical Delegate Fees',                                   true, 111),
    ('COMP-12', 'Technical Delegate Travel Expense',                         true, 112),
    ('COMP-13', 'TV Graphics Operator Fees',                                 true, 113),
    ('COMP-14', 'TV Graphics Operator Travel Expenses',                      true, 114),
    ('COMP-15', 'Comms Expenses',                                            true, 115),
    ('COMP-16', 'TV Production / Streaming',                                 true, 116),
    ('COMP-17', 'Competition Draw',                                          true, 117),
    ('COMP-18', 'Insurance',                                                 true, 118),
    ('COMP-19', 'FA Staff Travel (+Other Expenses)',                         true, 119),
    ('COMP-20', 'Authorities Travel Expenses',                               true, 120),
    ('COMP-21', 'Venue Inspection & Site Visits',                            true, 121),
    ('COMP-22', 'Miscellaneous',                                             true, 122),
    ('COMP-23', 'Technologies Innovations & Awards',                         true, 123),
    ('COMP-24', 'Eligibility Expenses (Doping/Technical Meetings)',          true, 124),
    ('COMP-25', 'NF Development / Table Officials / Statistician / Workshops / Post Event Reporting', true, 125),
    ('COMP-26', 'IT on Events',                                              true, 126),
    ('COMP-27', 'Hosting Support',                                           true, 127),
    ('COMP-28', 'Long Term Acquisitions (Court / Backstop Units)',           true, 128)
ON CONFLICT (code) DO NOTHING;

-- Ingresos. Salen del sheet Summary de CompsDraftBudget2027 (Expected Revenue
-- $370.000, Grant Requested $1.163.832) y del contrato LSB-Enjoy.
INSERT INTO accounts (code, label, kind, pending_mapping, sort) VALUES
    ('REV-01', 'Grant (FIBA HQ)',   'revenue', true, 201),
    ('REV-02', 'Sponsorship',       'revenue', true, 202),
    ('REV-03', 'Hosting Fee',       'revenue', true, 203),
    ('REV-04', 'TV / Media Rights', 'revenue', true, 204),
    ('REV-05', 'Other Revenue',     'revenue', true, 205)
ON CONFLICT (code) DO NOTHING;

-- ─── Proveedores: a quién se le paga ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    tax_id     text,
    country    text,
    email      text,
    phone      text,
    -- Texto libre igual que en los adjuntos de payments: acá va lo que haga
    -- falta para transferir (banco, SWIFT, cuenta). No se valida formato porque
    -- cambia por país y la mitad llega escrito a mano en un PDF.
    bank_info  text,
    notes      text,
    active     boolean NOT NULL DEFAULT true,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive: evita "Adobe" / "adobe" / "ADOBE" como tres proveedores.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_name_unique ON vendors (lower(name));
CREATE INDEX IF NOT EXISTS idx_vendors_active ON vendors(active);

-- ─── RLS: habilitada, sin políticas → backend-only vía service_role ─────────
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors     ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE departments IS
    'Departamentos que gastan. Dimensión separada de accounts: una competencia cruza departamentos (ver BUDGET_MODULE.md).';
COMMENT ON TABLE accounts IS
    'Plan de cuentas. Los códigos COMP-xx y REV-xx son provisorios (pending_mapping) hasta que Finance entregue el oficial.';
COMMENT ON TABLE vendors IS
    'Proveedores. Datos bancarios y fiscales: backend-only, RLS on sin políticas.';

commit;
