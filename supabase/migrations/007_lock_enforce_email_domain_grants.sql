-- Restrict EXECUTE on enforce_email_domain() so anon / authenticated cannot call
-- it via /rest/v1/rpc/enforce_email_domain. The function is only used as a trigger
-- on auth.users (signup flow) — triggers execute with owner privileges regardless of
-- the calling role's EXECUTE rights, so the signup path is unaffected.
-- Postgres + service_role keep EXECUTE for trigger machinery and ad-hoc admin use.
--
-- is_superadmin() is intentionally left executable by `authenticated` because 29 RLS
-- policies across nominations / personnel / competitions / assets / loans / employees /
-- competition_assignments / user_profiles / user_permissions depend on it. The function
-- takes no input and only returns the caller's own superadmin flag, so the surface
-- area is bounded. The advisor warning on is_superadmin is acknowledged-and-accepted.

revoke execute on function public.enforce_email_domain() from public;
revoke execute on function public.enforce_email_domain() from anon;
revoke execute on function public.enforce_email_domain() from authenticated;
