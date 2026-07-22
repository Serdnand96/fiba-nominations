-- Referee crew expansion + multi-nationality referees.
--
-- 1. New personnel role: VIDEO_OPERATOR (distinct from VGO = Video Graphic
--    Operator). Instructors (REF_INSTRUCTOR) already existed.
-- 2. personnel.nationalities — additional nationalities beyond country_code
--    (FIBA codes). A referee with several nationalities is restricted by ALL
--    of them.
-- 3. New per-game assignment slots: INSTR (Referee Instructor) and VO
--    (Video Operator), one per game like TD/VGO.
-- 4. Per-role nomination fee defaults on competitions, so the Games
--    "common values" panel can mass-generate nominations for referees,
--    instructors and video operators too.

ALTER TABLE personnel DROP CONSTRAINT IF EXISTS personnel_role_check;
ALTER TABLE personnel ADD CONSTRAINT personnel_role_check
    CHECK (role IN ('VGO', 'TD', 'REF', 'REF_INSTRUCTOR', 'VIDEO_OPERATOR'));

ALTER TABLE personnel
    ADD COLUMN IF NOT EXISTS nationalities text[] NOT NULL DEFAULT '{}';

ALTER TABLE game_assignments DROP CONSTRAINT IF EXISTS game_assignments_role_check;
ALTER TABLE game_assignments ADD CONSTRAINT game_assignments_role_check
    CHECK (role IN ('TD', 'VGO', 'CC', 'U1', 'U2', 'INSTR', 'VO'));

ALTER TABLE competitions
    ADD COLUMN IF NOT EXISTS ref_window_fee numeric,
    ADD COLUMN IF NOT EXISTS ref_incidentals numeric,
    ADD COLUMN IF NOT EXISTS ref_instructor_window_fee numeric,
    ADD COLUMN IF NOT EXISTS ref_instructor_incidentals numeric,
    ADD COLUMN IF NOT EXISTS video_operator_window_fee numeric,
    ADD COLUMN IF NOT EXISTS video_operator_incidentals numeric;
