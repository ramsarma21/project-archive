#!/bin/zsh
# Start vite, capture the crowd vantages, stop vite — in one shell invocation,
# because backgrounded processes are reaped when the tool call ends.
#
# Runs on its own port so a QA harness already serving 5173 is left alone.
#
# Run: assets/pipeline/shot_m1_crowd.sh [outDir]
set -u
REPO=/Users/ramsarma/Projects/project-archive
PORT=5251
OUT=${1:-/tmp/m1crowd}
VITE_BIN=$REPO/apps/web/node_modules/vite/bin/vite.js

cd $REPO/apps/web
mkdir -p $OUT

lsof -ti tcp:$PORT 2>/dev/null | xargs -r kill -9 2>/dev/null || true
nohup node "$VITE_BIN" --host 127.0.0.1 --port $PORT --strictPort --clearScreen false \
  > $OUT/vite.log 2>&1 &
VITE=$!
disown 2>/dev/null || true
stop_vite() { kill $VITE 2>/dev/null || true; }
trap stop_vite EXIT

for i in $(seq 1 80); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT/ 2>/dev/null || true)
  [[ "$code" == "200" ]] && break
  sleep 0.5
done
echo "vite up on $PORT (pid $VITE)"

node $REPO/assets/pipeline/shot_m1_crowd.mjs "http://127.0.0.1:$PORT" "$OUT"
