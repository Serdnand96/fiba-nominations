-- Control de operación por partido: checklists técnicos de sede.
--
-- El caso que lo origina: el VGO llega a la sede y antes del partido tiene que
-- probar la conexión al reloj, fill & key, el update y la licencia del
-- software, el GFX y la conexión de stats. Hoy eso viaja por WhatsApp y no
-- queda registrado en ningún lado — no hay forma de saber, tres meses después,
-- si el GFX de CHI vs USA se probó y quién lo firmó.
--
-- Cuatro decisiones que conviene no revisar sin leer esto:
--
-- 1. La corrida se engancha al PARTIDO (`game_schedule`), no a la sede ni al
--    día. La trazabilidad que se pidió es por partido: qué se probó antes de
--    ese juego, a qué hora y quién lo firmó.
--
-- 2. Las plantillas son DATOS, no código. Hoy hay una de VGO; mañana habrá una
--    de TD (cancha, mesa, cronómetro), una de médico, una de seguridad. Nada de
--    esto se hardcodea en el backend ni en el front.
--
-- 3. Cada corrida CONGELA los ítems de la plantilla (label, hint, required se
--    copian a game_checklist_items). Editar la plantilla en octubre no puede
--    reescribir lo que se firmó en agosto. Mismo criterio que
--    competition_staffing.external_name: el histórico se guarda por valor.
--
-- 4. La carga puede venir de adentro (usuario con permiso `games`) o de afuera
--    (el VGO desde el celular, con el link por competencia de
--    checklist_public_links). Por eso cada ítem guarda `checked_source`.
--
-- Permiso: `games`, el mismo del crew y del staffing plan. No es una página
-- nueva, es una sección del partido.
--
-- Backend-only vía service_role: RLS habilitado sin políticas, mismo patrón que
-- game_assignments (002), payments (012), logística (025) y staffing (029).


-- ── Plantillas ──────────────────────────────────────────────────────────────

CREATE TABLE checklist_templates (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    -- Rol de `personnel` que la ejecuta. NULL = cualquiera (útil para
    -- checklists de sede que firma quien esté). Mismos códigos que
    -- api/_lib/roles.py.
    role        text CHECK (role IN ('VGO', 'TD', 'REF', 'REF_INSTRUCTOR', 'VIDEO_OPERATOR')),
    description text,
    -- Apagar en vez de borrar: una plantilla retirada deja de ofrecerse en
    -- partidos nuevos pero las corridas viejas siguen leyéndose igual.
    active      boolean NOT NULL DEFAULT true,
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- auth.users.id, sin FK — mismo patrón que payments.created_by.
    created_by  uuid
);

CREATE TABLE checklist_template_items (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id uuid NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
    label       text NOT NULL,
    -- Ayuda opcional: "probar con la señal del OB, no con la de sala".
    hint        text,
    -- Un ítem no requerido puede quedar en 'pending' sin bloquear el cierre.
    required    boolean NOT NULL DEFAULT true,
    sort_order  integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_checklist_template_items_template
    ON checklist_template_items(template_id, sort_order);


-- ── Corridas por partido ────────────────────────────────────────────────────

CREATE TABLE game_checklists (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id       uuid NOT NULL REFERENCES game_schedule(id) ON DELETE CASCADE,
    -- SET NULL y no CASCADE: borrar la plantilla no puede borrar el registro de
    -- lo que se probó. El nombre queda congelado en template_name.
    template_id   uuid REFERENCES checklist_templates(id) ON DELETE SET NULL,
    template_name text NOT NULL,
    role          text,
    -- Quién firma. personnel_id cuando se eligió de la lista; signed_name es el
    -- nombre congelado (y el único dato si la persona no está en `personnel`).
    personnel_id  uuid REFERENCES personnel(id) ON DELETE SET NULL,
    signed_name   text,
    -- Sello de cierre. NULL = la corrida está abierta, aunque tenga ítems
    -- marcados. El estado (pendiente / en curso / cerrada) se deriva al leer;
    -- no hay columna `status` justamente para que no se desincronice.
    submitted_at  timestamptz,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid
);

-- Una corrida por plantilla por partido. Parcial porque template_id puede
-- quedar en NULL si la plantilla se borra, y NULL no colisiona en Postgres.
CREATE UNIQUE INDEX idx_game_checklists_unique
    ON game_checklists(game_id, template_id)
    WHERE template_id IS NOT NULL;

CREATE INDEX idx_game_checklists_game ON game_checklists(game_id);

CREATE TABLE game_checklist_items (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id     uuid NOT NULL REFERENCES game_checklists(id) ON DELETE CASCADE,
    -- Solo para saber de qué ítem de plantilla salió; el texto que vale es el
    -- congelado acá abajo.
    template_item_id uuid REFERENCES checklist_template_items(id) ON DELETE SET NULL,
    label            text NOT NULL,
    hint             text,
    required         boolean NOT NULL DEFAULT true,
    sort_order       integer NOT NULL DEFAULT 0,
    status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'ok', 'fail', 'na')),
    -- El "por qué falló". Es lo único que hace útil un 'fail' tres meses
    -- después.
    notes            text,
    checked_at       timestamptz,
    -- Nombre o email de quien lo marcó, congelado. No hay FK: puede ser un
    -- usuario del sistema o un oficial que entró por el link público.
    checked_by       text,
    checked_source   text CHECK (checked_source IN ('admin', 'self'))
);

CREATE INDEX idx_game_checklist_items_checklist
    ON game_checklist_items(checklist_id, sort_order);


-- ── Link público ────────────────────────────────────────────────────────────
-- Uno por competencia, para que el oficial cargue el checklist desde el celular
-- en la sede sin tener cuenta. El token es el único credencial: rotarlo
-- invalida el link ya compartido, enabled=false lo apaga sin perder historial.
-- Mismo modelo que logistics_public_links (025) y availability_links (017).
--
-- OJO: a diferencia de esos dos, este link ESCRIBE. Lo que expone es acotado a
-- propósito — partidos, sedes y los ítems del checklist; nada de pasaportes,
-- vuelos ni pagos. Si se agregan campos al payload público, revisar eso.
CREATE TABLE checklist_public_links (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL UNIQUE REFERENCES competitions(id) ON DELETE CASCADE,
    token          text NOT NULL UNIQUE,
    enabled        boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    rotated_at     timestamptz
);

ALTER TABLE checklist_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_checklists          ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_checklist_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_public_links   ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE checklist_templates IS
  'Plantillas de checklist operativo por rol. Datos, no código: agregar una no toca el backend. Permiso `games`. Solo backend con service_role.';
COMMENT ON TABLE game_checklists IS
  'Corrida de un checklist en un partido. Congela nombre de plantilla y firmante; el estado se deriva de los ítems, no se guarda. Permiso `games`.';
COMMENT ON TABLE game_checklist_items IS
  'Resultado por ítem (ok/fail/na + nota). El texto del ítem está congelado: editar la plantilla no reescribe lo ya firmado.';
COMMENT ON TABLE checklist_public_links IS
  'Link público por competencia para que el oficial cargue el checklist en la sede. ESCRIBE: rotar el token invalida el link compartido. Solo backend con service_role.';


-- ── Semilla: el checklist de sede del VGO ───────────────────────────────────
-- Es el que motivó la migración. Se carga como dato para que el equipo lo pueda
-- editar desde la UI sin un deploy.
WITH tpl AS (
    INSERT INTO checklist_templates (name, role, description, sort_order)
    VALUES (
        'VGO — Control de sede',
        'VGO',
        'Pruebas técnicas al llegar a la sede, antes del partido.',
        10
    )
    RETURNING id
)
INSERT INTO checklist_template_items (template_id, label, sort_order)
SELECT id, label, sort_order FROM tpl, (VALUES
    ('Conexión a reloj',  10),
    ('Prueba fill & key', 20),
    ('Software update',   30),
    ('Software license',  40),
    ('GFX test',          50),
    ('Stats connection',  60)
) AS s(label, sort_order);
