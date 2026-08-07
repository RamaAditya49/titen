#!/usr/bin/env bash
# usage: serve_lane.sh <db-path> <port> <log-path>
#
# Starts a Bun/SQLite Titen server from the evidence-rank worktree against a
# store that ALREADY EXISTS. Unlike the 2026-08-04 lane's serve.sh this never
# deletes the database and never bootstraps: both arms of the A/B must see the
# same canonical rows and the same principal.
set -euo pipefail
export PATH="$HOME/.bun/bin:$HOME/.local/lib/nodejs/node-v24.18.0-linux-x64/bin:$PATH"
DB="$1"; PORT="$2"; LOG="$3"
SRC="$HOME/titen-evidence-rank/base"

# FTS-only is the lane under test, so a model configuration inherited from the
# parent shell would silently turn it into a different lane.
unset TITEN_EMBED_BASE_URL TITEN_EMBED_MODEL TITEN_EMBED_DIMS TITEN_EMBED_REVISION
unset TITEN_EMBED_PROFILE TITEN_EMBED_MIN_COSINE TITEN_EMBED_API_KEY TITEN_VEC_DB_PATH
unset TITEN_EXTRACT_BASE_URL TITEN_EXTRACT_MODEL TITEN_EXTRACT_MODEL_FINGERPRINT
unset TITEN_EXTRACT_API_KEY TITEN_EXTRACT_TIMEOUT_MS TITEN_EXTRACT_RESPONSE_MODE
export TITEN_MAINTENANCE_INTERVAL_MS=0

cd "$SRC"
nohup bun src/runtime/bun/cli.ts serve --db "$DB" --port "$PORT" > "$LOG" 2>&1 &
echo $! > "${LOG}.pid"
for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:${PORT}/healthz" > /dev/null; then
    echo "up on ${PORT} (pid $(cat "${LOG}.pid"))"
    exit 0
  fi
  sleep 1
done
echo "server did not become healthy" >&2
exit 1
