#!/bin/bash
# Runs every test on a fresh database. Usage: tests/run-all.sh
cd "$(dirname "$0")"
fail=0
for t in sync.test.js storage.test.js motion.test.js preview.test.js shoot.test.js app-features.test.js push-function.test.mjs; do
  ./start.sh > /dev/null || { echo "setup failed"; exit 1; }
  echo "== $t"
  if [[ $t == *.mjs ]]; then NODE_TLS_REJECT_UNAUTHORIZED=0 node --no-warnings --experimental-strip-types "$t" || fail=1
  else node "$t" || fail=1; fi
done
exit $fail
