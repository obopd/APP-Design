-- Planner: upkeep. Run once in Supabase → SQL Editor, after push.sql. Safe to run again.
--
-- planner_backups   a weekly copy of each planner (last 5 kept); restored from Settings
-- ping()            a tiny query the GitHub keep-awake job calls so the free project never pauses
-- chat clean-up     messages older than a year are deleted every night
-- instant chat      new / deleted messages are announced over Supabase Realtime

create extension if not exists pg_cron;

/* ---------- Weekly backups ---------- */

create table if not exists public.planner_backups (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users (id) on delete cascade,
  taken_at timestamptz not null default now(),
  data     jsonb not null
);
create index if not exists planner_backups_user on public.planner_backups (user_id, taken_at desc);

alter table public.planner_backups enable row level security;
revoke all on public.planner_backups from anon;
revoke insert, update, delete on public.planner_backups from authenticated;
drop policy if exists "backups: see own" on public.planner_backups;
create policy "backups: see own" on public.planner_backups for select to authenticated using (user_id = auth.uid());

-- Runs daily: copies a planner if its newest backup is about a week old (and it changed),
-- then keeps only the 5 newest per person.
create or replace function public.planner_backup_run() returns void
  language plpgsql security definer set search_path = public as $$
begin
  insert into planner_backups (user_id, data)
  select d.user_id, d.data from planner_data d
  where not exists (select 1 from planner_backups b where b.user_id = d.user_id and b.taken_at > now() - interval '6 days 20 hours')
    and not exists (select 1 from planner_backups b where b.user_id = d.user_id
      and b.id = (select max(id) from planner_backups x where x.user_id = d.user_id) and b.data = d.data);
  delete from planner_backups where id in (
    select id from (select id, row_number() over (partition by user_id order by taken_at desc) n from planner_backups) r where n > 5);
end $$;
revoke execute on function public.planner_backup_run() from public, anon, authenticated;

/* ---------- Keep the free project awake ---------- */

create or replace function public.ping() returns text language sql stable as $$ select 'ok'::text $$;
grant execute on function public.ping() to anon, authenticated;

/* ---------- Chat clean-up ---------- */

create or replace function public.chat_cleanup_run() returns void
  language sql security definer set search_path = public as
  $$ delete from messages where created_at < now() - interval '1 year' $$;
revoke execute on function public.chat_cleanup_run() from public, anon, authenticated;

/* ---------- Timers ---------- */

select cron.unschedule(jobid) from cron.job where jobname in ('planner-backups', 'planner-chat-cleanup');
select cron.schedule('planner-backups', '23 4 * * *', 'select public.planner_backup_run()');
select cron.schedule('planner-chat-cleanup', '41 4 * * *', 'select public.chat_cleanup_run()');

/* ---------- Instant chat (Realtime) ---------- */
-- Members get a nudge when a message is added or deleted; the app then fetches as usual.
-- Realtime applies the messages table's RLS, so only members of a chat hear about it.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
