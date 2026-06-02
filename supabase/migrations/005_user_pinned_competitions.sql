-- Per-user pinned competitions for the Games dropdown selector.
-- Cross-device persistence; RLS scopes every row to its owner.

create table if not exists public.user_pinned_competitions (
  user_id uuid not null references auth.users(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (user_id, competition_id)
);

create index if not exists user_pinned_competitions_user_idx
  on public.user_pinned_competitions (user_id);

alter table public.user_pinned_competitions enable row level security;

drop policy if exists "own pins read"   on public.user_pinned_competitions;
drop policy if exists "own pins insert" on public.user_pinned_competitions;
drop policy if exists "own pins delete" on public.user_pinned_competitions;

create policy "own pins read"
  on public.user_pinned_competitions
  for select
  using (auth.uid() = user_id);

create policy "own pins insert"
  on public.user_pinned_competitions
  for insert
  with check (auth.uid() = user_id);

create policy "own pins delete"
  on public.user_pinned_competitions
  for delete
  using (auth.uid() = user_id);

comment on table public.user_pinned_competitions is
  'Per-user pinned competitions for the Games selector dropdown. RLS-scoped to owner.';
