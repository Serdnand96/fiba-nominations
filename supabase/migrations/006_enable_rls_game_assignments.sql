-- Close the open access on game_assignments.
-- Backend (api/_lib/routers/games.py) uses service_role, which bypasses RLS,
-- so no policies are needed. Frontend never reads this table directly.
-- Matches the access pattern of game_schedule, td_availability, training_*, transport_*.

alter table public.game_assignments enable row level security;

comment on table public.game_assignments is
  'Per-game (TD / VGO) assignments. Accessed only via FastAPI backend with service_role. RLS is enabled with no policies so anon/authenticated roles cannot bypass the backend.';
