#!/usr/bin/env bash
# usage: serve-tarball.sh <arm: router|fts> <db-path> <port> <log-path>
# Serves the installed npm tarball at ~/titen-bench-20260807/pkg, not a checkout.
set -euo pipefail
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
ARM="$1"; DB="$2"; PORT="$3"; LOG="$4"
BIN="$HOME/titen-bench-20260807/pkg/node_modules/.bin/titen"

unset TITEN_EMBED_BASE_URL TITEN_EMBED_MODEL TITEN_EMBED_DIMS TITEN_EMBED_REVISION
unset TITEN_EMBED_PROFILE TITEN_EMBED_MIN_COSINE TITEN_EMBED_API_KEY TITEN_VEC_DB_PATH
unset TITEN_EXTRACT_BASE_URL TITEN_EXTRACT_MODEL TITEN_EXTRACT_MODEL_FINGERPRINT
unset TITEN_EXTRACT_API_KEY TITEN_EXTRACT_TIMEOUT_MS TITEN_EXTRACT_RESPONSE_MODE

if [ "$ARM" = "router" ]; then
  set -a; . "$HOME/.config/titen-bench.env"; set +a
  export TITEN_EMBED_BASE_URL="$TITEN_EVAL_EMBED_BASE_URL"
  export TITEN_EMBED_MODEL="$TITEN_EVAL_EMBED_MODEL"
  export TITEN_EMBED_DIMS="$TITEN_EVAL_EMBED_DIMS"
  export TITEN_EMBED_API_KEY="$TITEN_EVAL_EMBED_API_KEY"
  export TITEN_EMBED_REVISION="longmemeval-bench-20260807"
  export TITEN_EMBED_PROFILE="embeddinggemma-retrieval-v1"
  export TITEN_EMBED_MIN_COSINE="-1"
  export TITEN_VEC_DB_PATH="${DB}.vec"
fi
export TITEN_MAINTENANCE_INTERVAL_MS=0

pkill -f "serve --db ${DB} --port ${PORT}" 2>/dev/null || true
sleep 2
rm -f "$DB" "$DB-wal" "$DB-shm" "${DB}.vec" "${DB}.vec-wal" "${DB}.vec-shm"
"$BIN" bootstrap --db "$DB" --org "bench-$ARM" --username "owner-$ARM-$PORT" \
  > "${LOG}.bootstrap" 2>&1
chmod 600 "${LOG}.bootstrap"
nohup "$BIN" serve --db "$DB" --port "$PORT" > "$LOG" 2>&1 &
echo $! > "${LOG}.pid"
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${PORT}/healthz" > /dev/null; then break; fi
  sleep 1
done
sed -n "s/^api_key: //p" "${LOG}.bootstrap" | head -1
