#!/bin/bash
# Starts everything the tests need (cloud session or any Linux box with Postgres + Node):
# Postgres, a fresh test database, the Supabase stand-in on :54321 and the app on :8765.
cd "$(dirname "$0")"
service postgresql start > /dev/null 2>&1 || true
for i in 1 2 3 4 5; do pg_isready -q && break; sleep 1; done
su postgres -c "psql -q -c \"alter user postgres password 'pg'\"" > /dev/null
[ -d node_modules ] || npm install --silent > /dev/null 2>&1
mkdir -p out
./db/reset.sh || exit 1
for p in $(pgrep -f "node .*tests/mock-server.js"); do kill "$p"; done
(setsid nohup node "$PWD/mock-server.js" > out/mock.log 2>&1 &)
if ! curl -s -o /dev/null localhost:8765/; then (cd .. && setsid nohup python3 -m http.server 8765 > /dev/null 2>&1 &); fi
sleep 1
curl -s -o /dev/null -w "mock %{http_code}\n" localhost:54321/auth/v1/logout -X POST
