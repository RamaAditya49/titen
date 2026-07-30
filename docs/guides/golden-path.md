# Small-team golden path

This runs a real Bun/SQLite service through evidence, conflicting claims, project-scoped compile, checkpoint, lease, handoff, feedback, citations, and subject-scoped conflict/freshness.

## Copy-paste local setup

```sh
set -eu
BUN=${BUN:-bun}
DB="${TMPDIR:-/tmp}/titen-golden-$$.db"
$BUN src/runtime/bun/cli.ts migrate --db "$DB"
BOOT=$($BUN src/runtime/bun/cli.ts bootstrap --db "$DB" --org "Golden path")
ORG=$(printf '%s\n' "$BOOT" | sed -n 's/^organization: \([^ ]*\).*/\1/p')
key() { $BUN src/runtime/bun/cli.ts key create --db "$DB" --org-id "$ORG" --principal "$1" --scopes "$2" | sed -n 's/^api_key: //p'; }
export TITEN_RESEARCHER_KEY=$(key researcher 'projects:resolve,projects:create,observations:write,claims:write')
export TITEN_WRITER_KEY=$(key writer 'projects:resolve,context:compile')
export TITEN_OPERATOR_KEY=$(key operator 'checkpoints:write,leases:write,handoffs:write')
export TITEN_REVIEWER_KEY=$(key reviewer 'handoffs:write,feedback:write,evidence:read,views:compile')
$BUN src/runtime/bun/cli.ts serve --db "$DB" --port 8787 & PID=$!
trap 'kill $PID; rm -f "$DB" "$DB-wal" "$DB-shm"' EXIT
export TITEN_URL=http://127.0.0.1:8787
pnpm example:golden-path
```

The reviewer principal is deliberately named `reviewer`, matching `to_principal`. The bootstrap key remains only in the local `BOOT` shell variable; the example uses four least-privilege role keys. Never commit any key. Success is JSON containing concrete observation/claim/context/checkpoint/lease/handoff IDs, evidence citations and support/contradiction edges, accepted handoff and useful feedback, plus subject-scoped conflict nodes with freshness. Any missing configuration, authorization, or API failure exits non-zero; there is no fixture fallback.

## Queue boundary

Current main has no canonical work queue (#31 is separate), so this uses checkpoints, leases, and handoffs rather than emulating scheduling.
