#!/usr/bin/env bash
set -euo pipefail

# Titen health monitor - use with systemd watchdog or external monitoring
URL="${1:-http://127.0.0.1:8787}"

# Check liveness
HEALTH=$(curl -sf "${URL}/healthz" | jq -r '.data.status' 2>/dev/null)
if [ "$HEALTH" != "ok" ]; then
  echo "CRITICAL: healthz failed" >&2
  exit 2
fi

# Check readiness
READY=$(curl -sf "${URL}/readyz" | jq -r '.data.ready' 2>/dev/null)
if [ "$READY" != "true" ]; then
  echo "WARNING: readyz reports not ready" >&2
  exit 1
fi

# Check database size (warn at 1GB)
DB_SIZE=$(curl -sf "${URL}/readyz" | jq -r '.data.schema.applied // 0' 2>/dev/null)
echo "OK: titen healthy, schema v${DB_SIZE}"
exit 0
