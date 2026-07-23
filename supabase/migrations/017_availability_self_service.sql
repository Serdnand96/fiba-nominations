-- Self-service availability for officials (TDs, VGOs, referees, instructors,
-- video operators).
--
-- One shared secret link per personnel role: anyone with the link opens a
-- public form (/availability/<token>), picks their name from that role's
-- roster and submits their availability. No accounts involved; the token is
-- unguessable and can be rotated from the admin Availability page if a link
-- leaks. Public API lives under /api/public/availability/* (auth bypass +
-- rate limit in api/index.py).

CREATE TABLE availability_links (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role        text NOT NULL UNIQUE
                CHECK (role IN ('VGO', 'TD', 'REF', 'REF_INSTRUCTOR', 'VIDEO_OPERATOR')),
    token       text NOT NULL UNIQUE,
    created_at  timestamptz DEFAULT now(),
    rotated_at  timestamptz
);

-- Backend-only via service_role: RLS on with no policies, same pattern as
-- game_assignments (006) and payments (012).
ALTER TABLE availability_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE availability_links IS
  'Shared self-service availability link per personnel role. Token is a secret; rotating it invalidates the previously shared link. Accessed only via FastAPI backend with service_role.';

-- Freshness stamp: set every time the official submits the public form, even
-- with no changes ("still the same" is also information). Lets admins see who
-- has not confirmed in a while.
ALTER TABLE personnel ADD COLUMN availability_confirmed_at timestamptz;

-- Provenance of each availability record: 'admin' (backoffice matrix) or
-- 'self' (public form). NULL on legacy rows.
ALTER TABLE td_availability ADD COLUMN updated_by text
    CHECK (updated_by IN ('admin', 'self'));
