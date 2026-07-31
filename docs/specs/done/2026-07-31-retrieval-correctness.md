---
work_id: retrieval-correctness-20260731
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
---
# Retrieval correctness

## Problem

Current lexical compilation misses common word forms and Unicode input, lets
function words or neighboring subjects widen FTS work, and stops after three
claims of one kind even when the requested token budget has room. A context can
also repeat byte-identical active claim statements.

## Scope

Implement the shared root fixes for issues #83, #84, #85, #120, and #122, plus
context-output suppression for the byte-identical active-claim case in #101.
Keep canonical authorization after index lookup, preserve D1/Bun behavior, and
rebuild derived FTS data from canonical SQL. Write-time claim merge semantics,
IDF/provider machinery, and release work are out of scope. Regenerate the
Ponytail debt ledger after removing resolved retrieval markers.

## Acceptance criteria

- **AC-RET-001 — Event-driven:** When a schema-v10 database migrates forward,
  Titen shall rebuild both FTS projections from canonical rows with Porter
  stemming and indexed organization/subject scope, without changing canonical
  observations or claims.
- **AC-RET-002 — Ubiquitous:** Titen shall retrieve common plural and gerund
  variants through the shared lexical path on both D1 and Bun/SQLite.
- **AC-RET-003 — Event-driven:** When a task contains Unicode format characters,
  combining marks, or more than sixteen natural-language terms, Titen shall
  normalize the task safely, remove only a bounded English/Indonesian stopword
  set with an all-stopword fallback, and retain discriminating old/new terms.
- **AC-RET-004 — Unwanted behavior:** If matching text exists only under another
  organization or subject, then Titen shall scope the FTS MATCH before BM25 and
  shall still re-check canonical authorization before returning zero hidden
  candidates.
- **AC-RET-005 — Event-driven:** When a token budget fits more than three claims
  of one kind, Titen shall select one fitting item per available kind first and
  then fill remaining budget in deterministic rank order, while emitting no
  byte-identical active statement twice.
- **AC-RET-006 — Ubiquitous:** Titen shall implement this slice without a new
  dependency, write-time deduplication schema, or runtime-specific retrieval
  branch.
- **AC-RET-007 — Event-driven:** When resolved Ponytail markers are removed,
  Titen shall regenerate `PONYTAIL-DEBT.md` from every remaining source marker
  with matching totals and no stale #83, #84, or #85 entry.

## Risks and done conditions

The FTS rebuild is atomic per migration, canonical subject and visibility
predicates remain in retrieval SQL, and failures stay fail-closed. Done requires
focused query/packer/migration regressions, the shared contract on both
runtimes, workflow validation, and a clean diff check.

## Closure evidence

Schema-v10 backfill, query planning/shape, budget packing, and duplicate-output
regressions pass. The complete API suite passes on D1 and Bun/SQLite, including
vector and SDK coverage; the integration suite, workflow checker/self-test, and
diff check also pass. The debt ledger matches all 24 remaining markers, with no
marker lacking an upgrade trigger. No production or registry mutation was
performed.
