---
work_id: operational-lifecycle-rehearsal-20260804
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
spec: docs/specs/done/2026-08-04-operational-lifecycle-rehearsal.md
---

# Operational lifecycle rehearsal plan

## Steps

- [x] Read `src/core/migrations.ts`, `src/core/portability.ts`,
  `src/core/authorization.ts`, and `src/runtime/bun/cli.ts` to take the real
  migration bookkeeping, export envelope, access predicate, and CLI surface
  rather than assume them.
- [x] Unpack published `titen-memory` tarballs and read each release's own route
  table and handler validation, so a seeding failure can be attributed to the
  release rather than blamed on the migration.
- [x] Write `scripts/rehearse-upgrade.ts`: one Bun file, no dependency. Seed
  through the published release's API, inventory the SQLite file directly before
  and after the migration, run the backup and restore drill, and round-trip the
  logical export.
- [x] Make the inventory compare identity, not just presence: every table, every
  row count, every `id`, and the full canonical column set of every claim and
  observation.
- [x] Reuse the published release's own API key against the upgraded store so
  credential survival is proven rather than assumed.
- [x] Make the harness tolerant of routes an older release does not have, so a
  missing endpoint reports as "not measured" instead of aborting the migration
  measurement.
- [x] Rehearse nine published releases on `rama-tuf`: 0.1.0, 0.1.1, 0.1.2,
  0.2.0, 0.2.1, 0.3.0, 0.4.0, 0.4.1, 0.5.1.
- [x] Run the backup drill by hand with literal shell commands and capture the
  transcript, so the runbook documents what was executed.
- [x] Reproduce and fix the relative-path checksum defect the drill exposed in
  `deploy/backup.sh`, then verify the fix with a relative invocation checked
  from a different working directory.
- [x] Start the soak on `rama-tuf` with a one-minute sampler and leave it
  running.
- [x] Write `docs/testing/2026-08-04-operational-lifecycle.md` and
  `docs/deployment/backup-restore.md`.
- [x] Run `node scripts/check-workflow-docs.mjs`.

## Acceptance evidence

- AC-1: each lane seeded 15 observations, 8 claims over 11 claim-source edges,
  one superseded claim, one disputed claim, one checkpoint, and one lease
  through the published release's own server.
- AC-2: migration counts 12, 12, 12, 11, 11, 9, 5, 4, 2 for the nine lanes; full
  before and after row counts recorded per lane in the rehearsal reports.
- AC-3: zero canonical rows lost and zero mutated in all nine lanes. The 0.1.x
  lanes reported 8 of 8 claims unreadable after the upgrade, which is exactly
  the failure AC-3 exists to surface; migration 10 fail-closes legacy team rows
  by design.
- AC-4: hand-run drill and all nine lanes restored to identical row counts,
  identical compiled claim identifiers, and identical evidence counts.
- AC-5: 0.2.0 and above round-tripped every source record with zero missing.
  The 0.1.x lanes exported 23 records the importer refused, which is reported
  rather than hidden.
- AC-6: `/tmp/titen-soak-20260804/samples.tsv` on `rama-tuf`, one row per
  minute, running past handoff.
- AC-7: the rehearsal keeps each bootstrap key in process memory and writes only
  identifiers, counts, and hashes. The soak stores its key in a mode-600 file
  outside the repository.

## Verification

Nine rehearsal lanes ran on `rama-tuf` with the working tree at commit
`a0033389`; every lane wrote a machine-readable report and all nine completed.
The backup drill ran by hand and its transcript is the runbook. The
relative-path checksum defect was reproduced before the fix and re-verified
after it. `node scripts/check-workflow-docs.mjs` passes for this pair.

## Deliberate omissions

- Cloudflare D1: needs an authorised real-account smoke, not miniflare.
- Multi-page export, actor mapping, and enrichment records: the corpus does not
  reach them. Named as unexercised in the testing document.
- Backup retention pruning: needs files older than the retention window.
- The soak verdict: the soak is running; the conclusion belongs to whoever reads
  the log.
