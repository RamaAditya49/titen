---
work_id: mem0-replacement-benchmark-030
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-07-31
updated: 2026-07-31
review_after: 2026-08-14
owner: CADIS
spec: docs/specs/active/2026-07-31-mem0-replacement-benchmark-030.md
---
# Plan

- [ ] Freeze release/package/server provenance and audit current Mem0/Titen
  capability boundaries. (AC-MRB-001, AC-MRB-004)
- [ ] Build a versioned synthetic corpus, scorer, randomized trial manifest, and
  equivalent model/hardware configuration. (AC-MRB-005, AC-MRB-006, AC-MRB-007,
  AC-MRB-008, AC-MRB-011, AC-MRB-012)
- [ ] Install Titen 0.3.0 as an isolated loopback-only sidecar with real
  `embeddinggemma`, explicit backup, rollback, and smoke. (AC-MRB-002,
  AC-MRB-003, AC-MRB-009, AC-MRB-010)
- [ ] Run end-to-end memory, equivalent-fact retrieval, adversarial isolation,
  dependency failure, restart, backup/restore, performance, and resource trials
  against both systems. (AC-MRB-003, AC-MRB-005 through AC-MRB-012)
- [ ] Deduplicate and file evidence-backed issues for every confirmed failure or
  missing replacement gate. (AC-MRB-004, AC-MRB-013)
- [ ] Repeat focused trials after safe configuration corrections until results
  are stable; do not patch product defects under this benchmark work item.
  (AC-MRB-005, AC-MRB-009, AC-MRB-011, AC-MRB-012)
- [ ] Run the read-only Ponytail debt ledger and publish the replacement verdict,
  keeping this pair active while any cutover blocker remains. (AC-MRB-014,
  AC-MRB-015)

## Evidence mapping

- AC-MRB-001: npm metadata/tarball, peeled tag, runtime manifests, configuration
  fingerprints, artifact checksums.
- AC-MRB-002: pre/post Mem0 state, exact isolated paths/port/service/user, local
  denial/public denial, rollback proof.
- AC-MRB-003: readiness, real vector dimensions, semantic retrieval, injected
  outage and FTS fallback.
- AC-MRB-004: source/package inspection, runtime request trace, issue URL.
- AC-MRB-005: corpus and trial manifest with equivalent-condition validator.
- AC-MRB-006: language-neutral proposition and lifecycle scorer outputs.
- AC-MRB-007: raw ranked candidate lists and retrieval metric report.
- AC-MRB-008: cross-scope/prompt-injection fixtures and unchanged row counts.
- AC-MRB-009: dependency failure/recovery traces, job/outbox state, duplicate
  count.
- AC-MRB-010: backup, disposable restore, integrity, recall, RPO/RTO record.
- AC-MRB-011: ten-plus raw trials with confidence intervals and host telemetry.
- AC-MRB-012: machine-evaluated gate summary with no hidden failed metric.
- AC-MRB-013: existing-issue search and created/reused issue URLs.
- AC-MRB-014: fresh Ponytail marker ledger and no-trigger count.
- AC-MRB-015: unchanged Mem0 production service and explicit blocked/ready state.

## Security, migration, deployment, smoke, and rollback

- Use synthetic tenants/content only; redact credentials and raw provider output
  from logs, artifacts, and issues.
- Capture Mem0 service/container/database hashes and health before and after each
  remote change; never restart it for Titen testing.
- Bind Titen to a distinct loopback port with a distinct service account,
  database, vector database, config, logs, and backup directory.
- Store the Wulan client key only in a root-readable mode-`0600` environment
  file and use server-local 9router endpoints.
- Stop/disable only the Titen sidecar and restore its isolated directory on
  rollback. Production Mem0 paths and DNS are outside this plan.
- A future Mem0 import/cutover requires a separate active spec after this work
  records passing migration and sustained-soak evidence.
