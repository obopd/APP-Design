-- Planner: Film Production Mode (projects shared with collaborators).
-- Run once in Supabase → SQL Editor, after social.sql and chat.sql. Safe to run again.
--
-- projects          a film project (its group chat lives in chats, linked by chat_id)
-- project_members   owner + invited collaborators (full access to everything in the project)
-- project_items     the project's to-dos, schedule items and folders (one row each)
-- project_docs      Theme (key 'story') / Plot / Script, each editable by one person at a time (lock)

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  owner      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chat_id    uuid references public.chats (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  added_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.project_items (
  project_id uuid not null references public.projects (id) on delete cascade,
  id         text not null,
  kind       text not null check (kind in ('todo', 'event', 'category')),
  data       jsonb not null,
  updated_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create table if not exists public.project_docs (
  project_id uuid not null references public.projects (id) on delete cascade,
  section    text not null check (section in ('story', 'plot', 'script')),
  body       jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  locked_by  uuid references auth.users (id) on delete set null,
  lock_until timestamptz,
  primary key (project_id, section)
);

create or replace function public.is_project_member(p uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from project_members where project_id = p and user_id = auth.uid()) $$;

alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.project_items   enable row level security;
alter table public.project_docs    enable row level security;

revoke all on public.projects, public.project_members, public.project_items, public.project_docs from anon;
revoke update on public.projects, public.project_members, public.project_items, public.project_docs from authenticated;
grant update (name, chat_id) on public.projects to authenticated;
-- (project_id, id too: an upsert "on conflict … do update" sets every column it sends; RLS still checks membership.)
grant update (project_id, id, kind, data, updated_by, updated_at) on public.project_items to authenticated;
grant update (body, updated_by, updated_at, locked_by, lock_until) on public.project_docs to authenticated;

drop policy if exists "projects: see" on public.projects;
drop policy if exists "projects: create" on public.projects;
drop policy if exists "projects: change" on public.projects;
drop policy if exists "projects: delete" on public.projects;
create policy "projects: see" on public.projects for select to authenticated
  using (public.is_project_member(id) or owner = auth.uid());
create policy "projects: create" on public.projects for insert to authenticated
  with check (owner = auth.uid());
create policy "projects: change" on public.projects for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy "projects: delete" on public.projects for delete to authenticated
  using (owner = auth.uid());

-- The owner adds themself, then invites their own accepted friends; anyone can leave,
-- and the owner can remove people.
drop policy if exists "members: see project" on public.project_members;
drop policy if exists "members: invite" on public.project_members;
drop policy if exists "members: leave or remove project" on public.project_members;
create policy "members: see project" on public.project_members for select to authenticated
  using (public.is_project_member(project_id));
create policy "members: invite" on public.project_members for insert to authenticated with check (
  added_by = auth.uid()
  and exists (select 1 from public.projects p where p.id = project_id and p.owner = auth.uid())
  and (user_id = auth.uid() or exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester = auth.uid() and f.addressee = user_id) or (f.requester = user_id and f.addressee = auth.uid())))));
create policy "members: leave or remove project" on public.project_members for delete to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.projects p where p.id = project_id and p.owner = auth.uid()));

drop policy if exists "items: see" on public.project_items;
drop policy if exists "items: add" on public.project_items;
drop policy if exists "items: change" on public.project_items;
drop policy if exists "items: delete" on public.project_items;
create policy "items: see" on public.project_items for select to authenticated using (public.is_project_member(project_id));
create policy "items: add" on public.project_items for insert to authenticated
  with check (public.is_project_member(project_id) and updated_by = auth.uid());
create policy "items: change" on public.project_items for update to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id) and updated_by = auth.uid());
create policy "items: delete" on public.project_items for delete to authenticated using (public.is_project_member(project_id));

-- Writing: members read; editing needs the lock. Taking the lock only works if it's
-- free, already yours, or expired; saving only works while you hold it.
drop policy if exists "docs: see" on public.project_docs;
drop policy if exists "docs: add" on public.project_docs;
drop policy if exists "docs: lock and save" on public.project_docs;
create policy "docs: see" on public.project_docs for select to authenticated using (public.is_project_member(project_id));
create policy "docs: add" on public.project_docs for insert to authenticated with check (public.is_project_member(project_id));
create policy "docs: lock and save" on public.project_docs for update to authenticated
  using (public.is_project_member(project_id) and (locked_by is null or locked_by = auth.uid() or lock_until < now()))
  with check (public.is_project_member(project_id) and (locked_by is null or locked_by = auth.uid()));
