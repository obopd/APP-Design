-- Planner: push notifications. Run once in Supabase → SQL Editor, after film.sql
-- (it adds triggers to the chat, friends and film tables). Safe to run again.
--
-- Needs the Edge Function "push" (supabase/functions/push/index.ts) and two Vault secrets,
-- created once (not stored in this file):
--   select vault.create_secret('https://<project>.supabase.co/functions/v1/push', 'push_url');
--   select vault.create_secret('<random text>', 'push_secret');   -- same as the function's PUSH_SECRET
--
-- push_subscriptions  one row per phone that allowed notifications (Web Push endpoint + keys)
-- push_alerts         upcoming schedule alerts, uploaded by the app; sent when due, then deleted

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

create table if not exists public.push_alerts (
  id      bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fire_at timestamptz not null,
  title   text not null check (char_length(title) <= 200),
  body    text not null default '' check (char_length(body) <= 300),
  tag     text not null,
  unique (user_id, tag)
);
create index if not exists push_alerts_due on public.push_alerts (fire_at);

alter table public.push_subscriptions enable row level security;
alter table public.push_alerts        enable row level security;
revoke all on public.push_subscriptions, public.push_alerts from anon;
revoke update on public.push_subscriptions, public.push_alerts from authenticated;

drop policy if exists "subs: see own" on public.push_subscriptions;
drop policy if exists "subs: remove own" on public.push_subscriptions;
create policy "subs: see own" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "subs: remove own" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

drop policy if exists "alerts: see own" on public.push_alerts;
drop policy if exists "alerts: add own" on public.push_alerts;
drop policy if exists "alerts: remove own" on public.push_alerts;
create policy "alerts: see own" on public.push_alerts for select to authenticated using (user_id = auth.uid());
create policy "alerts: add own" on public.push_alerts for insert to authenticated with check (user_id = auth.uid());
create policy "alerts: remove own" on public.push_alerts for delete to authenticated using (user_id = auth.uid());

-- A phone's endpoint belongs to whoever signed in on it last (it moves to the new account).
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_endpoint !~ '^https://' then raise exception 'bad endpoint'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;

-- The app replaces all of its upcoming alerts at once (one transaction).
create or replace function public.replace_push_alerts(p_alerts jsonb) returns void
  language plpgsql security invoker set search_path = public as $$
begin
  delete from push_alerts where user_id = auth.uid();
  insert into push_alerts (user_id, fire_at, title, body, tag)
    select auth.uid(), (a->>'fire_at')::timestamptz, left(a->>'title', 200), left(coalesce(a->>'body', ''), 300), a->>'tag'
    from jsonb_array_elements(p_alerts) a
    where (a->>'fire_at')::timestamptz > now()
    limit 200
  on conflict (user_id, tag) do nothing;
end $$;

grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.replace_push_alerts(jsonb) to authenticated;

/* ---------- Sending (server only) ---------- */

-- Calls the Edge Function. Not callable by app users (only triggers and the timer use it).
create or replace function public.push_call(payload jsonb) returns void
  language plpgsql security definer set search_path = public as $$
declare url text; secret text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'push_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_secret';
  if url is null or secret is null then return; end if; -- not set up: skip quietly
  perform net.http_post(url := url, body := payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret));
end $$;

create or replace function public.push_to(users uuid[], title text, body text, tag text, target text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if users is null or cardinality(users) = 0 then return; end if;
  -- Only people with a phone signed up for notifications.
  if not exists (select 1 from push_subscriptions where user_id = any(users)) then return; end if;
  perform push_call(jsonb_build_object('users', to_jsonb(users), 'title', left(title, 120), 'body', left(body, 300), 'tag', tag, 'view', target));
end $$;

create or replace function public.push_name(u uuid) returns text
  language sql stable security definer set search_path = public as
  $$ select coalesce((select coalesce(nullif(nickname, ''), '@' || handle) from profiles where user_id = u), 'Someone') $$;

revoke execute on function public.push_call(jsonb) from public, anon, authenticated;
revoke execute on function public.push_to(uuid[], text, text, text, text) from public, anon, authenticated;
revoke execute on function public.push_name(uuid) from public, anon, authenticated;

-- Chat messages → the other members.
create or replace function public.push_on_message() returns trigger
  language plpgsql security definer set search_path = public as $$
declare c record; who text; others uuid[];
begin
  select * into c from chats where id = new.chat_id;
  who := push_name(new.sender);
  select array_agg(user_id) into others from chat_members where chat_id = new.chat_id and user_id <> new.sender;
  if c.kind = 'group' then
    perform push_to(others, coalesce(nullif(c.name, ''), 'Group chat'), who || ': ' || new.body, 'chat-' || new.chat_id, 'chat');
  else
    perform push_to(others, who, new.body, 'chat-' || new.chat_id, 'chat');
  end if;
  return new;
exception when others then return new; -- a notification problem must never block the message
end $$;
drop trigger if exists push_on_message on public.messages;
create trigger push_on_message after insert on public.messages for each row execute function public.push_on_message();

-- Friend requests and accepted requests.
create or replace function public.push_on_friendship() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform push_to(array[new.addressee], 'Friend request', push_name(new.requester) || ' wants to be friends.', 'friend-' || new.id, 'bell');
  elsif new.status = 'accepted' and old.status <> 'accepted' then
    perform push_to(array[new.requester], 'New friend', push_name(new.addressee) || ' accepted your request.', 'friend-' || new.id, 'bell');
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists push_on_friendship on public.friendships;
create trigger push_on_friendship after insert or update of status on public.friendships for each row execute function public.push_on_friendship();

-- Shared to-dos / events / folders (first time only, not every re-publish).
create or replace function public.push_on_share() returns trigger
  language plpgsql security definer set search_path = public as $$
declare what text;
begin
  what := coalesce(nullif(new.data->>'title', ''), nullif(new.data->>'name', ''), 'something');
  perform push_to(array[new.friend], 'Shared with you', push_name(new.owner) || ' shared “' || what || '”.', 'share-' || new.id, 'calendar');
  return new;
exception when others then return new;
end $$;
drop trigger if exists push_on_share on public.shares;
create trigger push_on_share after insert on public.shares for each row execute function public.push_on_share();

-- Added to a film project.
create or replace function public.push_on_member() returns trigger
  language plpgsql security definer set search_path = public as $$
declare pname text;
begin
  if new.user_id = new.added_by then return new; end if;
  select name into pname from projects where id = new.project_id;
  perform push_to(array[new.user_id], 'Film project', push_name(new.added_by) || ' added you to “' || coalesce(pname, 'a project') || '”.', 'project-' || new.project_id, 'bell');
  return new;
exception when others then return new;
end $$;
drop trigger if exists push_on_member on public.project_members;
create trigger push_on_member after insert on public.project_members for each row execute function public.push_on_member();

-- Schedule alerts: every minute, if any are due, the function sends and deletes them.
create or replace function public.push_due_alerts() returns void
  language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from push_alerts where fire_at <= now()) then
    perform push_call(jsonb_build_object('alerts', true));
  end if;
end $$;
revoke execute on function public.push_due_alerts() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'planner-push-alerts';
select cron.schedule('planner-push-alerts', '* * * * *', 'select public.push_due_alerts()');
