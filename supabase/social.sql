-- Planner: friends & sharing. Run once in Supabase → SQL Editor (after setup.sql).
-- Safe to run again: it only creates what's missing and refreshes the policies.
--
-- profiles      each user's chosen ID (unique, lowercase)
-- friendships   friend requests; the other person accepts (status → 'accepted')
-- shares        a copy of one to-do / event / folder that its owner shares with one friend
-- share_checks  a friend checking a shared to-do off (the owner's app applies it, then deletes it)

create table if not exists public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  handle     text not null unique check (handle ~ '^[a-z0-9_.]{3,20}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id         bigint generated always as identity primary key,
  requester  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  addressee  uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
-- One friendship per pair, whichever way round it was requested.
create unique index if not exists friendships_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

create table if not exists public.shares (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  friend     uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('todo', 'event', 'folder')),
  item_id    text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner, friend, kind, item_id)
);

create table if not exists public.share_checks (
  share_id   uuid not null references public.shares (id) on delete cascade,
  todo_id    text not null,
  day        text not null,
  done       boolean not null,
  by_user    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (share_id, todo_id, day)
);

alter table public.profiles     enable row level security;
alter table public.friendships  enable row level security;
alter table public.shares       enable row level security;
alter table public.share_checks enable row level security;

-- Only these columns can ever be changed after a row is created.
revoke update on public.profiles, public.friendships from anon, authenticated;
grant update (handle) on public.profiles to authenticated;
grant update (status) on public.friendships to authenticated;
revoke all on public.profiles, public.friendships, public.shares, public.share_checks from anon;

drop policy if exists "profiles: look up" on public.profiles;
drop policy if exists "profiles: create own" on public.profiles;
drop policy if exists "profiles: change own" on public.profiles;
create policy "profiles: look up" on public.profiles for select to authenticated using (true);
create policy "profiles: create own" on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy "profiles: change own" on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "friendships: see own" on public.friendships;
drop policy if exists "friendships: request" on public.friendships;
drop policy if exists "friendships: accept" on public.friendships;
drop policy if exists "friendships: remove" on public.friendships;
create policy "friendships: see own" on public.friendships for select to authenticated
  using (auth.uid() in (requester, addressee));
create policy "friendships: request" on public.friendships for insert to authenticated
  with check (requester = auth.uid() and status = 'pending');
create policy "friendships: accept" on public.friendships for update to authenticated
  using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
create policy "friendships: remove" on public.friendships for delete to authenticated
  using (auth.uid() in (requester, addressee));

-- Shares: the owner manages them, and only for accepted friends; the friend can read
-- them while they're still friends.
drop policy if exists "shares: see" on public.shares;
drop policy if exists "shares: add" on public.shares;
drop policy if exists "shares: change" on public.shares;
drop policy if exists "shares: remove" on public.shares;
create policy "shares: see" on public.shares for select to authenticated using (
  owner = auth.uid() or (friend = auth.uid() and exists (
    select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester = owner and f.addressee = friend) or (f.requester = friend and f.addressee = owner)))));
create policy "shares: add" on public.shares for insert to authenticated with check (
  owner = auth.uid() and exists (
    select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester = owner and f.addressee = friend) or (f.requester = friend and f.addressee = owner))));
create policy "shares: change" on public.shares for update to authenticated using (owner = auth.uid()) with check (
  owner = auth.uid() and exists (
    select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester = owner and f.addressee = friend) or (f.requester = friend and f.addressee = owner))));
create policy "shares: remove" on public.shares for delete to authenticated using (owner = auth.uid());

-- Check-offs: written by the friend a share is for; seen and cleared by both sides.
drop policy if exists "checks: see" on public.share_checks;
drop policy if exists "checks: add" on public.share_checks;
drop policy if exists "checks: change" on public.share_checks;
drop policy if exists "checks: remove" on public.share_checks;
create policy "checks: see" on public.share_checks for select to authenticated
  using (exists (select 1 from public.shares s where s.id = share_id));
create policy "checks: add" on public.share_checks for insert to authenticated
  with check (by_user = auth.uid() and exists (select 1 from public.shares s where s.id = share_id and s.friend = auth.uid()));
create policy "checks: change" on public.share_checks for update to authenticated
  using (by_user = auth.uid())
  with check (by_user = auth.uid() and exists (select 1 from public.shares s where s.id = share_id and s.friend = auth.uid()));
create policy "checks: remove" on public.share_checks for delete to authenticated
  using (exists (select 1 from public.shares s where s.id = share_id));
