-- 052_google_calendar.sql — conexión de cada usuario con su Google Calendar.
--
-- Quien tiene `calendar` o `games` conecta su cuenta de Google desde "Mi
-- perfil" y la app le mantiene un calendario secundario propio ("FIBA Americas
-- — Partidos") con los partidos de las competencias activas. El código está en
-- api/_lib/services/google_calendar.py, el router en
-- api/_lib/routers/google_calendar.py (/api/me/google-calendar) y el cron en
-- scripts/google_calendar_sync.py.
--
-- Una fila por usuario. No hay tabla de mapeo partido ↔ evento: el ID del
-- evento en Google se deriva del game_id ("g" + uuid sin guiones), y el hash
-- del contenido viaja en el propio evento (extendedProperties.private).
--
-- `refresh_token_enc` es el refresh token de Google CIFRADO con Fernet
-- (GOOGLE_TOKEN_KEY en .env). Nunca vuelve al frontend. Sin la clave, el valor
-- guardado no sirve de nada — por eso perder la clave obliga a reconectar, no
-- es un dato que haya que migrar.
--
-- `oauth_state_hash` / `oauth_state_expires_at`: el `state` del flujo OAuth en
-- curso (sha256, vence a los 10 minutos). El callback valida que el state sea
-- de QUIEN llama y no haya vencido, y lo borra al usarlo.
--
-- `sync_started_at`: claim de "hay una sync corriendo" para este usuario. Lo
-- toma un UPDATE condicional (atómico) y se libera al terminar; si el proceso
-- muere, vence a los 10 minutos. Sin esto, el cron y el botón "Sincronizar"
-- en paralelo crean cada uno su calendario.
--
-- `user_id` sin FK a auth.users, mismo patrón que notifications.user_id y
-- budget_access.user_id.
--
-- RLS on sin políticas: tabla backend-only, el service_role la bypassa y el
-- anon/authenticated de PostgREST no ve nada (un refresh token es una llave a
-- la cuenta de Google de la persona).
--
-- Aplicar a mano contra Supabase ANTES de pushear el código que la usa.

CREATE TABLE IF NOT EXISTS google_calendar_links (
    user_id                 uuid PRIMARY KEY,
    google_email            text,
    refresh_token_enc       text,
    calendar_id             text,
    oauth_state_hash        text,
    oauth_state_expires_at  timestamptz,
    connected_at            timestamptz,
    last_synced_at          timestamptz,
    last_sync_error         text,
    events_count            integer,
    sync_started_at         timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE google_calendar_links IS
  'Conexión de cada usuario con su Google Calendar (sync de partidos). refresh_token_enc va cifrado con Fernet (GOOGLE_TOKEN_KEY). Backend-only.';
COMMENT ON COLUMN google_calendar_links.refresh_token_enc IS
  'Refresh token de Google cifrado con Fernet. NULL = no conectado (o se revocó). Nunca se devuelve al frontend.';
COMMENT ON COLUMN google_calendar_links.calendar_id IS
  'ID del calendario secundario que la app creó en la cuenta del usuario (scope calendar.app.created).';

ALTER TABLE google_calendar_links ENABLE ROW LEVEL SECURITY;
