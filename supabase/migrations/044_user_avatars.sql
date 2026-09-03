-- Avatar de usuario: la foto de perfil de quien usa la plataforma.
--
-- Va en `user_profiles`, que hasta ahora solo cargaba el flag `is_superadmin`
-- y por eso tenía una fila por superadmin y ninguna para el resto. Desde acá
-- cualquier usuario puede tener su fila (creada al subir la foto), con
-- `is_superadmin` en su default `false`: subir un avatar no toca el flag.
--
-- La imagen vive en el bucket público `inventory` bajo `avatars/<user_id>.<ext>`,
-- igual que las fotos de personnel y las del muro. `avatar_url` guarda la URL
-- pública completa con un `?v=<timestamp>` para que el navegador no muestre la
-- foto anterior cuando el usuario la cambia (la key es siempre la misma).
--
-- La foto la sube y la borra SOLO su dueño, desde /api/me/avatar
-- (api/_lib/routers/profile.py). El resto la lee: el sidebar, el muro (autor de
-- posts y comentarios) y la lista de Usuarios.
--
-- Aplicar a mano contra Supabase ANTES de pushear el código que la usa.

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS avatar_url text;
