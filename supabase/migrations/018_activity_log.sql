-- Activity log: server-side audit trail of who did what in the admin.
--
-- Every successful mutation (POST/PUT/PATCH/DELETE) that passes the auth
-- middleware gets one row here, recorded by a middleware in api/index.py
-- after the response is sent (best-effort: a failed insert never breaks the
-- user's request). Read via GET /api/activity, superadmin only.
--
-- Request bodies are deliberately NOT stored: they can carry sensitive data
-- (user passwords, personal details). Method + path + entity id give enough
-- context to answer "who touched what, when".

CREATE TABLE activity_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid,
    user_email  text,
    action      text NOT NULL,      -- HTTP method: POST / PUT / PATCH / DELETE
    module      text,               -- first path segment after /api: nominations, personnel, ...
    path        text NOT NULL,      -- full request path, e.g. /api/nominations/123/generate
    entity_id   text,               -- first id-looking segment after the module, if any
    status      smallint,           -- response status code
    ip          text,
    user_agent  text,
    metadata    jsonb,              -- filtered query params (never bodies, never tokens)
    created_at  timestamptz DEFAULT now()
);

-- The Activity page filters by user, module and date range, newest first.
CREATE INDEX idx_activity_log_created_at ON activity_log (created_at DESC);
CREATE INDEX idx_activity_log_user ON activity_log (user_id, created_at DESC);
CREATE INDEX idx_activity_log_module ON activity_log (module, created_at DESC);

-- Backend-only via service_role: RLS on with no policies, same pattern as
-- game_assignments (006), payments (012) and availability_links (017).
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE activity_log IS
  'Audit trail of admin mutations, written by the FastAPI middleware. Rows older than the retention window (180 days) are purged opportunistically when the log is read. Accessed only via FastAPI backend with service_role.';
