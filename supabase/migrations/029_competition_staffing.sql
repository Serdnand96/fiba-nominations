-- Staffing Plan: empleados FIBA designados a una competencia.
--
-- "Oswaldo y Sara están en Argentina para el South American Women's
-- Championship". Hasta hoy eso no se podía registrar en ningún lado: el crew
-- (competition_assignments) es de `personnel` — TDs, VGOs, árbitros — y el
-- padrón de logística (logistics_participants, migración 025) es la última
-- milla (hotel, vuelo, comidas), no la planificación.
--
-- Tabla propia y NO una columna employee_id en competition_assignments, a
-- propósito: esa tabla alimenta sync-nominations, las cartas y los fees por
-- rol (api/_lib/crew.py). Un empleado FIBA no se nomina ni cobra window fee;
-- meterlo ahí significaría filtrarlo en cinco lugares y basta olvidarse de uno
-- para emitirle una carta o generarle un pago.
--
-- Backend-only vía service_role: RLS habilitado sin políticas, mismo patrón
-- que payments (012), availability_links (017) y logística (025). El permiso
-- que la gobierna es `games`, el mismo del crew.

CREATE TABLE competition_staffing (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id  uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    -- SET NULL y no CASCADE: employees se borra en soft (active = false), pero
    -- si alguna vez se borra de verdad la designación histórica no desaparece
    -- de la competencia — queda con el nombre congelado en external_name.
    employee_id     uuid REFERENCES employees(id) ON DELETE SET NULL,
    -- Staff temporal o de la organización local que no tiene ficha en
    -- `employees`. También es donde queda el nombre si el empleado se borra.
    external_name   text,
    -- Función EN EL EVENTO, no el cargo interno del empleado: "Competition
    -- Manager", "Media Officer", "Local Organizer". Texto libre por el mismo
    -- motivo que logistics_participants.role — acá entran cargos que el
    -- sistema no nomina y que cambian de evento a evento.
    event_role      text NOT NULL,
    status          text NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned', 'confirmed', 'cancelled')),
    -- Opcionales: cuándo está la persona en el evento. Si quedan en NULL se
    -- asume que cubre toda la competencia.
    start_date      date,
    end_date        date,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- auth.users.id del que la cargó, sin FK — mismo patrón que
    -- payments.created_by y nominations.cm_approved_by.
    created_by      uuid,

    CONSTRAINT competition_staffing_person_check
        CHECK (employee_id IS NOT NULL OR external_name IS NOT NULL)
);

-- Una persona puede tener dos funciones en el mismo evento, pero no la misma
-- dos veces. Los externos no entran acá (employee_id NULL): se deduplican a
-- ojo, son casos sueltos.
CREATE UNIQUE INDEX idx_competition_staffing_unique
    ON competition_staffing(competition_id, employee_id, event_role)
    WHERE employee_id IS NOT NULL;

CREATE INDEX idx_competition_staffing_competition
    ON competition_staffing(competition_id);
CREATE INDEX idx_competition_staffing_employee
    ON competition_staffing(employee_id);

ALTER TABLE competition_staffing ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE competition_staffing IS
    'Staffing plan: empleados FIBA designados a una competencia. Separada de competition_assignments a propósito — estas personas NO se nominan, no generan cartas ni pagos. Permiso `games`. Accedida solo desde FastAPI con service_role.';
