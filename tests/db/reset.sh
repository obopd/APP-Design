#!/bin/bash
# Fresh local database "planner" with Supabase stand-ins (tests/db/stub.sql), every SQL file
# from supabase/ in setup order (extensions removed: they're stubbed), then test data.
set -e
cd "$(dirname "$0")/../.."
tmp=$(mktemp -d)
for f in setup social chat film push maintenance; do sed 's/^create extension.*$//' "supabase/$f.sql" > "$tmp/$f.sql"; done
cp tests/db/stub.sql tests/db/seed.sql "$tmp/"
chmod -R a+r "$tmp"; chmod a+x "$tmp"
su postgres -c "psql -q -v ON_ERROR_STOP=1 -f $tmp/stub.sql" > /dev/null
for f in setup social chat film push maintenance seed; do
  su postgres -c "psql -q -d planner -v ON_ERROR_STOP=1 -f $tmp/$f.sql" > /dev/null 2>"$tmp/err" || { grep -v NOTICE "$tmp/err"; exit 1; }
done
rm -rf "$tmp"
echo "database ready"
