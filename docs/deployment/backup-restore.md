# Backup and restore runbook

Status: **executed** — every step below was performed against a populated store
on `benchmark-host` on 2026-08-04, and the output is that run's real output. One
substitution is applied throughout and stated here rather than hidden: the drill
ran as an unprivileged user under a scratch directory, and the transcript's paths
and file ownership are rewritten to the `/var/lib/titen` layout the systemd unit
actually deploys. Byte counts and timestamps are the drill's own, so the
`.sha256` file's 147 bytes reflects the longer scratch path
(`sha256sum` writes 64 hex digits, two spaces, the path, and a newline), not the
shorter path printed beside it.

Nothing here was run as root, and no step was performed against a real
`/var/lib/titen` deployment. Treat the command shapes as verified and the
privileged-path specifics as untested. The general guidance this implements lives
in [`vps.md`](./vps.md#backup-and-restore); this file is the drill.

Scope: the Bun/SQLite deployment. Cloudflare D1 has its own export path and was
not exercised here.

## What the backup contains

`deploy/backup.sh` calls `titen backup`, which runs `VACUUM INTO` against the
live database. That is safe while the service is serving: it produces a
compacted, self-contained copy, then verifies `PRAGMA integrity_check`,
`PRAGMA foreign_key_check`, a non-empty schema, and the exact schema version
before it will replace the target path. A copy that fails any of those is
deleted rather than left looking usable.

The snapshot is the canonical SQL only. It does **not** contain:

- the `sqlite-vec` sidecar at `TITEN_VEC_DB_PATH` (default `<db>.vec`) — it is
  rebuildable, and a restored canonical store paired with a stale or missing
  projection must be reindexed before semantic traffic returns;
- `-wal` and `-shm` files — `VACUUM INTO` folds committed WAL content into the
  copy, which is why the copy is smaller than the live pair.

Measured on the drill store: live `titen.db` plus its WAL was 3,823,176 bytes
and the verified backup was 860,160 bytes.

## The drill

Executed on `benchmark-host`, Bun 1.3.14, working tree at `titen-memory` 0.5.7,
schema version 21.

### 1. Back up while the service is running

```bash
TITEN_ROOT=/path/to/titen bash deploy/backup.sh /var/lib/titen/titen.db /var/lib/titen/backups
```

```
backup verified: /var/lib/titen/backups/titen_20260804_165556.db
Backup complete: /var/lib/titen/backups/titen_20260804_165556.db
```

`TITEN_ROOT` only needs to be set when the script is not being run from inside
the repository or package it belongs to; it defaults to the parent of
`deploy/`. The script writes two mode-`0600` files, the copy and its
`.sha256`, into a mode-`0700` directory:

```
-rw-------. 1 titen titen 798720 Aug  4 16:55 titen_20260804_165556.db
-rw-------. 1 titen titen    147 Aug  4 16:55 titen_20260804_165556.db.sha256
```

Pass absolute paths, or let the script resolve them: it now canonicalises both
arguments before writing the checksum. A relative backup directory previously
recorded a relative name inside the `.sha256` file, and the verification then
failed from any other working directory. No shipped invocation was affected —
`backup.service` passes no arguments and the defaults are absolute — so this
bites an operator running the script by hand with a relative directory:

```
$ sha256sum --check bk2/titen_20260804_165620.db.sha256   # from $HOME
bk2/titen_20260804_165620.db: FAILED open or read
```

### 2. Verify the checksum before trusting the copy

```bash
sha256sum --check /var/lib/titen/backups/titen_20260804_165556.db.sha256
```

```
/var/lib/titen/backups/titen_20260804_165556.db: OK
```

### 3. Record what the store answers now

The restore is only proven if the store answers the same question with the same
claim identifiers afterwards. Capture the answer first:

```bash
curl -fsS -X POST "http://127.0.0.1:8787/v1/context/compile" \
  -H "authorization: Bearer $TITEN_API_KEY" \
  -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" \
  -d '{"subject_id":"ops","task":"What is the deployment window and what does rollback require?","max_tokens":1200}' \
  | python3 -c 'import json,sys;print("\n".join(sorted(i["claim_id"] for i in json.load(sys.stdin)["data"]["items"])))'
```

```
claim_7e94b70ea5374225837f2bbc7be53cb0
claim_ff5670a1143241f394df39a9e9d83c77
```

### 4. Stop the service and destroy the original

```bash
kill "$TITEN_PID"
rm -f /var/lib/titen/titen.db /var/lib/titen/titen.db-wal /var/lib/titen/titen.db-shm
```

```
ls: cannot access '/var/lib/titen/titen.db': No such file or directory
original store is gone
```

In a real incident, move the failed database aside instead of deleting it; the
drill deletes because the point is to prove the backup is sufficient on its own.

### 5. Restore

Restore is a file copy. There is no `titen restore` command and none is needed.

```bash
sha256sum --check /var/lib/titen/backups/titen_20260804_165556.db.sha256
install -m 600 /var/lib/titen/backups/titen_20260804_165556.db /var/lib/titen/titen.db
bun src/runtime/bun/cli.ts migrate --db /var/lib/titen/titen.db --dry-run | tail -1
```

```
/var/lib/titen/backups/titen_20260804_165556.db: OK
-- 0 migration(s) pending; database unchanged
```

`install -m 600` sets the mode in the same step as the copy, so the restored
file is never briefly world-readable. The dry run is the cheap proof that the
restored file is a real Titen store at the schema version this binary expects;
it neither creates nor changes anything.

### 6. Prove the restored store answers identically

```bash
bun src/runtime/bun/cli.ts serve --db /var/lib/titen/titen.db --port 8787 --quiet &
until curl -fsS http://127.0.0.1:8787/healthz > /dev/null; do sleep 0.3; done
curl -fsS http://127.0.0.1:8787/readyz
```

```
"schema": { "applied": 21, "expected": 21, "verified": true }
"checks": { "canonical_sql": "ok", "migrations": "ok", "signing_secrets": "ok", ... }
```

Require `/readyz`, not `/healthz`, before returning traffic: `/healthz` answers
`ok` from a process that has not verified its schema.

Re-run the compile from step 3 against the restored store:

```
claim_7e94b70ea5374225837f2bbc7be53cb0
claim_ff5670a1143241f394df39a9e9d83c77
```

```bash
diff before.txt after.txt && echo "IDENTICAL claim ids"
```

```
IDENTICAL claim ids
```

## Restore was also exercised inside the upgrade rehearsal

`scripts/rehearse-upgrade.ts` runs the same backup, destroy, restore sequence
against stores seeded on nine published releases from 0.1.0 to 0.5.1. In every
one of the nine, the restored store matched the pre-backup store on every table
row count, every claim identifier returned by compile, and every claim's
evidence count. Full results:
[`docs/testing/2026-08-04-operational-lifecycle.md`](../testing/2026-08-04-operational-lifecycle.md).

## Retention

`deploy/backup.sh` prunes both halves of a pair after
`TITEN_BACKUP_RETENTION_DAYS` (default 30) so a removed database never leaves an
orphan checksum. Retention was not exercised in this drill — it needs files
older than the window — so treat the pruning branch as unmeasured.

## What this drill did not cover

- Restore onto a different host or a different Bun version.
- Restore of the `sqlite-vec` sidecar; the drill ran with vectors disabled.
- The `cron`/systemd timer path. The script was invoked directly.
- Cloudflare D1.
