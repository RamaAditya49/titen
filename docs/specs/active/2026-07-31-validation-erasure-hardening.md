---
work_id: validation-erasure-hardening-20260731
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-07-31
updated: 2026-07-31
review_after: 2026-08-14
owner: CADIS
---
# Validation and erasure hardening

## Problem

Bounded authenticated input can still lose its nested field location, overflow
recursive serialization, create temporally invisible claims, or carry terminal
and bidirectional controls into memory. Operators also have no supported way to
remove leaked observation text without breaking provenance, search indexes, or
dependent claims. The npm artifact omits its security policy.

## Scope

Resolve issues #92, #99, #108, and #118, plus the JSON-depth half of #119. Add
one operator REST tombstone guarded by an explicit scope; do not expose erasure
as an ordinary MCP memory tool. Keep original content hashes and provenance,
redact readable observation and dependent-claim text, remove derived FTS rows,
and queue vector deletions atomically with audit/history/events. Add one shared
iterative JSON-depth guard, precise nested validation paths, safe-string checks,
sortable timestamps, temporal ordering, per-item untrusted markers, and package
`SECURITY.md`.

Foreign-key preflight and handoff schema work remains in the paired
collaboration-integrity slice. Model-based filtering, HTML escaping canonical
data, destructive row deletion, and a general validation framework are out of
scope.

## Acceptance criteria

- **AC-VEH-001 — Unwanted behavior:** If an authenticated JSON body exceeds the
  supported nesting depth, then Titen shall return a validation error before
  recursive hashing or serialization on both runtimes.
- **AC-VEH-002 — Event-driven:** When a required or nested field is invalid,
  Titen shall distinguish missing values from wrong types and identify the full
  field path without disclosing a foreign resource.
- **AC-VEH-003 — Unwanted behavior:** If a required or optional free-text field
  contains unsafe C0/C1 controls, bidi controls, or an unpaired surrogate, then
  Titen shall reject it while retaining tab and line-feed support.
- **AC-VEH-004 — Unwanted behavior:** If a timestamp normalizes outside the
  four-digit UTC range, or `valid_to` is not later than `valid_from`, then Titen
  shall reject the consolidation or import before mutation.
- **AC-VEH-005 — Event-driven:** When a credential with
  `observations:purge` tombstones an in-organization observation, Titen shall
  atomically replace readable observation text with a hash-bound marker, remove
  its FTS entry, redact and revoke dependent claims, remove their FTS entries,
  queue index deletes, and append content-free history, event, and audit proof.
- **AC-VEH-006 — Unwanted behavior:** If a credential lacks the purge scope or
  names another organization's observation, then Titen shall reveal no content
  or resource existence and shall mutate nothing.
- **AC-VEH-007 — Ubiquitous:** Every compiled claim and evidence item shall mark
  its content as untrusted structured data without rewriting canonical text.
- **AC-VEH-008 — Event-driven:** When the npm tarball is packed, it shall include
  `SECURITY.md`, README operator variables, and the documented compile-token
  range.

## Risks and done conditions

Erasure is irreversible for readable content, so the handler must preflight
scope and organization, commit every canonical and derived change in one batch,
and be idempotent after its tombstone history exists. Done requires focused and
dual-runtime authorization/data-loss regressions, import checks, route/workflow
validation, package inspection, and a clean diff check.
