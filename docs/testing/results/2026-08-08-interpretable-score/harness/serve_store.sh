#!/usr/bin/env bash
# usage: serve_store.sh <src-worktree> <db-path> <port> <log-path> <api-key>
#
# Serves an EXISTING bench store copy from a source checkout. Unlike
# titen-bench-20260807/serve-tarball.sh this never bootstraps and never
# deletes the store: the key already lives in the database and the claims are
# the measurement.
#
# Identity-checked startup: an authenticated compile probe, not /healthz. A
# bare health check cannot distinguish the new server from a dying predecessor
# still holding the port, and that race destroyed a lane on 2026-08-07.
#
# The previous server is killed by the PID this script wrote, never by a
# pkill pattern -- a pattern broad enough to match the server is also broad
# enough to match the shell running this file.
set -euo pipefail
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
SRC="$1"; DB="$2"; PORT="$3"; LOG="$4"; KEY="$5"

unset TITEN_EMBED_BASE_URL TITEN_EMBED_MODEL TITEN_EMBED_DIMS TITEN_EMBED_REVISION
unset TITEN_EMBED_PROFILE TITEN_EMBED_MIN_COSINE TITEN_EMBED_API_KEY TITEN_VEC_DB_PATH
unset TITEN_EXTRACT_BASE_URL TITEN_EXTRACT_MODEL TITEN_EXTRACT_MODEL_FINGERPRINT
unset TITEN_EXTRACT_API_KEY TITEN_EXTRACT_TIMEOUT_MS TITEN_EXTRACT_RESPONSE_MODE
export TITEN_MAINTENANCE_INTERVAL_MS=0

if [ -f "${LOG}.pid" ]; then
  kill "$(cat "${LOG}.pid")" 2>/dev/null || true
  rm -f "${LOG}.pid"
fi
for _ in $(seq 1 60); do
  ss -ltn "sport = :${PORT}" 2>/dev/null | grep -q LISTEN || break
  sleep 1
done
if ss -ltn "sport = :${PORT}" 2>/dev/null | grep -q LISTEN; then
  echo "ABORT: port ${PORT} still held after kill" >&2
  exit 1
fi

nohup bun "$SRC/src/runtime/bun/cli.ts" serve --db "$DB" --port "$PORT" > "$LOG" 2>&1 &
echo $! > "${LOG}.pid"

ok=""
for _ in $(seq 1 180); do
  # `|| echo 000` INSIDE the substitution would append a second line to curl's
  # own "000" and yield "000\n000", which is != "000" and would pass a guard
  # whose entire job is to fail there. The fallback assigns the variable.
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 \
    -X POST "http://127.0.0.1:${PORT}/v1/context/compile" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d '{"subject_id":"__startup_probe__","task":"probe","max_tokens":128}') || code=000
  if [ "$code" != "401" ] && [ "$code" != "000" ]; then ok=1; break; fi
  sleep 1
done
if [ -z "$ok" ]; then
  echo "ABORT: server on ${PORT} never accepted the store key (last code $code)" >&2
  exit 1
fi
echo "serving ${DB} from ${SRC} on ${PORT} (probe ${code}), pid $(cat "${LOG}.pid")"
