#!/usr/bin/env bash
# Copy this cycle's artifacts into the repository, refuse anything carrying a
# bench API key, and checksum what survives.
#
# A key in a committed artifact is not recoverable by deleting the file later,
# so the scan runs before the copy and aborts the whole package step rather
# than skipping the offending file.
#
# The pattern requires key material after the prefix, not the prefix alone —
# matching the bare prefix makes the scan reject its own documentation, and a
# check that fires on prose is a check people learn to bypass.
set -euo pipefail
KEY_PATTERN='titen_sk_[A-Za-z0-9_-]{16,}'
R="$HOME/titen-bench-20260808r"
DEST="$HOME/titen-recovery/docs/testing/results/2026-08-08-pooled-recall-recovery"
mkdir -p "$DEST/artifacts" "$DEST/harness"

for file in "$@"; do
  [ -f "$file" ] || { echo "ABORT: missing $file" >&2; exit 1; }
  if LC_ALL=C grep -lE "$KEY_PATTERN" "$file" >/dev/null 2>&1; then
    echo "ABORT: $file contains an API key" >&2
    exit 1
  fi
done

for file in "$@"; do
  case "$file" in
    *.py|*.ts|*.sh) cp "$file" "$DEST/harness/" ;;
    *) cp "$file" "$DEST/artifacts/" ;;
  esac
done

if LC_ALL=C grep -rlE "$KEY_PATTERN" "$DEST" >/dev/null 2>&1; then
  echo "ABORT: a key reached $DEST" >&2
  exit 1
fi

cd "$DEST"
find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
wc -l < SHA256SUMS
echo "packaged into $DEST"
