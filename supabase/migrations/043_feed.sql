-- Muro: el feed interno del equipo (permiso `feed`).
--
-- Un "muro" a lo Facebook: novedades de los compañeros, eventos, avisos de
-- RRHH y lo que haga al día a día de la oficina. Es deliberadamente el módulo
-- menos formal del sistema — dispersión con información — y por eso el modelo
-- es chico y el permiso funciona distinto al del resto:
--
--   feed:view  → PARTICIPAR. Leer, publicar, reaccionar, comentar, votar en
--                encuestas y borrar lo propio. En un muro donde solo unos
--                pocos pudieran escribir no habría muro.
--   feed:edit  → MODERAR. Fijar arriba, marcar una publicación como oficial
--                (avisos de RRHH / dirección) y borrar publicaciones o
--                comentarios ajenos.
--
-- Es la excepción a la regla "toda escritura lleva require_edit": en
-- api/_lib/routers/feed.py las escrituras sobre contenido PROPIO van con
-- require_view + chequeo de autor; require_edit queda para moderar. Está
-- documentado en CLAUDE.md (punto 18) y en el skill security-checklist.
--
-- Autor: se guarda `author_id` (auth.users.id, sin FK — mismo patrón que
-- payments.created_by) y una foto del nombre en `author_name`. El nombre sale
-- de `employees` por email si la persona está cargada; si no, del email. Se
-- congela a propósito: renombrar al empleado no reescribe el muro.
--
-- Imágenes: van al bucket público `inventory` bajo el prefijo `feed/`, igual
-- que las fotos de personnel. El muro no lleva documentos, solo fotos.
--
-- Aplicar a mano contra Supabase ANTES de pushear el código que la usa.

CREATE TABLE feed_posts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       uuid NOT NULL,
    author_email    text,
    author_name     text NOT NULL,
    -- general: lo cotidiano · news: novedades del equipo · event: eventos y
    -- competencias · hr: RRHH · fun: off-topic / para reírse · kudos: aplausos
    -- a un compañero.
    category        text NOT NULL DEFAULT 'general'
                    CHECK (category IN ('general', 'news', 'event', 'hr', 'fun', 'kudos')),
    body            text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    image_url       text,
    link_url        text CHECK (link_url IS NULL OR char_length(link_url) <= 2000),
    -- Encuesta opcional: array JSON de 2 a 6 strings. Los votos van aparte.
    poll_options    jsonb,
    -- Opcional: engancha la publicación a una competencia (un evento del
    -- calendario). Si la competencia se borra, el post queda sin vínculo.
    competition_id  uuid REFERENCES competitions(id) ON DELETE SET NULL,
    is_pinned       boolean NOT NULL DEFAULT false,
    -- Avisos de RRHH / dirección. Solo un moderador (feed:edit) puede marcarlo.
    is_official     boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    edited_at       timestamptz,

    CONSTRAINT feed_posts_poll_shape CHECK (
        poll_options IS NULL
        OR (jsonb_typeof(poll_options) = 'array'
            AND jsonb_array_length(poll_options) BETWEEN 2 AND 6)
    )
);

-- Una reacción por persona y publicación; cambiar de emoji pisa la anterior.
CREATE TABLE feed_reactions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     uuid NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL,
    emoji       text NOT NULL CHECK (emoji IN ('👍', '❤️', '🏀', '🎉', '😂', '👏')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (post_id, user_id)
);

CREATE TABLE feed_comments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     uuid NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    author_id   uuid NOT NULL,
    author_name text NOT NULL,
    body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Un voto por persona y encuesta; volver a votar cambia la opción.
CREATE TABLE feed_poll_votes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id       uuid NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL,
    option_index  smallint NOT NULL CHECK (option_index BETWEEN 0 AND 5),
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (post_id, user_id)
);

-- El feed se lee fijados primero y después por fecha, filtrando por categoría.
CREATE INDEX idx_feed_posts_feed ON feed_posts (is_pinned DESC, created_at DESC);
CREATE INDEX idx_feed_posts_category ON feed_posts (category, created_at DESC);
CREATE INDEX idx_feed_reactions_post ON feed_reactions (post_id);
CREATE INDEX idx_feed_comments_post ON feed_comments (post_id, created_at);
CREATE INDEX idx_feed_poll_votes_post ON feed_poll_votes (post_id);

-- Backend-only via service_role: RLS on sin policies, como activity_log (018)
-- y competition_staffing (029).
ALTER TABLE feed_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_poll_votes ENABLE ROW LEVEL SECURITY;

-- ── Permiso `feed` ──────────────────────────────────────────────────────────
-- Mantener en sync con MODULES en api/_lib/routers/permissions.py y en
-- src/pages/Users.jsx. Nadie lo tiene por defecto: se otorga desde Usuarios.

ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_module_check;

ALTER TABLE user_permissions
  ADD CONSTRAINT user_permissions_module_check CHECK (module IN (
    'calendar', 'nominations', 'personnel', 'competitions', 'templates',
    'users', 'logistics', 'availability', 'training', 'games', 'assets',
    'loans', 'employees', 'payments', 'reports', 'evaluations', 'comp_days',
    'budget', 'feed'
  ));

COMMENT ON TABLE feed_posts IS
  'Muro interno del equipo. feed:view participa (publica, reacciona, comenta), feed:edit modera (fija, marca oficial, borra ajeno). Accedida solo desde FastAPI con service_role.';
COMMENT ON TABLE feed_reactions IS
  'Una reacción (emoji) por usuario y publicación del muro.';
COMMENT ON TABLE feed_comments IS
  'Comentarios de las publicaciones del muro.';
COMMENT ON TABLE feed_poll_votes IS
  'Un voto por usuario en la encuesta de una publicación del muro.';
