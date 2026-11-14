-- Planner: Study mode (Anki-style flashcards).
-- Run once in Supabase → SQL Editor, after setup.sql. Safe to run again.
--
-- study_items    decks, deck option presets, note types, notes and cards (one row each)
-- study_reviews  every answer given (Again / Hard / Good / Easy): stats and card history
--
-- Private to each account: only the owner can read or write their rows.
-- updated_at / synced_at are set by the server on every write; the app uses them to
-- download only what changed since it last looked.

create table if not exists public.study_items (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null check (char_length(id) between 1 and 64),
  kind       text not null check (kind in ('deck', 'preset', 'notetype', 'note', 'card')),
  data       jsonb not null default '{}'::jsonb,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint study_items_size check (pg_column_size(data) < 262144)
);
create index if not exists study_items_changed on public.study_items (user_id, updated_at);

create table if not exists public.study_reviews (
  user_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id        text not null check (char_length(id) between 1 and 64),
  card_id   text not null,
  data      jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint study_reviews_size check (pg_column_size(data) < 4096)
);
create index if not exists study_reviews_changed on public.study_reviews (user_id, synced_at);

-- The server's clock, not the phone's, decides what counts as "changed since".
create or replace function public.study_touch() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'study_items' then new.updated_at := clock_timestamp();
  else new.synced_at := clock_timestamp(); end if;
  new.user_id := auth.uid();
  return new;
end $$;
drop trigger if exists study_items_touch on public.study_items;
create trigger study_items_touch before insert or update on public.study_items
  for each row execute function public.study_touch();
drop trigger if exists study_reviews_touch on public.study_reviews;
create trigger study_reviews_touch before insert or update on public.study_reviews
  for each row execute function public.study_touch();

alter table public.study_items enable row level security;
alter table public.study_reviews enable row level security;

drop policy if exists "own study items" on public.study_items;
create policy "own study items" on public.study_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own study reviews" on public.study_reviews;
create policy "own study reviews" on public.study_reviews for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.study_items, public.study_reviews from anon;
grant select, insert, update, delete on public.study_items, public.study_reviews to authenticated;

-- Deleted items are kept as small markers so other devices learn about the delete;
-- after 90 days every device has seen them, so they're cleared out nightly.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'study-tombstones';
    perform cron.schedule('study-tombstones', '17 4 * * *',
      $q$delete from public.study_items where deleted and updated_at < now() - interval '90 days'$q$);
  end if;
end $$;
