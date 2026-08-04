---
work_id: operational-lifecycle-rehearsal-20260804
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
---

# Operational lifecycle rehearsal

## Outcome

Completed. `scripts/rehearse-upgrade.ts` seeds a store on a published
`titen-memory` release through that release's own HTTP API, upgrades it in place
with the working tree, runs `deploy/backup.sh` with a destroy and restore, and
round-trips the logical NDJSON export into a fresh store. Nine published
releases from 0.1.0 to 0.5.1 were rehearsed on `rama-tuf`. Every lane preserved
every canonical row. Two published limits and one script defect came out of it,
all recorded in `docs/testing/2026-08-04-operational-lifecycle.md`. An
hour-scale soak was started and left running.

## Problem

Strategic debt item 8 in `PONYTAIL-DEBT.md`. The longest observed Titen uptime
in any measurement was about five minutes. No upgrade had been rehearsed across
a minor version. Every store ever measured was freshly bootstrapped, so every
migration ever observed applied to an empty database — the one case where a
forward-only migration cannot lose anything. `export_import` reported as
`enabled` in readiness and had never been run end to end. `deploy/backup.sh`
existed and had never been executed against a store anyone then destroyed.

The risk is not theoretical. A migration that drops a row, a backup that cannot
be restored, or an export the importer rejects are all silent until the day they
are needed.

## Scope

- One new script, `scripts/rehearse-upgrade.ts`, using Bun and the standard
  library only. No new dependency, no new abstraction.
- One correction to `deploy/backup.sh` if the drill exposes a defect.
- Two documents: a dated testing record and a backup/restore runbook written
  from the transcript of the drill actually executed.
- A soak started on `rama-tuf` and deliberately left running past handoff.

Out of scope: Cloudflare D1, which needs an authorised real-account smoke;
multi-host restore; and the hour-scale soak verdict, which cannot be reached
inside one work session.

## Acceptance criteria

**AC-1 — Ubiquitous:** The rehearsal script shall seed a store through the
published release's own HTTP API, covering observations, multi-source claims,
a superseded claim, a disputed claim, a checkpoint, and a lease, before any
migration runs.

**AC-2 — Event-driven:** When the working tree migrates a populated store, the
rehearsal shall report the migration count applied, the row count of every table
before and after, and any identifier present before that is absent after.

**AC-3 — Unwanted behavior:** If a canonical row is lost, mutated, or rendered
unreadable by the upgrade, then the rehearsal shall report it rather than
succeed.

**AC-4 — Event-driven:** When the backup drill runs, it shall execute
`deploy/backup.sh` against a populated store, destroy the original, restore from
the backup, and compare the compiled claim identifiers before and after.

**AC-5 — Event-driven:** When the portability drill runs, it shall export every
record type, import into a freshly bootstrapped store, export again, and report
every source record that did not survive the round trip.

**AC-6 — State-driven:** While the soak is running, a sampler shall append
process resident memory, database size, and write-ahead-log size to a log file
once per minute.

**AC-7 — Ubiquitous:** No artifact shall contain an API key, credential,
prompt, memory content, or raw embedding.

## Verification

Nine rehearsal lanes on `rama-tuf`, one hand-run backup drill whose transcript
became the runbook, and a soak sampling once per minute into
`/tmp/titen-soak-20260804/samples.tsv`. Numbers, defects, and the limits of each
measurement are in `docs/testing/2026-08-04-operational-lifecycle.md`.
