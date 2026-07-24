-- Flight-purchase check per official per competition.
--
-- One row per (competition, person): has the flight to the venue been bought?
-- Lives outside the nomination lifecycle so it can be ticked from the Games
-- page as soon as someone is assigned, before any nomination draft exists,
-- and survives nomination re-syncs.

CREATE TABLE competition_flights (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    personnel_id   uuid NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
    flight_booked  boolean NOT NULL DEFAULT false,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (competition_id, personnel_id)
);

CREATE INDEX idx_competition_flights_competition ON competition_flights(competition_id);

-- Backend-only access (service_role bypasses RLS), same pattern as
-- game_assignments / availability_links.
ALTER TABLE competition_flights ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE competition_flights IS
  'Per-competition flight-purchase check for assigned officials. Accessed only via FastAPI backend with service_role. RLS enabled with no policies so anon/authenticated roles cannot bypass the backend.';
