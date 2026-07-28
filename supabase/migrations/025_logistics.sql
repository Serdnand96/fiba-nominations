-- 025: El módulo Transporte pasa a ser Logística.
--
-- Transporte deja de ser un módulo en sí mismo y pasa a ser una de las tres
-- secciones de Logística, junto con Hospedaje (hoteles / rooming list /
-- alimentación) y Travel Manifest (llegadas y salidas).
--
-- La columna vertebral es logistics_participants: el padrón de quién viene a
-- una competencia. Hoy la misma persona vive en tres planillas de Excel
-- escrita de tres formas distintas ("SCHAER, GABRIELA" / "Gabriela Schaer" /
-- "GABRIELA SCHAER"); una sola fila por persona y competencia arregla eso y
-- las tres secciones cuelgan de ahí.
--
-- Todas las tablas nuevas son backend-only vía service_role: RLS habilitado
-- sin políticas, mismo patrón que availability_links (017) y payments (012).


-- ── El permiso se renombra, no se recrea ────────────────────────────────────
-- Un INSERT/DELETE haría perder los grants existentes. Un UPDATE conserva
-- can_view / can_edit de cada usuario tal cual estaban en Transporte.
--
-- Antes hay que abrir el CHECK de user_permissions.module, que había quedado
-- congelado en la lista de módulos de la migración 001. De paso se agregan
-- payments, reports, evaluations y activity: los tres primeros ya figuran en
-- MODULES de src/pages/Users.jsx, así que hasta hoy asignarlos fallaba contra
-- esta misma constraint.
-- Orden: soltar la constraint, renombrar, recién ahí volver a ponerla. Al
-- revés, las filas 'transport' que todavía no se renombraron violan el CHECK
-- nuevo y el ALTER falla.
ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_module_check;

UPDATE user_permissions SET module = 'logistics' WHERE module = 'transport';

ALTER TABLE user_permissions
  ADD CONSTRAINT user_permissions_module_check CHECK (module IN (
    'calendar', 'nominations', 'personnel', 'competitions', 'templates',
    'users', 'logistics', 'availability', 'training', 'games', 'assets',
    'loans', 'employees', 'payments', 'reports', 'evaluations'
  ));


-- ── Padrón de participantes ─────────────────────────────────────────────────
-- personnel_id y employee_id son ambos opcionales a propósito: el manifest
-- mezcla TDs y árbitros (personnel) con staff FIBA (employees) y con VIPs que
-- no están en ninguna de las dos tablas. El vínculo enriquece la fila, no la
-- condiciona.
CREATE TABLE logistics_participants (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id       uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    personnel_id         uuid REFERENCES personnel(id) ON DELETE SET NULL,
    employee_id          uuid REFERENCES employees(id) ON DELETE SET NULL,
    first_name           text NOT NULL,
    last_name            text,
    -- Rol tal como lo escribe la organización ("Technical Delegate",
    -- "FIBA COMMS", "VIP PTE CONSUBASKET"). No usa el CHECK de personnel.role
    -- porque acá entran cargos que el sistema no nomina.
    role                 text,
    category             text NOT NULL DEFAULT 'official'
                         CHECK (category IN ('official', 'fiba_staff', 'vip', 'team', 'guest')),
    passport             text,
    nationality          text,
    phone                text,
    email                text,
    dietary_restrictions text,
    -- Los grupos (hoja "Teams" del manifest) son una fila con headcount:
    -- "Barbados", 17 pax. Las personas quedan en 1.
    pax                  integer NOT NULL DEFAULT 1 CHECK (pax >= 1),
    notes                text,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_logistics_participants_competition ON logistics_participants(competition_id);
CREATE INDEX idx_logistics_participants_personnel ON logistics_participants(personnel_id);

ALTER TABLE logistics_participants ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE logistics_participants IS
  'Padrón de participantes de una competencia (oficiales, staff FIBA, VIPs, delegaciones). Columna vertebral del módulo Logística: manifest, rooming y transporte cuelgan de acá. Accedido solo por el backend FastAPI con service_role.';


-- ── Travel manifest: un tramo por fila ──────────────────────────────────────
-- Sin UNIQUE(participant_id, direction): hay gente con escalas, y el importador
-- reemplaza los tramos de los participantes que toca en vez de hacer upsert.
CREATE TABLE logistics_travel_legs (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id uuid NOT NULL REFERENCES logistics_participants(id) ON DELETE CASCADE,
    direction      text NOT NULL CHECK (direction IN ('arrival', 'departure')),
    date           date,
    -- Hora de llegada, o del vuelo de salida.
    time           time,
    -- Retiro del hotel (columna "PICK UP TIME" del manifest de salidas).
    pickup_time    time,
    flight_number  text,
    carrier        text,
    -- "EZE", "AEP", pero también "Puerto de Bs As" o "TERMINAL DE BUS ZARATE".
    airport        text,
    transport_mode text NOT NULL DEFAULT 'flight'
                   CHECK (transport_mode IN ('flight', 'bus', 'ferry', 'car', 'other')),
    comments       text,
    -- Qué traslado cubre este tramo, cuando ya se armó.
    trip_id        uuid REFERENCES transport_trips(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_logistics_travel_legs_participant ON logistics_travel_legs(participant_id);
CREATE INDEX idx_logistics_travel_legs_date ON logistics_travel_legs(date);

ALTER TABLE logistics_travel_legs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE logistics_travel_legs IS
  'Tramos de llegada y salida del Travel Manifest. Accedido solo por el backend FastAPI con service_role.';


-- ── Hoteles ─────────────────────────────────────────────────────────────────
CREATE TABLE logistics_hotels (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    name           text NOT NULL,
    address        text,
    phone          text,
    email          text,
    check_in_time  time,
    check_out_time time,
    map_url        text,
    notes          text,
    is_primary     boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_logistics_hotels_competition ON logistics_hotels(competition_id);

ALTER TABLE logistics_hotels ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE logistics_hotels IS
  'Hoteles de una competencia. Accedido solo por el backend FastAPI con service_role.';


-- ── Rooming list ────────────────────────────────────────────────────────────
-- Las noches se derivan de check_in / check_out; la grilla del Excel (una
-- columna por fecha con 1 / OUT y un TOTAL) es una vista que se renderiza, no
-- un dato que se guarda día por día.
CREATE TABLE logistics_stays (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id uuid NOT NULL REFERENCES logistics_participants(id) ON DELETE CASCADE,
    hotel_id       uuid REFERENCES logistics_hotels(id) ON DELETE SET NULL,
    room_type      text,
    room_number    text,
    check_in       date,
    check_out      date,
    -- Con quién comparte habitación: las celdas "Room" combinadas del Excel
    -- (una "Double" que abarca dos filas) se vuelven este vínculo.
    share_with_id  uuid REFERENCES logistics_participants(id) ON DELETE SET NULL,
    comments       text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT logistics_stays_dates_check CHECK (check_out IS NULL OR check_in IS NULL OR check_out >= check_in)
);

CREATE INDEX idx_logistics_stays_participant ON logistics_stays(participant_id);
CREATE INDEX idx_logistics_stays_hotel ON logistics_stays(hotel_id);

ALTER TABLE logistics_stays ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE logistics_stays IS
  'Rooming list: estadía de un participante en un hotel. Las noches se derivan de check_in/check_out. Accedido solo por el backend FastAPI con service_role.';


-- ── Alimentación ────────────────────────────────────────────────────────────
-- date NULL = la comida se sirve todos los días de la competencia, que es el
-- caso normal (desayuno de 07:00 a 10:00 en el hotel). Una fila con fecha
-- pisa a la genérica de ese día.
CREATE TABLE logistics_meals (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    hotel_id       uuid REFERENCES logistics_hotels(id) ON DELETE SET NULL,
    date           date,
    meal           text NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
    start_time     time,
    end_time       time,
    location       text,
    notes          text,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_logistics_meals_competition ON logistics_meals(competition_id);

ALTER TABLE logistics_meals ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE logistics_meals IS
  'Plan de comidas de una competencia. date NULL = todos los días. Accedido solo por el backend FastAPI con service_role.';


-- ── Link público ────────────────────────────────────────────────────────────
-- Uno por competencia. El token es el único credencial: quien lo tiene ve el
-- cronograma completo. Rotarlo invalida el link ya compartido; enabled=false
-- lo apaga sin perder el historial.
CREATE TABLE logistics_public_links (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL UNIQUE REFERENCES competitions(id) ON DELETE CASCADE,
    token          text NOT NULL UNIQUE,
    enabled        boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    rotated_at     timestamptz
);

ALTER TABLE logistics_public_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE logistics_public_links IS
  'Link público de logística por competencia. El token es un secreto: rotarlo invalida el link compartido. Accedido solo por el backend FastAPI con service_role.';


-- ── transport_passengers queda absorbida por el padrón ──────────────────────
-- Se copian las filas existentes en vez de dropear la tabla: si algo del
-- mapeo sale mal, el dato original sigue estando.
INSERT INTO logistics_participants (competition_id, first_name, role, category, notes)
SELECT e.competition_id,
       p.name,
       p.category,
       'official',
       CASE WHEN p.hotel IS NOT NULL AND p.hotel <> '' THEN 'Hotel: ' || p.hotel END
FROM transport_passengers p
JOIN transport_events e ON e.id = p.event_id
WHERE e.competition_id IS NOT NULL;

COMMENT ON TABLE transport_passengers IS
  'DEPRECADA (migración 025): los pasajeros viven ahora en logistics_participants. Se conserva solo por si hace falta revisar el dato original.';
