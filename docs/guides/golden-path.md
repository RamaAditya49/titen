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
export TITEN_ADMIN_KEY=$(printf '%s\n' "$BOOT" | sed -n 's/^api_key: //p')
key() { $BUN src/runtime/bun/cli.ts key create --db "$DB" --org-id "$ORG" --principal "$1" --scopes "$2" | sed -n 's/^api_key: //p'; }
export TITEN_RESEARCHER_KEY=$(key researcher 'projects:resolve,projects:create,observations:write,claims:write')
export TITEN_WRITER_KEY=$(key writer 'projects:resolve,context:compile')
export TITEN_OPERATOR_KEY=$(key operator 'checkpoints:write,leases:write,handoffs:write')
export TITEN_REVIEWER_KEY=$(key reviewer 'handoffs:write,feedback:write,evidence:read,views:compile')
$BUN src/runtime/bun/cli.ts serve --db "$DB" --port 8787 & PID=$!
trap 'kill $PID; rm -f "$DB" "$DB-wal" "$DB-shm"' EXIT
export TITEN_URL=http://127.0.0.1:8787
export TITEN_WORKSPACE_ID=$($BUN -e '
const headers = { "content-type": "application/json", authorization: `Bearer ${process.env.TITEN_ADMIN_KEY}` };
const call = async (path, body) => {
  const response = await fetch(`${process.env.TITEN_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${json.error?.message ?? "request failed"}`);
  return json.data;
};
const workspace = await call("/v1/workspaces", { name: "Golden path" });
for (const [principal_id, role] of [["researcher", "member"], ["writer", "reader"], ["operator", "admin"], ["reviewer", "reader"]])
  await call("/v1/memberships", { workspace_id: workspace.workspace_id, principal_id, principal_kind: "agent", role });
console.log(workspace.workspace_id);
')
unset TITEN_ADMIN_KEY BOOT
pnpm example:golden-path
```

The setup uses the bootstrap key only to create one workspace and its four
memberships, then unsets it before the example runs. The reviewer principal is
deliberately named `reviewer`, matching `to_principal`; the running example uses
four least-privilege role keys. Never commit any key. Success is JSON containing
concrete observation/claim/context/checkpoint/lease/handoff IDs, evidence
citations and support/contradiction edges, accepted handoff and useful feedback,
plus subject-scoped conflict nodes with freshness. Any missing configuration,
authorization, or API failure exits non-zero; there is no fixture fallback.

## Queue boundary

Current main has no canonical work queue (#31 is separate), so this uses checkpoints, leases, and handoffs rather than emulating scheduling.
