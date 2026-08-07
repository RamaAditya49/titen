#!/usr/bin/env bash
# Day-1 pooled lanes, sequential so latency cells never share the box with an
# embedding job. Order: anchor gate -> Titen curve -> control curve -> MemPalace -> MCP n=60.
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
B7=~/titen-bench-20260807
B4=~/titen-bench-20260804

echo "=== ANCHOR START $(date -Is) ==="
# Copy the 08-04 store; the original is never opened.
pkill -f "serve --db $B7/lanes/anchor.db" 2>/dev/null || true
sleep 1
rm -f $B7/lanes/anchor.db*
cp $B4/lanes/titen/fts-500.db $B7/lanes/anchor.db
[ -f $B4/lanes/titen/fts-500.db-wal ] && cp $B4/lanes/titen/fts-500.db-wal $B7/lanes/anchor.db-wal
[ -f $B4/lanes/titen/fts-500.db-shm ] && cp $B4/lanes/titen/fts-500.db-shm $B7/lanes/anchor.db-shm
KEY=$(sed -n "s/^api_key: //p" $B4/logs/titen/fts-500b.log.bootstrap | head -1)
if [ -z "$KEY" ]; then echo "ABORT: no anchor key"; exit 1; fi
unset TITEN_EMBED_BASE_URL TITEN_EMBED_MODEL TITEN_EMBED_DIMS TITEN_EMBED_REVISION
unset TITEN_EMBED_PROFILE TITEN_EMBED_MIN_COSINE TITEN_EMBED_API_KEY TITEN_VEC_DB_PATH
unset TITEN_EXTRACT_BASE_URL TITEN_EXTRACT_MODEL TITEN_EXTRACT_MODEL_FINGERPRINT
unset TITEN_EXTRACT_API_KEY TITEN_EXTRACT_TIMEOUT_MS TITEN_EXTRACT_RESPONSE_MODE
export TITEN_MAINTENANCE_INTERVAL_MS=0
nohup $B7/pkg/node_modules/.bin/titen serve --db $B7/lanes/anchor.db --port 8898 > $B7/logs/anchor.log 2>&1 &
echo $! > $B7/logs/anchor.pid
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:8898/healthz >/dev/null && break; sleep 1; done
cd $B4/harness/titen-lane
python3 anchor_run.py --port 8898 --key "$KEY" --out titen-fts-anchor-20260807
rc=$?
kill "$(cat $B7/logs/anchor.pid)" 2>/dev/null || true
echo "=== ANCHOR DONE rc=$rc $(date -Is) ==="
if [ $rc -ne 0 ]; then echo "ANCHOR GATE FAILED - stopping day 1"; exit $rc; fi

echo "=== TITEN CURVE START $(date -Is) ==="
$B7/run_titen_curve.sh
rc=$?
echo "=== TITEN CURVE DONE rc=$rc $(date -Is) ==="
[ $rc -ne 0 ] && exit $rc

echo "=== CONTROL CURVE START $(date -Is) ==="
cd $B4/harness
$B4/venvs/control/bin/python control_pooled.py --arm fastembed \
  --sizes 1000,5000,10000,19829 --tag pooled-20260807
rc=$?
echo "=== CONTROL CURVE DONE rc=$rc $(date -Is) ==="
[ $rc -ne 0 ] && exit $rc

echo "=== MEMPALACE START $(date -Is) ==="
cd $B4/lanes/mempalace
$B4/venvs/mempalace/bin/python mp_pooled.py --tag pooled-19829-20260807
rc=$?
echo "=== MEMPALACE DONE rc=$rc $(date -Is) ==="
[ $rc -ne 0 ] && exit $rc

echo "=== MCP n=60 START $(date -Is) ==="
cd $B4/competitors/mcp-memory
python3 prep_pooled.py 60 /tmp/mcp-pool.jsonl /tmp/mcp-questions.json
node run_pooled.js /tmp/mcp-pool.jsonl /tmp/mcp-questions.json \
  $B4/results/mcp-memory-pooled-60-20260807.raw.json \
  node_modules/@modelcontextprotocol/server-memory/dist/index.js /tmp/mcp-pooled-scratch
rc=$?
echo "=== MCP DONE rc=$rc $(date -Is) ==="
echo "=== DAY1 COMPLETE $(date -Is) ==="
