# Operational lifecycle: upgrade, backup, restore, portability

Date: 2026-08-04

Host: `rama-tuf`, Linux 7.0.12, 16 cores, 30 GiB RAM, Bun 1.3.14, Node 24.18.0.

Working tree under test: branch `fix/go-public-hardening-20260804` at commit
`a0033389`, reporting version 0.5.7, schema version 21. The tree carried 66
uncommitted files at the time of the run; it is a working tree, not a published
package, and nothing here is release evidence for a tarball.

Snapshot boundary: every number below was produced by the runs described. No
figure is estimated. Where something was not run it says "not measured".

No credential, prompt, memory content, or embedding entered an artifact. The
bootstrap key of each rehearsal store stayed in the rehearsing process and was
never written to a file or a command line.

Verdict: **the lifecycle holds, with two published limits** — a data-usable
upgrade floor of 0.2.0, and a logical export that emits pre-0.2.0 rows the
import will not accept.

## What was unexercised before this

Strategic debt item 8 in `PONYTAIL-DEBT.md`: the longest observed uptime in any
Titen measurement was about five minutes, no upgrade had been rehearsed across a
minor version, every store ever measured was freshly bootstrapped, every
migration observed had applied to an empty database, and `export_import`
reported as `enabled` without ever having been exercised end to end.

## Instrument

`scripts/rehearse-upgrade.ts`, new in this change. One Bun file, no new
dependency. It does four things in order against one store:

1. downloads a published `titen-memory` tarball, bootstraps a store with that
   release's own CLI, and writes a representative corpus through its HTTP API —
   a workspace and membership, a project, 15 observations across three subjects
   and five kinds, 8 claims across five kinds with multi-source evidence, one
   claim superseded under a version fence, one claim disputed by a contradicting
   source, one checkpoint, one lease;
2. migrates that non-empty file with the working tree and compares a full
   inventory taken directly from SQLite before and after — every table, every
   row count, every `id` in every table that has one, and the full canonical
   column set of every claim and observation;
3. runs `deploy/backup.sh` for real, destroys the original, restores from the
   backup, and re-runs the same compile queries;
4. exports every record type as NDJSON, imports into a freshly bootstrapped
   store, exports again, and diffs the two exports record for record.

Each phase reads back through the API rather than the database: claim evidence,
compiled context, checkpoint state, lease list. The published release's own key
is reused after the upgrade, so credential survival is proven rather than
assumed.

```bash
bun scripts/rehearse-upgrade.ts --from 0.4.1 --report /tmp/rehearsal.json
```

## 1. Upgrade rehearsal

Nine published releases were seeded and upgraded in place to the working tree.
Every store was populated before the migration ran.

| From | Source schema | Migrations applied | Canonical rows lost | Canonical rows mutated | Evidence resolves after | Checkpoint | Lease |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 0.1.0 | 9 | 12 (10–21) | 0 | 0 | **no — 8 of 8 unreadable** | not measured | not measured |
| 0.1.1 | 9 | 12 (10–21) | 0 | 0 | **no — 8 of 8 unreadable** | not measured | not measured |
| 0.1.2 | 9 | 12 (10–21) | 0 | 0 | **no — 8 of 8 unreadable** | not measured | not measured |
| 0.2.0 | 10 | 11 (11–21) | 0 | 0 | yes, 8 of 8 | not measured | not measured |
| 0.2.1 | 10 | 11 (11–21) | 0 | 0 | yes, 8 of 8 | not measured | not measured |
| 0.3.0 | 12 | 9 (13–21) | 0 | 0 | yes, 8 of 8 | survived | survived |
| 0.4.0 | 16 | 5 (17–21) | 0 | 0 | yes, 8 of 8 | survived | survived |
| 0.4.1 | 17 | 4 (18–21) | 0 | 0 | yes, 8 of 8 | survived | survived |
| 0.5.1 | 19 | 2 (20–21) | 0 | 0 | yes, 8 of 8 | survived | survived |

"not measured" for checkpoint and lease on 0.1.x and 0.2.x means those releases
answer `GET /v1/checkpoints/:id` and `GET /v1/leases` differently or not at all,
so no before-value exists to compare. The rows themselves survived: `checkpoints`
and `leases` both held one row before and one row after in every lane.

### Row counts

Every lane seeded the identical corpus and every lane preserved it exactly:

| Table | Before | After |
| --- | ---: | ---: |
| `observations` | 15 | 15 |
| `claims` | 8 | 8 |
| `claim_sources` | 11 | 11 |
| `checkpoints` | 1 | 1 |
| `leases` | 1 | 1 |
| `events` | 25 | 25 |
| `workspaces` | 1 | 1 |
| `memberships` | 1 | 1 |
| `projects` | 1 | 1 |
| `api_keys` | 1 | 1 |

Only four tables changed row count across any lane, and none of them is
canonical:

| Table | Change | Cause |
| --- | --- | --- |
| `titen_migrations` | +2 to +12 | one row per migration applied |
| `event_order` | 0 → 25 | migration backfills the ordering projection from `events` |
| `idempotency_v3` | 0 → 19 | migration rewrites the idempotency table (0.2.x lane only) |
| `observations_fts_data`, `observations_fts_idx`, `claims_fts_data`, `claims_fts_idx` | shrink | migration 11 drops and rebuilds both FTS5 projections; segment counts merge |

The FTS shrink is a segment merge, not a loss. `observations_fts` stayed at 15
rows and `claims_fts` at 8 across the rebuild. The visible consequence is that
compile output changes across migration 11: on the 0.2.0 lane, `user_alpha`
returned two claims before the upgrade and one after, because the rebuilt index
uses a different tokenizer and column set. Canonical rows are identical; ranked
lexical output is not. Anyone upgrading from 0.2.x should expect retrieval
results to move.

### The real supported floor

Every published version from 0.1.0 forward migrates a populated database to
schema 21 with zero canonical rows lost and zero rows mutated. The schema
migration floor is therefore version 1.

The **data-usable floor is 0.2.0**. On a 0.1.x store, all eight claims and all
fifteen observations survive the migration and then return `404` on
`GET /v1/claims/:id/evidence` and never appear in compiled context again. The
cause is deliberate and is stated in the migration itself — migration 10 adds
`workspace_id` to `observations` and `claims` and comments:

> Team visibility is a real workspace boundary. Legacy team rows remain
> fail-closed until an explicit future rebinding migration can prove scope.

`recordAccessSql` requires `visibility = 'team' AND workspace_id IS NOT NULL`,
and nothing backfills the column, so a record written as `team` on a release
that had no workspaces is permanently unreachable. Measured directly on the
migrated 0.1.0 store: 8 of 8 claims and 15 of 15 observations carry
`visibility = 'team'` with `workspace_id IS NULL`.

This is a design decision, not a defect, but it had never been measured and is
not stated anywhere a user reads. The honest product line is: **0.2.0 is the
oldest release whose data remains usable after an upgrade.**

## 2. Backup and restore drill

`deploy/backup.sh` was run for real against a populated, live store, the
original was destroyed, and the store was restored from the backup. Full
transcript: [`docs/deployment/backup-restore.md`](../deployment/backup-restore.md).

Result on the hand-run drill: the restored store returned the identical two
claim identifiers for the identical compile query, `sha256sum --check` passed,
and `migrate --dry-run` reported `0 migration(s) pending`.

The same sequence ran inside all nine rehearsal lanes. In every lane:

- restored table row counts were identical to the pre-backup counts;
- compiled claim identifiers were identical for all three subjects;
- evidence counts were identical for all eight claims;
- with the store deleted, `migrate --dry-run` reported all 21 migrations
  pending, confirming the original really was gone before the restore.

Sizes on the 0.4.1 lane: live database plus WAL 3,823,176 bytes; verified
backup 860,160 bytes. `VACUUM INTO` compacts, so a backup smaller than the live
pair is expected, not a truncation.

### Defect found and fixed

`deploy/backup.sh` recorded the checksum using whatever path it was given. With
a relative backup directory the `.sha256` file contained a relative name, so
verification failed from any other working directory. A control run confirmed the
blast radius is narrower than it first looked: with an absolute directory the
pre-fix script verified cleanly from `$HOME`, and every shipped invocation
(`backup.service`, `deploy/README.md`) passes no arguments and inherits absolute
defaults. No `cron` run and no documented restore was broken; the defect reaches
an operator who passes a relative directory by hand. Reproduced:

```
$ sha256sum --check bk2/titen_20260804_165620.db.sha256   # from $HOME
bk2/titen_20260804_165620.db: FAILED open or read
```

The script now canonicalises both arguments before computing the backup path.
Verified after the fix, from `$HOME`, with a relative invocation:

```
/home/…/drill/bk3/titen_20260804_165639.db: OK
```

Retention pruning was not exercised: it needs files older than
`TITEN_BACKUP_RETENTION_DAYS`. Treat that branch as unmeasured.

## 3. Export and import round trip

`export_import` has reported `enabled` since it shipped. It has now been run.

All six record types were exported with `all=true` from a populated store,
imported into a freshly bootstrapped store one type at a time in dependency
order, and the destination was exported again and diffed record for record.

| From | Exported | Round trip preserved every source record | Records missing after round trip |
| --- | --- | --- | ---: |
| 0.2.0 – 0.5.1 (six lanes) | 1 key, 1 workspace, 1 membership, 1 project, 15 observations, 8 claims | yes | 0 |
| 0.1.0 – 0.1.2 (three lanes) | same | **no** | 23 |

For the six lanes at 0.2.0 and above the round trip is clean. The destination
export contains exactly two rows the source did not: its own bootstrap
credential and its own organization-level membership. Those are the destination's
own identity, not a portability artifact. Every source record — including the
superseded claim with its `superseded_by` pointer, the disputed claim with its
contradicting source, all 11 claim-source edges, and the credential row with its
hash, scopes and validity window — arrived byte-identical.

### The pre-0.2.0 asymmetry

On the three 0.1.x lanes the export succeeds and the import refuses its own
output:

```
POST /v1/import -> 400 VALIDATION_ERROR
Field "workspace_id" is required for team visibility.
```

15 observations and 8 claims were exported with `visibility: "team"` and
`workspace_id: null`, and the import rejects the entire page. The export writer
and the import validator disagree about a state the database can hold. This is
the same legacy-team-row problem as the upgrade floor, seen from the portability
side, and it means a pre-0.2.0 store cannot be logically migrated out either —
only the physical SQLite snapshot recovers it.

### Not exercised

- Multi-page export. The corpus fits in one page per type; the `next_cursor`
  and `complete` fields were read but never had to advance.
- `titen.import.actor_map`. Source and destination principals were both `owner`.
- Import into an organization that already holds conflicting identifiers.
- Enrichment records. Enrichment is disabled, so `enrichment`,
  `enrichment_commit`, and `enrichment_link` were 0 received and 0 inserted in
  every lane.

## 4. Long soak — running

A soak was started and is deliberately still running. It is a single Titen
process on `rama-tuf` under steady low-rate load: one observation every 2 s, a
compile every 4 s, a two-source consolidation every 10 s, and a checkpoint every
2 min. Vectors, embeddings, extraction, and enrichment are all disabled — this
is the self-host floor configuration.

Sampled every 60 s: process `VmRSS`, `VmSize`, thread count, open file
descriptors, database bytes, WAL bytes, shared-memory bytes, and cumulative work
counters.

Log: `/tmp/titen-soak-20260804/samples.tsv` on `rama-tuf`, tab-separated with a
header row.

```bash
ssh -o BatchMode=yes -o ControlPath=~/.ssh/cm/tuf.sock rama-tuf-lan \
  'cat /tmp/titen-soak-20260804/samples.tsv; echo; cat /tmp/titen-soak-20260804/counters.json'
```

Stop it with:

```bash
ssh -o BatchMode=yes -o ControlPath=~/.ssh/cm/tuf.sock rama-tuf-lan \
  'D=/tmp/titen-soak-20260804; for f in load sampler server; do kill "$(cat $D/$f.pid)"; done'
```

First 12 minutes, which already exceeds every previously observed Titen uptime
by more than a factor of two:

| Uptime | RSS | Threads | FDs | Database | WAL | Observations | Claims | Compiles | Errors |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 s | 69,412 kB | 24 | 15 | 4 kB | 1,336 kB | 0 | 0 | 0 | 0 |
| 60 s | 74,728 kB | 24 | 16 | 840 kB | 4,052 kB | 30 | 6 | 15 | 0 |
| 300 s | 76,932 kB | 22 | 16 | 1,364 kB | 4,112 kB | 150 | 30 | 75 | 0 |
| 600 s | 78,864 kB | 21 | 16 | 2,036 kB | 4,148 kB | 300 | 60 | 150 | 0 |
| 720 s | 79,588 kB | 21 | 16 | 2,252 kB | 4,148 kB | 360 | 72 | 180 | 0 |

Early reading, not a conclusion: RSS rose 9.9 MiB over the first twelve minutes
and the rate is falling (5.2 MiB in the first minute, 0.3 MiB in the twelfth).
The WAL reached about 4.1 MB in the first minute and has been flat since, so
automatic checkpointing is working; the database file grows linearly with the
corpus, as it should. File descriptors are flat at 16 and threads are flat or
falling. No leak is visible yet and none is ruled out — the hour-scale
conclusion belongs to whoever reads the log later.

## Debt this closes and debt it leaves

Closed:

- an upgrade rehearsal across minor versions, on non-empty databases, with row
  counts and record identity reported;
- a real backup and restore drill, with the runbook written from the transcript;
- an `export_import` round trip proven end to end, with its one asymmetry named.

Still open from item 8:

- the hour-scale soak conclusion — the soak is running, the verdict is not in;
- one authorised real-Cloudflare-D1 smoke. Every D1 result in this repository
  still comes from local miniflare, which `CONTRIBUTING.md` states is not a
  substitute.

New, from this measurement:

- Legacy `team` rows written before schema 10 are unreadable and unexportable.
  Either ship the "explicit future rebinding migration" migration 10 anticipates,
  or state 0.2.0 as the supported data floor in the README and the release notes.
  Silence means an operator upgrading a 0.1.x store sees a successful migration
  and an empty memory.
- The logical export emits records the logical import rejects. Whatever the
  policy, the two halves should agree: either the exporter refuses to emit an
  unbindable legacy row, or the importer accepts it into a quarantine state.
- `docs/deployment/vps.md` says the logical export has "five NDJSON streams"
  and that format v3 "omits keys". Export format is now version 4 and there are
  six streams; `keys` is exportable with `export:all`. The doc is one release
  behind the code.
