-- FIBA Americas Nominations System — Initial Schema

CREATE TABLE personnel (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    email       text NOT NULL UNIQUE,
    country     text,
    phone       text,
    passport    text,
    role        text CHECK (role IN ('VGO', 'TD')),
    created_at  timestamptz DEFAULT now()
);

CREATE TABLE competitions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    template_key  text CHECK (template_key IN ('WCQ', 'BCLA', 'LSB', 'GENERIC')),
    year          integer,
    created_at    timestamptz DEFAULT now()
);

CREATE TABLE nominations (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    personnel_id          uuid REFERENCES personnel(id),
    competition_id        uuid REFERENCES competitions(id),
    letter_date           date,
    location              text,
    venue                 text,
    arrival_date          date,
    departure_date        date,
    game_dates            jsonb,
    window_fee            numeric,
    incidentals           numeric,
    total                 numeric GENERATED ALWAYS AS (window_fee + incidentals) STORED,
    confirmation_deadline date,
    status                text DEFAULT 'draft' CHECK (status IN ('draft', 'generated')),
    pdf_path              text,
    created_at            timestamptz DEFAULT now()
);

CREATE INDEX idx_nominations_personnel_id ON nominations(personnel_id);
CREATE INDEX idx_nominations_competition_id ON nominations(competition_id);
