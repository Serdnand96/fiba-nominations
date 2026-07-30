-- Bloquea a nivel de base el borrado de nominaciones con pago asociado.
--
-- payments.nomination_id nació con ON DELETE CASCADE (migración 012): borrar
-- una nominación se llevaba su pago y los archivos de control financiero en
-- silencio — así se perdieron EP-00001..5 el 2026-07-30 (bulk delete + re-sync
-- para actualizar fees).
--
-- La protección primaria vive en el API (nominations.py responde 409 en el
-- delete individual y reporta blocked[] en el bulk, con mensajes amables).
-- Este trigger es la red final: cierra la ventana entre chequeo y borrado, y
-- cualquier camino que no pase por esos endpoints (SQL directo, o el borrado
-- en cascada al eliminar una competencia entera — que ahora también falla si
-- alguna nominación tiene pago, en vez de perderlo).
--
-- SECURITY DEFINER + search_path fijo: mismo patrón que el resto de las
-- funciones del proyecto (migración harden_security_definer_functions), y
-- necesario porque payments tiene RLS sin policies — con INVOKER un rol sin
-- acceso vería 0 filas y el guard no dispararía.

CREATE OR REPLACE FUNCTION block_nomination_delete_with_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    rec text;
BEGIN
    SELECT record_no INTO rec FROM payments WHERE nomination_id = OLD.id;
    IF rec IS NOT NULL THEN
        RAISE EXCEPTION 'nomination has payment % attached — delete the payment first in the Payments module', rec
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_nomination_delete_with_payment ON nominations;
CREATE TRIGGER trg_block_nomination_delete_with_payment
    BEFORE DELETE ON nominations
    FOR EACH ROW
    EXECUTE FUNCTION block_nomination_delete_with_payment();
