-- Competition Reports + External Staff Evaluation.
--
-- Two modules that close the loop *after* an event runs:
--
--   1. competition_reports — the centralized home for post-event
--      documentation. A report hangs off a competition, records where it
--      happened (venue) and who organized it locally (LOC), and carries the
--      actual files. Filtering by competition / venue / LOC is the whole
--      point, so those are indexed.
--
--   2. staff_evaluations — the Competition Lead / Support / Direct Report
--      rates the external staff that worked the event (the people in
--      `personnel`, i.e. TDs and VGOs — NOT `employees`, which is internal
--      FIBA staff). Scores are 1-5 across a fixed set of topics; the average
--      is materialized so it can be sorted and charted without unpacking
--      JSON.
--
-- Access: RLS is enabled with no policies, so anon/authenticated roles cannot
-- touch these tables directly — everything goes through the FastAPI backend
-- with the service_role key (same pattern as payments, migration 012).
-- Evaluations in particular are candid personnel assessments, so they must
-- never be reachable from the browser's Supabase client.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Competition reports
-- ════════════════════════════════════════════════════════════════════════════

-- Editable catalogue, so a new kind of report does not need a migration.
CREATE TABLE competition_report_types (
    code   text PRIMARY KEY,
    label  text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    sort   integer DEFAULT 0
);

INSERT INTO competition_report_types (code, label, sort) VALUES
    ('final',       'Final Report',        1),
    ('technical',   'Technical Report',    2),
    ('operations',  'Operations Report',   3),
    ('venue',       'Venue Report',        4),
    ('loc',         'LOC Report',          5),
    ('medical',     'Medical Report',      6),
    ('security',    'Security Report',     7),
    ('other',       'Other',               8);

CREATE TABLE competition_reports (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    type_code      text NOT NULL REFERENCES competition_report_types(code),
    title          text NOT NULL,
    venue          text,
    loc            text,          -- Local Organizing Committee
    report_date    date,
    summary        text,
    created_by     uuid,
    created_at     timestamptz DEFAULT now(),
    updated_at     timestamptz DEFAULT now()
);

CREATE INDEX idx_competition_reports_competition ON competition_reports(competition_id);
CREATE INDEX idx_competition_reports_type        ON competition_reports(type_code);
CREATE INDEX idx_competition_reports_venue       ON competition_reports(venue);
CREATE INDEX idx_competition_reports_loc         ON competition_reports(loc);

-- The documents themselves. Objects live in the PRIVATE `nominations` bucket
-- under `reports/<report_id>/<uuid>.<ext>`; storage_path uses the project's
-- `storage://nominations/<key>` convention.
CREATE TABLE competition_report_files (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id    uuid NOT NULL REFERENCES competition_reports(id) ON DELETE CASCADE,
    storage_path text NOT NULL,
    file_name    text NOT NULL,
    content_type text,
    size_bytes   bigint,
    uploaded_by  uuid,
    uploaded_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_competition_report_files_report ON competition_report_files(report_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. External staff evaluations
-- ════════════════════════════════════════════════════════════════════════════

-- `scores` is {criterion_code: 1..5} — jsonb rather than one column per topic
-- so the criteria list can grow without a migration (same call as
-- personnel.visas in migration 009). The backend validates the keys against
-- EVALUATION_CRITERIA and the range; `average` is written by the backend on
-- every save so lists can sort on it.
CREATE TABLE staff_evaluations (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    personnel_id   uuid NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
    evaluator_role text NOT NULL DEFAULT 'competition_lead'
                     CHECK (evaluator_role IN ('competition_lead', 'competition_support', 'direct_report')),
    scores         jsonb NOT NULL DEFAULT '{}'::jsonb,
    average        numeric(3,2),
    strengths      text,
    improvements   text,
    comments       text,
    status         text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'submitted')),
    created_by     uuid,
    created_at     timestamptz DEFAULT now(),
    updated_at     timestamptz DEFAULT now()
);

-- One evaluation per (person, competition, evaluator). Two different leads
-- may each evaluate the same person for the same event — that is intentional,
-- the historical record keeps both.
CREATE UNIQUE INDEX idx_staff_evaluations_unique
    ON staff_evaluations(competition_id, personnel_id, created_by);

CREATE INDEX idx_staff_evaluations_competition ON staff_evaluations(competition_id);
CREATE INDEX idx_staff_evaluations_personnel   ON staff_evaluations(personnel_id);

-- ════════════════════════════════════════════════════════════════════════════
-- Lock the tables down (backend-only, service_role bypasses RLS)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE competition_report_types  ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_report_files  ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_evaluations         ENABLE ROW LEVEL SECURITY;
