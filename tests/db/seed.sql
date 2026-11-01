-- Test users a@x, b@x, c@x (password secret1 in the mock): alice is friends with bob and carol.
insert into profiles (user_id, handle) values
  ('00000000-0000-0000-0000-00000000000a', 'alice'), ('00000000-0000-0000-0000-00000000000b', 'bob'), ('00000000-0000-0000-0000-00000000000c', 'carol');
insert into friendships (requester, addressee, status) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'accepted'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'accepted');
-- A direct chat alice ↔ bob.
insert into chats (id, kind, created_by) values ('22222222-2222-2222-2222-222222222222', 'direct', '00000000-0000-0000-0000-00000000000a');
insert into chat_members (chat_id, user_id) values
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000a'), ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b');
-- Stand-in for Supabase Realtime: the mock server LISTENs on 'rt'.
create or replace function public.rt_notify() returns trigger language plpgsql as
  $$ begin perform pg_notify('rt', json_build_object('chat_id', new.chat_id, 'id', new.id)::text); return new; end $$;
create trigger rt_notify after insert on public.messages for each row execute function public.rt_notify();
