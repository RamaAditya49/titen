#!/usr/bin/env bash
# Four capture runs, sequential, on a quiet box.
#
#   1-2  shipped 32,000-token packs on both stores. These carry the baseline
#        recall figures and the only latency numbers this cycle publishes.
#   3-4  the same two stores served from the instrument build, whose single
#        changed constant is LIMITS.maxTokens, to record the ranked candidate
#        order that exists before packing. No recall or latency figure is taken
#        from these; they exist so packing variants can be simulated offline.
#
# The instrument patch is reverted by a trap, so an abort cannot leave the
# working tree carrying it.
set -euo pipefail
R="$HOME/titen-bench-20260808r"
SRC="$HOME/titen-recovery"
PY=/usr/bin/python3
PORT_P=8901
PORT_A=8902

POOLED_KEY=$(sed -n 's/^api_key: //p' "$HOME/titen-bench-20260807/logs/pooled-19829.log.bootstrap" | head -1)
ANCHOR_KEY=$(sed -n 's/^api_key: //p' "$HOME/titen-bench-20260804/logs/titen/fts-500b.log.bootstrap" | head -1)
[ -n "$POOLED_KEY" ] && [ -n "$ANCHOR_KEY" ] || { echo "ABORT: missing bootstrap key" >&2; exit 1; }

stop() {
  for log in "$R/logs/serve-pooled.log" "$R/logs/serve-anchor.log"; do
    if [ -s "${log}.pid" ]; then
      pid=$(cat "${log}.pid")
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}
cleanup() {
  stop
  git -C "$SRC" checkout -- src/core/validate.ts 2>/dev/null || true
}
trap cleanup EXIT

git -C "$SRC" diff --quiet -- src/core/validate.ts || { echo "ABORT: validate.ts already dirty" >&2; exit 1; }

echo "=== 1/4 pooled, shipped 32,000-token budget ==="
"$R/harness/serve-existing.sh" "$R/lanes/pooled.db" "$PORT_P" "$R/logs/serve-pooled.log" "$POOLED_KEY"
$PY "$R/harness/capture.py" --port "$PORT_P" --key "$POOLED_KEY" --condition pooled \
  --max-tokens 32000 --out "$R/results/cap-pooled-32k.json"
stop

echo "=== 2/4 anchor, shipped 32,000-token budget ==="
"$R/harness/serve-existing.sh" "$R/lanes/anchor.db" "$PORT_A" "$R/logs/serve-anchor.log" "$ANCHOR_KEY"
$PY "$R/harness/capture.py" --port "$PORT_A" --key "$ANCHOR_KEY" --condition anchor \
  --max-tokens 32000 --out "$R/results/cap-anchor-32k.json"
stop

echo "=== instrument: raising LIMITS.maxTokens for capture only ==="
sed -i 's/^  maxTokens: 32_000,$/  maxTokens: 4_000_000,/' "$SRC/src/core/validate.ts"
git -C "$SRC" diff --stat -- src/core/validate.ts

echo "=== 3/4 pooled, pre-pack ranked order ==="
"$R/harness/serve-existing.sh" "$R/lanes/pooled.db" "$PORT_P" "$R/logs/serve-pooled.log" "$POOLED_KEY"
$PY "$R/harness/capture.py" --port "$PORT_P" --key "$POOLED_KEY" --condition pooled \
  --max-tokens 4000000 --out "$R/results/cap-pooled-full.json"
stop

echo "=== 4/4 anchor, pre-pack ranked order ==="
"$R/harness/serve-existing.sh" "$R/lanes/anchor.db" "$PORT_A" "$R/logs/serve-anchor.log" "$ANCHOR_KEY"
$PY "$R/harness/capture.py" --port "$PORT_A" --key "$ANCHOR_KEY" --condition anchor \
  --max-tokens 4000000 --out "$R/results/cap-anchor-full.json"
stop

git -C "$SRC" checkout -- src/core/validate.ts
git -C "$SRC" status --porcelain -- src/core/validate.ts
echo "=== captures complete, instrument reverted ==="
