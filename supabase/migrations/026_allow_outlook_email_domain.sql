-- Agrega outlook.com a la allow-list de dominios de email de auth.users.
--
-- Contexto: enforce_email_domain() es un trigger BEFORE INSERT sobre auth.users que
-- rechaza cualquier email cuyo dominio no esté en la lista. Se aplicó directo sobre
-- Supabase durante el pen-test y nunca había quedado versionado acá; esta migración
-- lo captura entero (CREATE OR REPLACE) para que el repo sea la fuente de verdad.
--
-- ⚠️ El signup público de Supabase Auth está habilitado, así que esta allow-list es
-- el único control que impide auto-registros desde internet. Con outlook.com adentro,
-- cualquier persona con una casilla @outlook.com puede crearse una cuenta vía
-- /auth/v1/signup. Queda sin permisos (user_permissions se siembra en false y
-- require_view niega por defecto), pero con cuenta y JWT válidos. Decisión tomada
-- 2026-07-28. La mitigación pendiente es apagar el signup público en el dashboard
-- de Supabase — la app no tiene UI de registro, los usuarios los crea un superadmin.

create or replace function public.enforce_email_domain()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  allowed_domains text[] := ARRAY[
    'fiba.basketball',
    'fibaamericas.com',
    'fibaamericascloud.com',
    'fibaapp.com',
    '96kronos.com',
    'quality.media',
    'tbd.fiba.com',
    'outlook.com'
  ];
  domain text;
BEGIN
  domain := lower(split_part(NEW.email, '@', 2));
  IF NOT (domain = ANY(allowed_domains)) THEN
    RAISE EXCEPTION 'Email domain "%" not allowed. Contact an admin to be added.', domain
      USING ERRCODE = '23514';  -- check_violation -> el API lo mapea a 400
  END IF;
  RETURN NEW;
END;
$function$;

-- Mantiene el lockdown de la migración 007 (CREATE OR REPLACE no resetea los grants,
-- pero lo repetimos para que aplicar esta migración de cero deje el mismo estado).
revoke execute on function public.enforce_email_domain() from public;
revoke execute on function public.enforce_email_domain() from anon;
revoke execute on function public.enforce_email_domain() from authenticated;
