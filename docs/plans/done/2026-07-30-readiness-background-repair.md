---
work_id: readiness-background-repair
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: CADIS
spec: docs/specs/done/2026-07-30-readiness-background-repair.md
---
# Plan

- [x] Thread scheduler ownership through the existing application context.
- [x] Derive Bun readiness from the exact timer-creation condition and mark Cloudflare scheduling external.
- [x] Add dual-runtime disabled/external contract assertions and a real Bun enabled-timer integration assertion.
- [x] Document the configuration-derived states and the issue #11 freshness boundary.
- [x] Run the aggregate local gate, package dry-run, workflow checks, and diff check.
- [x] Record evidence and move this pair to `done`.

## Acceptance evidence mapping

- AC-RBR-001: Bun maintenance integration test.
- AC-RBR-002: Bun/SQLite readiness contract case.
- AC-RBR-003: workerd/D1 readiness contract case.
- AC-RBR-004: shared capabilities implementation, contract assertions, and source inspection proving no readiness network call.

## Security, deployment, and rollback

No credential, migration, network probe, or maintenance behavior changes. Rollback removes the three-state context field and its assertions; canonical data is unaffected.

## Verification evidence

- Worker dry-run: PASS, 178.47 KiB upload / 38.07 KiB gzip.
- Dual-runtime API/SDK suite: 135 pass, 0 fail on a clean full run; the focused workerd/D1 readiness case also passes independently.
- Bun integration suite: 42 pass, 0 fail, including a real timer reporting `enabled` while automatic indexing succeeds.
- Live dashboard verifier: PASS; Astro build/browser: 10 pass; bundle 10.4 KiB gzip / 80 KiB.
- Workflow checker and self-test: PASS for 20 artifacts.
- `pnpm pack --dry-run`: PASS for `titen-memory@0.1.1`.
- `git diff --check origin/main...HEAD`: PASS.
- Repeated aggregate attempts also exposed the pre-existing Miniflare restart timeout/poisoned-stub cascade described in prior review; no retry, timeout, or assertion suppression was added. The same full suite passed cleanly once and all changed-path assertions pass independently.
