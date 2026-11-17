-- 055: Operación de logística — contactos, salones, adicionales de hotel,
-- documentos, y lo que faltaba para separar staff de delegaciones.
--
-- APLICAR A MANO en Supabase ANTES de pushear el código que la usa: el deploy
-- no corre migraciones y los routers pegan contra estas columnas y tablas.
--
-- Sale del pedido de la gerente de eventos (noviembre 2026). Lo que cambia:
--
--   * Hoteles con audiencia. Staff y delegaciones duermen en hoteles distintos
--     y logística necesita verlos por separado. NULL = el hotel es de todos
--     (el caso de una competencia con un solo hotel), así que las filas que ya
--     existen no cambian de comportamiento.
--   * Participantes con equipo. Hasta acá una delegación era UNA fila agregada
--     ("Barbados", pax 18) o personas sueltas con category = 'team' y nada que
--     dijera de qué club eran. La rooming list de equipos trae el club arriba.
--   * Más de un cronograma por (competencia, sección, audiencia). Árbitros y
--     Comunicaciones tienen horarios propios dentro de staff. `label` es el
--     discriminador: '' es el cronograma general, que es lo que ya había.
--   * Choferes "a disposición de" alguien (el TD, un VIP). Texto libre: no es
--     una asignación de viaje, es a quién le responde ese chofer.
--   * Directorio de contactos: responsable del transporte, hoteles, y los
--     proveedores de hielo, lavandería e hidratación con sus horarios de retiro
--     y entrega. Los horarios son texto ("lun a vie 8-10 y 18-20").
--   * Salones: Media Day, charla técnica, PIC y otras reuniones.
--   * Adicionales y cotizaciones de hotel. Es un REGISTRO OPERATIVO: el monto
--     es lo que informó el hotel, no un gasto. NO suma en ningún reporte de
--     Budget; los pagos reales siguen siendo filas de `expenses` y se muestran
--     en Logística en solo lectura (migración 056).
--   * Documentos privados: menús de hotel, pasaportes de delegaciones y el PDF
--     de una cotización. Van al bucket privado `nominations` bajo
--     `logistics/docs/`, igual que el Excel original de los cronogramas.
--
-- Backend-only vía service_role: RLS habilitado sin políticas, igual que el
-- resto de logística (025, 054).

begin;

-- ── Hoteles: audiencia y persona de contacto ────────────────────────────────
ALTER TABLE logistics_hotels
    ADD COLUMN IF NOT EXISTS audience     text
        CHECK (audience IS NULL OR audience IN ('staff', 'delegation', 'vip')),
    ADD COLUMN IF NOT EXISTS contact_name text;

COMMENT ON COLUMN logistics_hotels.audience IS
  'A quién aloja el hotel: staff / delegation / vip. NULL = compartido por todas las audiencias.';


-- ── Participantes: a qué delegación pertenecen ──────────────────────────────
ALTER TABLE logistics_participants
    ADD COLUMN IF NOT EXISTS team text;

COMMENT ON COLUMN logistics_participants.team IS
  'Club o selección de la persona (texto libre, como viene en la rooming list). NULL para staff, VIPs y la fila agregada de una delegación.';


-- ── Cronogramas: varios por (competencia, sección, audiencia) ───────────────
ALTER TABLE logistics_schedules
    ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT '';

ALTER TABLE logistics_schedules
    DROP CONSTRAINT IF EXISTS logistics_schedules_unique;

ALTER TABLE logistics_schedules
    ADD CONSTRAINT logistics_schedules_unique
        UNIQUE (competition_id, section, audience, label);

COMMENT ON COLUMN logistics_schedules.label IS
  'Distingue cronogramas de la misma sección y audiencia ("Árbitros", "Comunicaciones"). Vacío = el cronograma general.';


-- ── Choferes: a disposición de quién ────────────────────────────────────────
ALTER TABLE transport_drivers
    ADD COLUMN IF NOT EXISTS assigned_to text;

COMMENT ON COLUMN transport_drivers.assigned_to IS
  'A disposición de quién está el chofer (TD, VIP, Comunicaciones). Texto libre; NULL = flota general.';


-- ── Directorio de contactos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logistics_contacts (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    kind           text NOT NULL DEFAULT 'other'
        CHECK (kind IN ('transport', 'hotel', 'ice', 'laundry', 'hydration', 'vip', 'other')),
    -- NULL = el contacto sirve a todas las audiencias.
    audience       text CHECK (audience IS NULL OR audience IN ('staff', 'delegation', 'vip')),
    hotel_id       uuid REFERENCES logistics_hotels(id) ON DELETE SET NULL,
    name           text NOT NULL,
    company        text,
    role           text,
    phone          text,
    email          text,
    -- Texto y no time: "lun a vie 8:00-10:00", "después de cada partido".
    pickup_hours   text,
    delivery_hours text,
    notes          text,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logistics_contacts_competition ON logistics_contacts(competition_id);

ALTER TABLE logistics_contacts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE logistics_contacts IS
  'Directorio de contactos de una competencia: transporte, hoteles, proveedores (hielo, lavandería, hidratación) y servicios a VIP. Accedido solo por el backend FastAPI con service_role.';


-- ── Salones ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logistics_rooms (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    hotel_id       uuid REFERENCES logistics_hotels(id) ON DELETE SET NULL,
    name           text NOT NULL,
    purpose        text NOT NULL DEFAULT 'meeting'
        CHECK (purpose IN ('media_day', 'technical_meeting', 'pic', 'meeting', 'other')),
    audience       text CHECK (audience IS NULL OR audience IN ('staff', 'delegation', 'vip')),
    date           date,
    start_time     time,
    end_time       time,
    -- Dónde queda cuando no es en un hotel cargado ("Coliseo, sala de prensa").
    location       text,
    capacity       integer CHECK (capacity IS NULL OR capacity >= 0),
    notes          text,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logistics_rooms_competition ON logistics_rooms(competition_id);

ALTER TABLE logistics_rooms ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE logistics_rooms IS
  'Salones de una competencia: Media Day, charla técnica, PIC y otras reuniones. Accedido solo por el backend FastAPI con service_role.';


-- ── Adicionales y cotizaciones de hotel ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS logistics_hotel_charges (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    hotel_id       uuid NOT NULL REFERENCES logistics_hotels(id) ON DELETE CASCADE,
    kind           text NOT NULL DEFAULT 'extra' CHECK (kind IN ('extra', 'quote')),
    concept        text NOT NULL,
    -- Informativo. NULL mientras el hotel no pasó el número.
    amount         numeric(12, 2) CHECK (amount IS NULL OR amount >= 0),
    currency       text NOT NULL DEFAULT 'USD',
    date           date,
    notes          text,
    created_by     uuid,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logistics_hotel_charges_hotel ON logistics_hotel_charges(hotel_id);
CREATE INDEX IF NOT EXISTS idx_logistics_hotel_charges_competition ON logistics_hotel_charges(competition_id);

ALTER TABLE logistics_hotel_charges ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE logistics_hotel_charges IS
  'Adicionales y cotizaciones de un hotel. Registro operativo: el monto es informativo y NO suma en Budget (los pagos son filas de expenses). Accedido solo por el backend FastAPI con service_role.';


-- ── Documentos privados ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logistics_documents (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    kind           text NOT NULL DEFAULT 'other'
        CHECK (kind IN ('menu', 'passport', 'quote', 'other')),
    hotel_id       uuid REFERENCES logistics_hotels(id) ON DELETE CASCADE,
    participant_id uuid REFERENCES logistics_participants(id) ON DELETE CASCADE,
    charge_id      uuid REFERENCES logistics_hotel_charges(id) ON DELETE CASCADE,
    -- storage://nominations/logistics/docs/… (bucket privado).
    file_path      text NOT NULL,
    file_name      text NOT NULL,
    content_type   text,
    size_bytes     integer,
    uploaded_by    uuid,
    created_at     timestamptz NOT NULL DEFAULT now(),
    -- Un menú es de un hotel y un pasaporte es de una persona: sin ese vínculo
    -- el archivo queda huérfano en la UI.
    CONSTRAINT logistics_documents_owner_check CHECK (
        (kind <> 'menu'     OR hotel_id IS NOT NULL) AND
        (kind <> 'passport' OR participant_id IS NOT NULL) AND
        (kind <> 'quote'    OR charge_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_logistics_documents_competition ON logistics_documents(competition_id);
CREATE INDEX IF NOT EXISTS idx_logistics_documents_hotel ON logistics_documents(hotel_id);
CREATE INDEX IF NOT EXISTS idx_logistics_documents_participant ON logistics_documents(participant_id);
CREATE INDEX IF NOT EXISTS idx_logistics_documents_charge ON logistics_documents(charge_id);

ALTER TABLE logistics_documents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE logistics_documents IS
  'Archivos privados de logística (menús, pasaportes, cotizaciones) en el bucket nominations bajo logistics/docs/. El borrado en cascada NO borra el objeto de Storage: lo hace el backend. Accedido solo por el backend FastAPI con service_role.';

commit;
