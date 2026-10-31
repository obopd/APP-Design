-- Planner: one row per user holding their whole planner as JSON.
-- Run once in Supabase → SQL Editor → New query → paste → Run.

create table if not exists public.planner_data (
  user_id    uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security: each user can only see and change their own row.
alter table public.planner_data enable row level security;

drop policy if exists "own row: select" on public.planner_data;
drop policy if exists "own row: insert" on public.planner_data;
drop policy if exists "own row: update" on public.planner_data;
drop policy if exists "own row: delete" on public.planner_data;

create policy "own row: select" on public.planner_data for select using (auth.uid() = user_id);
create policy "own row: insert" on public.planner_data for insert with check (auth.uid() = user_id);
create policy "own row: update" on public.planner_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own row: delete" on public.planner_data for delete using (auth.uid() = user_id);
