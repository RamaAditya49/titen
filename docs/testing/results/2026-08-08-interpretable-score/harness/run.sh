#!/usr/bin/env bash
# The exact sequence that produced ../artifacts. Not a wrapper anything calls --
# the record of what ran, so a reader can re-run it rather than infer it.
#
# Preconditions (all pre-existing, none built here):
#   ~/titen-bench-20260804/lanes/titen/fts-500.db      anchor, 424,168 claims
#   ~/titen-bench-20260807/lanes/pooled-19829.db       pooled, 342,129 claims
#   ~/titen-bench-20260804/harness/common.py           the shared scorer
#
# Both stores are COPIED before being served. The canonical files are never
# opened read-write: a served compile writes context_runs rows, and a benchmark
# that mutates its own store has measured itself.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../artifacts"
WORK="${WORK:-$HOME/score227}"
REPO="${REPO:-$HOME/titen-recovery}"

BEFORE=22944bb   # parent: relevance is min-max inside the candidate set
AFTER=d3bd8c9    # under test: relevance = strength / (strength + 3.7)

# `at` is pinned to each published run's own timestamp. Recency defaults to
# wall-clock, so an unpinned re-run reorders the pack tail on 43 of 500 anchor
# packs (docs/testing/2026-08-08-pooled-recall-recovery.md). Pinning is what
# makes "before" and "after" differ by the code and nothing else.
ANCHOR_AT=2026-08-07T11:40:15Z
POOLED_AT=2026-08-07T11:58:17Z

mkdir -p "$WORK/logs" "$OUT"
git -C "$REPO" worktree add "$WORK/before" "$BEFORE"
git -C "$REPO" worktree add "$WORK/after" "$AFTER"
ln -sfn "$REPO/node_modules" "$WORK/before/node_modules"
ln -sfn "$REPO/node_modules" "$WORK/after/node_modules"

for f in db db-wal db-shm; do
  cp -f "$HOME/titen-bench-20260804/lanes/titen/fts-500.$f" "$WORK/anchor.$f" 2>/dev/null || true
  cp -f "$HOME/titen-bench-20260807/lanes/pooled-19829.$f" "$WORK/pooled.$f" 2>/dev/null || true
done

ANCHOR_KEY=$(sed -n 's/^api_key: //p' "$HOME/titen-bench-20260804/logs/titen/fts-500b.log.bootstrap" | head -1)
POOLED_KEY=$(sed -n 's/^api_key: //p' "$HOME/titen-bench-20260807/logs/pooled-19829.log.bootstrap" | head -1)

run_condition() {  # <build-label> <worktree> <condition> <db> <port> <key> <at>
  local label="$1" tree="$2" cond="$3" db="$4" port="$5" key="$6" at="$7"
  "$HERE/serve_store.sh" "$tree" "$db" "$port" "$WORK/logs/$label-$cond.log" "$key"
  python3 "$HERE/score_run.py" --condition "$cond" --build "$label" --port "$port" \
    --key "$key" --at "$at" --passes 2 --out "$OUT/$label-$cond"
}

# Baselines first. If these do not reproduce 0.880 and 0.246 the rest is void.
run_condition before "$WORK/before" anchor "$WORK/anchor.db" 8801 "$ANCHOR_KEY" "$ANCHOR_AT"
run_condition before "$WORK/before" pooled "$WORK/pooled.db" 8802 "$POOLED_KEY" "$POOLED_AT"
kill "$(cat "$WORK/logs/before-anchor.log.pid")" "$(cat "$WORK/logs/before-pooled.log.pid")"

run_condition after "$WORK/after" anchor "$WORK/anchor.db" 8801 "$ANCHOR_KEY" "$ANCHOR_AT"
run_condition after "$WORK/after" pooled "$WORK/pooled.db" 8802 "$POOLED_KEY" "$POOLED_AT"

# AC-INT-001 at the unit level, on the artifact the pre-registration used.
export PATH="$HOME/.bun/bin:$PATH"
bun "$HERE/probe_relevance.ts" "$WORK/before" "$BEFORE" > "$OUT/probe-relevance-before.json"
bun "$HERE/probe_relevance.ts" "$WORK/after" "$AFTER" > "$OUT/probe-relevance-after.json"

# Why the recall null is arithmetic rather than evidence.
python3 "$HERE/component_variance.py" --condition anchor --port 8801 --key "$ANCHOR_KEY" \
  --at "$ANCHOR_AT" --build "$AFTER" --out "$OUT/component-variance-anchor.json"
python3 "$HERE/component_variance.py" --condition pooled --port 8802 --key "$POOLED_KEY" \
  --at "$POOLED_AT" --build "$AFTER" --out "$OUT/component-variance-pooled.json"

kill "$(cat "$WORK/logs/after-anchor.log.pid")" "$(cat "$WORK/logs/after-pooled.log.pid")"

python3 "$HERE/gates.py" --artifacts "$OUT" \
  --probe-before "$OUT/probe-relevance-before.json" \
  --probe-after "$OUT/probe-relevance-after.json" \
  --out "$OUT/gates.json"
