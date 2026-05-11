-- Per-game role assignments (TD / VGO) for WCQ, BCLA and LSB competitions.
-- The nomination paperwork itself still lives in `nominations` (competition-level);
-- this table just tracks who is assigned to each individual game so we can roll
-- those dates up into a draft nomination.

CREATE TABLE game_assignments (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id       uuid NOT NULL REFERENCES game_schedule(id) ON DELETE CASCADE,
    personnel_id  uuid NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
    role          text NOT NULL CHECK (role IN ('TD', 'VGO')),
    created_at    timestamptz DEFAULT now(),
    UNIQUE (game_id, role)
);

CREATE INDEX idx_game_assignments_game_id ON game_assignments(game_id);
CREATE INDEX idx_game_assignments_personnel_id ON game_assignments(personnel_id);
