-- Planner: chat (personal + group). Run once in Supabase → SQL Editor, after social.sql.
-- Safe to run again.
--
-- chats          one row per conversation ('direct' = 2 people, 'group' = named, any size)
-- chat_members   who is in each chat + the last message id they've read
-- messages       text messages (1–1000 characters); senders can delete their own

create table if not exists public.chats (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('direct', 'group')),
  name       text check (char_length(name) <= 60),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_at    timestamptz not null default now()
);

create table if not exists public.chat_members (
  chat_id   uuid not null references public.chats (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  last_read bigint not null default 0,
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  chat_id    uuid not null references public.chats (id) on delete cascade,
  sender     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists messages_chat_id on public.messages (chat_id, id);

-- Membership checks run with the table owner's rights so policies on chat_members
-- don't have to read chat_members through themselves.
create or replace function public.is_chat_member(c uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from chat_members where chat_id = c and user_id = auth.uid()) $$;
create or replace function public.chat_size(c uuid) returns integer
  language sql stable security definer set search_path = public as
  $$ select count(*)::int from chat_members where chat_id = c and public.is_chat_member(c) $$;

-- New message → bump the chat's last_at (members can't write chats themselves).
create or replace function public.touch_chat() returns trigger
  language plpgsql security definer set search_path = public as
  $$ begin update chats set last_at = new.created_at where id = new.chat_id; return new; end $$;
drop trigger if exists messages_touch_chat on public.messages;
create trigger messages_touch_chat after insert on public.messages for each row execute function public.touch_chat();

alter table public.chats        enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages     enable row level security;

revoke all on public.chats, public.chat_members, public.messages from anon;
revoke update on public.chats, public.chat_members, public.messages from authenticated;
grant update (name) on public.chats to authenticated;
grant update (last_read) on public.chat_members to authenticated;

drop policy if exists "chats: see" on public.chats;
drop policy if exists "chats: create" on public.chats;
drop policy if exists "chats: rename" on public.chats;
drop policy if exists "chats: delete" on public.chats;
create policy "chats: see" on public.chats for select to authenticated
  using (public.is_chat_member(id) or created_by = auth.uid());
create policy "chats: create" on public.chats for insert to authenticated
  with check (created_by = auth.uid());
create policy "chats: rename" on public.chats for update to authenticated
  using (kind = 'group' and public.is_chat_member(id)) with check (kind = 'group' and public.is_chat_member(id));
create policy "chats: delete" on public.chats for delete to authenticated
  using (created_by = auth.uid());

-- Joining: the creator adds themself; then the creator or a member can add their own
-- accepted friends (a direct chat never gets more than 2 people).
drop policy if exists "members: see" on public.chat_members;
drop policy if exists "members: add" on public.chat_members;
drop policy if exists "members: read mark" on public.chat_members;
drop policy if exists "members: leave or remove" on public.chat_members;
create policy "members: see" on public.chat_members for select to authenticated
  using (public.is_chat_member(chat_id));
create policy "members: add" on public.chat_members for insert to authenticated with check (
  (user_id = auth.uid() and exists (select 1 from public.chats c where c.id = chat_id and c.created_by = auth.uid()))
  or (
    (public.is_chat_member(chat_id) or exists (select 1 from public.chats c where c.id = chat_id and c.created_by = auth.uid()))
    and exists (select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester = auth.uid() and f.addressee = user_id) or (f.requester = user_id and f.addressee = auth.uid())))
    and exists (select 1 from public.chats c where c.id = chat_id and (c.kind = 'group' or public.chat_size(chat_id) < 2))
  ));
create policy "members: read mark" on public.chat_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members: leave or remove" on public.chat_members for delete to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.chats c where c.id = chat_id and c.kind = 'group' and c.created_by = auth.uid()));

drop policy if exists "messages: read" on public.messages;
drop policy if exists "messages: send" on public.messages;
drop policy if exists "messages: delete own" on public.messages;
create policy "messages: read" on public.messages for select to authenticated
  using (public.is_chat_member(chat_id));
create policy "messages: send" on public.messages for insert to authenticated
  with check (sender = auth.uid() and public.is_chat_member(chat_id));
create policy "messages: delete own" on public.messages for delete to authenticated
  using (sender = auth.uid());
