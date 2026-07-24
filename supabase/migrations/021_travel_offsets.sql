-- Travel offsets per competition.
--
-- Venue and travel dates are per-person (each official travels to the venue
-- of THEIR assigned games), so fixed competition-wide arrival/departure dates
-- don't fit. Replace them with offsets: arrive N days before the person's
-- first assigned game, leave M days after their last. The sync derives the
-- actual dates per person; default_arrival_date / default_departure_date stay
-- in the schema but are no longer used by the assignment workflow.

ALTER TABLE competitions
    ADD COLUMN IF NOT EXISTS default_arrival_offset_days integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS default_departure_offset_days integer NOT NULL DEFAULT 1;
