-- 049_notifications.sql — notificaciones in-app (la campana del topbar).
--
-- WP6 del flujo de finanzas. Dos cosas distintas viven detrás de la campana y
-- solo una se guarda acá:
--
--   Novedades  → ESTA tabla. Un evento puntual que le pasó a algo que me
--                importa ("Juan cargó un gasto de IT para aprobar", "tu gasto
--                fue rechazado"). Se inserta desde las transiciones de pagos y
--                gastos vía `notify()` (api/_lib/services/notify.py) y el
--                usuario la marca como leída.
--   Pendientes → NO se guardan. "Tenés 3 gastos para aprobar" se calcula en
--                vivo en GET /api/me/notifications/pending según los permisos
--                de quien pregunta. Persistirlo obligaría a recalcularlo en
--                cada alta, aprobación, cambio de permiso y cambio de mes.
--
-- `user_id` es el destinatario (auth.users.id, sin FK — mismo patrón que
-- budget_access.user_id y feed_posts.author_id). Sin FK a propósito: `notify()`
-- inserta en lote y una sola fila con un id viejo haría fallar todo el lote.
--
-- `entity_type` / `entity_id` dicen a qué apunta ('expense', 'payment', …) y
-- `link` es la ruta del frontend que abre la campana (p.ej.
-- `/budget?tab=expenses&open=<id>`). `read_at` NULL = no leída.
--
-- Solo el destinatario lee y marca las suyas: el router (prefijo /me, con
-- require_user) filtra por `user_id = me` en CADA query, incluido el UPDATE de
-- "marcar leída". RLS on sin políticas: tabla backend-only, el service_role la
-- bypassa y el anon/authenticated de PostgREST no ve nada.
--
-- Aplicar a mano contra Supabase ANTES de pushear el código que la usa.

begin;

CREATE TABLE IF NOT EXISTS notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL,
    -- Qué pasó, como clave estable: el frontend traduce el título por `kind`
    -- (i18n `notifications.*`). `title` queda como fallback legible.
    kind        text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 60),
    title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
    body        text CHECK (body IS NULL OR char_length(body) <= 2000),
    entity_type text,
    entity_id   text,
    link        text CHECK (link IS NULL OR char_length(link) <= 500),
    read_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- La bandeja: "las mías, no leídas primero / más nuevas primero" y el contador
-- de no leídas salen los dos de este índice.
CREATE INDEX IF NOT EXISTS idx_notifications_inbox
    ON notifications (user_id, read_at, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE notifications IS
    'Novedades in-app por usuario (campana). Backend-only: el router /me/notifications filtra por user_id = caller. Los pendientes NO se guardan acá, se calculan en vivo.';

commit;
