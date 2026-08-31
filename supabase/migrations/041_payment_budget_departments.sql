-- 041_payment_budget_departments.sql — el mapeo budget → departamento es dato.
--
-- La migración 036 backfilleó `payments.department_code` con un CASE escrito a
-- mano, y el write path de `payments.py` terminó repitiendo el mismo CASE en un
-- dict de Python. Dos copias del mismo criterio, y la de Python no sigue al
-- catálogo: alguien agrega un séptimo `payment_budgets` desde la base y sus
-- pagos empiezan a caer en `unallocated_payments` sin que nadie se entere.
--
-- Acá el mapeo pasa a ser una columna del catálogo que ya existe — dato y no
-- código, como los checklists de sede (038). Agregar un budget obliga a decir
-- de qué departamento sale la plata.
--
-- Se deja NULLABLE a propósito: un budget sin mapear tiene que poder existir.
-- Su pago cae sin imputar, el summary lo muestra en ámbar y el backend loguea
-- un warning — eso es visible, que es lo que se busca. Un NOT NULL acá rompería
-- el alta de pagos, que es un módulo que ya funciona.
--
-- NO forma parte del deploy automático: aplica a mano contra Supabase.

begin;

ALTER TABLE payment_budgets
    ADD COLUMN IF NOT EXISTS department_code text
        REFERENCES departments(code) ON UPDATE CASCADE;

-- El mismo mapeo del backfill de la 036, ahora en un solo lugar. `referees` no
-- es 1-a-1: a los árbitros los paga Competitions y el "de dónde sale" pasa a
-- ser la cuenta (COMP-10 fees / COMP-07 travel).
UPDATE payment_budgets SET department_code = CASE code
    WHEN 'comms'          THEN 'comms'
    WHEN 'competitions'   THEN 'competitions'
    WHEN 'administration' THEN 'admin'
    WHEN 'referees'       THEN 'competitions'
    WHEN 'bcla'           THEN 'club_competitions'
    WHEN 'it'             THEN 'it'
END
WHERE department_code IS NULL;

commit;
