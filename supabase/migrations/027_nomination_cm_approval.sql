-- Aprobación del Competition Manager sobre cada nominación.
--
-- Checkbox en el módulo Nominations: un usuario con can_edit del módulo marca la
-- nominación como aprobada por el Competition Manager y la fila se pinta de verde.
-- "Competition Manager" es un rol de negocio, no una entidad del sistema: el gate
-- es el mismo require_edit("nominations") del resto de las mutaciones del módulo.
--
-- cm_approved_by guarda el auth.users.id del que aprobó, sin FK — mismo patrón que
-- payments.created_by / competition_reports.created_by. Al desmarcar, se limpian
-- cm_approved_at / cm_approved_by. El sync de nominaciones (games.py) no toca estas
-- columnas: hace upsert por personnel_id y solo escribe sus propios campos.

ALTER TABLE nominations
    ADD COLUMN IF NOT EXISTS cm_approved boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS cm_approved_at timestamptz,
    ADD COLUMN IF NOT EXISTS cm_approved_by uuid;
