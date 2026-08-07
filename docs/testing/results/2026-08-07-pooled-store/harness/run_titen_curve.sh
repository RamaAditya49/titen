#!/usr/bin/env bash
# Titen FTS-only pooled curve: fresh store per size, 500 queries each.
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
cd ~/titen-bench-20260804/harness/titen-lane
for N in 1000 5000 10000 19829; do
  echo "=== SIZE $N START $(date -Is) ==="
  KEY=$(~/titen-bench-20260807/serve-tarball.sh fts ~/titen-bench-20260807/lanes/pooled-$N.db 8899 ~/titen-bench-20260807/logs/pooled-$N.log)
  if [ -z "$KEY" ]; then echo "ABORT: no key for size $N"; exit 1; fi
  SESS=$N
  [ "$N" = 19829 ] && SESS=0
  python3 pooled_run.py --arm fts --port 8899 --key "$KEY" --sessions $SESS \
    --workers 8 --tag pooled-$N \
    --out titen-fts-pooled-$N-20260807 \
    --meta-extra "{\"package\":\"titen-memory@0.7.0 npm tarball\",\"dist_shasum\":\"620af9a392b13c9bef91a215cf96eee2569e8f3e\",\"store_size_label\":\"$N\"}"
  rc=$?
  echo "=== SIZE $N DONE rc=$rc $(date -Is) ==="
  [ $rc -ne 0 ] && exit $rc
done
pkill -f "serve --db $HOME/titen-bench-20260807/lanes/pooled-19829.db" 2>/dev/null || true
echo "=== CURVE COMPLETE $(date -Is) ==="
