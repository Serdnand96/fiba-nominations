-- Expand personnel roles to include referees.
--
-- The Payments module pays every person that works an event. Until now
-- `personnel` only held TDs and VGOs (the officials that get nomination
-- letters). Referees now also live here so they can be nominated to an
-- event and, from that nomination, paid.
--
-- REF            = Referee
-- REF_INSTRUCTOR = Referee Instructor
--
-- `game_assignments.role` is intentionally left as ('TD','VGO'): per-game
-- referee assignments are out of scope for this change.

ALTER TABLE personnel DROP CONSTRAINT IF EXISTS personnel_role_check;
ALTER TABLE personnel ADD CONSTRAINT personnel_role_check
    CHECK (role IN ('VGO', 'TD', 'REF', 'REF_INSTRUCTOR'));
