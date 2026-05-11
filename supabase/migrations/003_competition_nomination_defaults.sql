-- Per-competition nomination defaults. Used by the Games page to fill the
-- common values once per event and apply them to every nomination created via
-- the per-game TD/VGO assignment workflow. Fees + incidentals are role-aware
-- (TD and VGO get different amounts).

ALTER TABLE competitions
    ADD COLUMN default_letter_date           date,
    ADD COLUMN default_location              text,
    ADD COLUMN default_venue                 text,
    ADD COLUMN default_arrival_date          date,
    ADD COLUMN default_departure_date        date,
    ADD COLUMN default_confirmation_deadline date,
    ADD COLUMN td_window_fee                 numeric,
    ADD COLUMN td_incidentals                numeric,
    ADD COLUMN vgo_window_fee                numeric,
    ADD COLUMN vgo_incidentals               numeric;
