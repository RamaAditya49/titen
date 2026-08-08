#!/usr/bin/env bash
# usage: serve-existing.sh <db-path> <port> <log-path> <api-key>
#
# Serves an ALREADY-INGESTED store copy from the repository checkout. Unlike
# serve.sh and serve-tarball.sh it never bootstraps and never deletes the
# database; the caller passes the key that store was bootstrapped with.
#
# Two rules learned expensively and enforced here:
#   * The readiness probe is AUTHENTICATED. A bare /healthz cannot tell a fresh
#     server from a dying predecessor still holding the port, and that race
#     destroyed a full lane on 2026-08-07.
#   * Nothing is killed by pattern. A pkill pattern broad enough to catch a
#     stale server is broad enough to catch the shell running it; the previous
#     PID is read from the pid file, and only that PID is signalled.
set -euo pipefail
export PATH="$HOME/.bun/bin:$HOME/.local/lib/nodejs/node-v24.18.0-linux-x64/bin:$PATH"
DB="$1"; PORT="$2"; LOG="$3"; KEY="$4"
SRC="$HOME/titen-recovery"

unset TITEN_EMBED_BASE_URL TITEN_EMBED_MODEL TITEN_EMBED_DIMS TITEN_EMBED_REVISION
unset TITEN_EMBED_PROFILE TITEN_EMBED_MIN_COSINE TITEN_EMBED_API_KEY TITEN_VEC_DB_PATH
unset TITEN_EXTRACT_BASE_URL TITEN_EXTRACT_MODEL TITEN_EXTRACT_MODEL_FINGERPRINT
unset TITEN_EXTRACT_API_KEY TITEN_EXTRACT_TIMEOUT_MS TITEN_EXTRACT_RESPONSE_MODE
export TITEN_MAINTENANCE_INTERVAL_MS=0

if [ -s "${LOG}.pid" ]; then
  OLD=$(cat "${LOG}.pid")
  if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
    kill "$OLD" 2>/dev/null || true
    for _ in $(seq 1 30); do kill -0 "$OLD" 2>/dev/null || break; sleep 1; done
    kill -9 "$OLD" 2>/dev/null || true
  fi
fi
for _ in $(seq 1 30); do
  ss -ltn "sport = :${PORT}" 2>/dev/null | grep -q LISTEN || break
  sleep 1
done
if ss -ltn "sport = :${PORT}" 2>/dev/null | grep -q LISTEN; then
  echo "ABORT: port ${PORT} still held" >&2
  exit 1
fi

cd "$SRC"
nohup "$HOME/.bun/bin/bun" src/runtime/bun/cli.ts serve --db "$DB" --port "$PORT" > "$LOG" 2>&1 &
echo $! > "${LOG}.pid"

ok=""
for _ in $(seq 1 120); do
  # curl already prints 000 through -w when it cannot connect, and appending a
  # fallback with `|| echo 000` concatenates the two into 000000 — a value that
  # is neither 401 nor 000, so the probe would pass against a dead server. That
  # is the race this whole function exists to prevent.
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 20 \
    -X POST "http://127.0.0.1:${PORT}/v1/context/compile" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d '{"subject_id":"__startup_probe__","task":"probe","max_tokens":200}' 2>/dev/null || true)
  if [ "$code" = "200" ]; then ok=1; break; fi
  sleep 1
done
if [ -z "$ok" ]; then
  echo "ABORT: server on ${PORT} never accepted the key (last code $code)" >&2
  exit 1
fi
echo "serving ${DB} on ${PORT}, pid $(cat "${LOG}.pid"), probe ${code}"
