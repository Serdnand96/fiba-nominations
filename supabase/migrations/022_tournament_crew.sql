-- Tournament crew: competition-level personnel that covers the whole event.
--
-- `competition_assignments` existed since the beginning but was only read by
-- the Calendar module (a headcount badge). It now becomes the roster of a
-- tournament: on competitions with fee_type = 'tournament' the crew covers
-- EVERY game and every training slot, and it is what the nomination sync
-- rolls up (one letter per crew member, tournament fee, all game dates).
--
-- 1. The crew accepts every personnel role, not just TD/VGO — referee crews,
--    instructors and video operators are nominated for a whole tournament the
--    same way. Mirrors personnel_role_check (migration 016).
-- 2. game_assignments loses UNIQUE (game_id, role): in tournament mode a game
--    can carry more than one person on the same slot role (two TDs sharing the
--    table across the event). The per-game workflow keeps its one-person-per-
--    slot behaviour in the API (upsert), the constraint only stops the exact
--    same person being added twice to the same slot.

ALTER TABLE competition_assignments DROP CONSTRAINT IF EXISTS competition_assignments_role_check;
ALTER TABLE competition_assignments ADD CONSTRAINT competition_assignments_role_check
    CHECK (role IN ('VGO', 'TD', 'REF', 'REF_INSTRUCTOR', 'VIDEO_OPERATOR'));

ALTER TABLE game_assignments DROP CONSTRAINT IF EXISTS game_assignments_game_id_role_key;
ALTER TABLE game_assignments ADD CONSTRAINT game_assignments_game_role_personnel_key
    UNIQUE (game_id, role, personnel_id);

CREATE INDEX IF NOT EXISTS idx_competition_assignments_competition_id
    ON competition_assignments(competition_id);

COMMENT ON TABLE competition_assignments IS
    'Tournament crew: personnel assigned to a whole competition. On fee_type = ''tournament'' competitions this roster covers every game and training slot and drives the nomination sync. Managed from Calendar and Games. Accessed only via FastAPI backend with service_role.';
