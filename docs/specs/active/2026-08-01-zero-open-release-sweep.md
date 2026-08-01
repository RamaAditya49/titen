---
work_id: zero-open-release-sweep-20260801
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-08-01
updated: 2026-08-01
review_after: 2026-08-15
owner: CADIS
---
# Zero-open release sweep

## Problem

After the `0.4.0` release, the repository has 25 open issues, pull request #193,
and one remote topic branch. Several local worktrees also retain unique commits
or QA evidence. The reports span security, public SDK types, enrichment,
retrieval, Cloudflare and Bun runtime behavior, migration/cutover evidence, and
release gates. They must be resolved against current source rather than closed
from issue wording alone.

The repository intentionally does not use GitHub Actions because hosted
automation must not create repository cost. Verification and publication remain
explicit local maintainer operations.

## In scope

- Reproduce and classify issues #171, #182–#192, and #194–#206 against the
  current `origin/main` source and live issue acceptance criteria.
- Fix confirmed defects once at their shared root with the smallest focused
  regression that fails without the correction.
- Integrate valid work from pull request #193 and unique local commits only
  after independent review; close or supersede obsolete work with evidence.
- Keep authentication, scope, evidence, migration, recovery, and model-output
  boundaries fail closed on Cloudflare and Bun.
- Run the complete local release gate, publish the smallest valid SemVer npm
  release when public package source changes, and verify the immutable artifact.
- Close every resolved issue and pull request with exact evidence, remove merged
  remote topic branches, and safely archive before retiring unique local WIP.
- Preserve the user's dirty primary checkout and unrelated QA evidence until it
  is integrated or stored in a recoverable archive.

## Out of scope

- GitHub Actions, hosted CI/CD, or automated npm publication.
- New frameworks, queues, ORMs, provider factories, dependency-injection
  containers, or speculative architecture.
- Presenting the synthetic dashboard fixture as live memory-service evidence.
- Deleting unique uncommitted evidence without a recoverable archive.
- Weakening security, data integrity, quality floors, or release gates merely to
  reach a zero-open count.

## Constraints and risks

- Repository code, current runtime probes, and direct user instructions are
  authoritative; issue descriptions and memory are evidence leads only.
- npm publication is effectively irreversible, so pack/install/runtime checks
  must pass from the exact release commit before publication.
- Cross-runtime and migration changes can strand durable work or expose foreign
  scope; dual-runtime and adversarial checks are mandatory where applicable.
- Benchmark and production-cutover issues may close `NO-GO` only when their
  blocked state, preserved evidence, and next trigger are explicit; cancellation
  must not be presented as product success.

## Acceptance criteria

- **AC-ZERO-001 — Event-driven:** When each issue open at sweep start is
  evaluated against current `origin/main`, Titen shall record a reproducible
  fix, an already-fixed commit, an exact duplicate, or an evidence-backed
  terminal decision before the issue is closed.
- **AC-ZERO-002 — Unwanted behavior:** If a credential lifecycle field,
  database permission, streamed diagnostic, model completion, import record, or
  retrieval candidate violates its contract, then Titen shall fail closed
  without leaking secrets, widening scope, or committing unsafe semantic state.
- **AC-ZERO-003 — Event-driven:** When a public SDK consumer uses strict compiler
  options or reads readiness and event cursors, Titen shall expose package-owned
  runtime-compatible types and a non-spinning terminal iteration contract.
- **AC-ZERO-004 — State-driven:** While extraction or semantic maintenance is
  enabled, Titen shall use provider/runtime-supported requests, bounded timeouts,
  truthful readiness, durable lease recovery, and identical validation rules on
  Cloudflare and Bun.
- **AC-ZERO-005 — Event-driven:** When context candidates all fit the caller's
  budget, Titen shall preserve rank order; when the budget is constrained, Titen
  shall apply diversity without granting disputed claims a positive bonus or
  hydrating candidates outside the backend limit.
- **AC-ZERO-006 — Event-driven:** When release, comparison, calibration,
  rollback, soak, or live semantic gates execute, Titen shall test the current
  production contract and locked fixtures rather than stale schemas, versions,
  scopes, or zero quality floors.
- **AC-ZERO-007 — Event-driven:** When an authorized operator performs a
  replacement cutover, Titen shall support idempotent bulk import, a bounded
  delta pass, and a reconciliation checkpoint that exposes missing, extra, or
  mismatched canonical records before cutover approval.
- **AC-ZERO-008 — Unwanted behavior:** If shutdown interrupts leased background
  work, then Titen shall either await bounded completion or leave immediately
  reclaimable durable work and shall not report healthy readiness while the
  abandoned lease blocks recovery.
- **AC-ZERO-009 — Event-driven:** When documentation or release handoff commands
  are copied, Titen shall provide valid commands and a manual website handoff
  sourced from the release changelog without enabling GitHub Actions.
- **AC-ZERO-010 — Event-driven:** When the release candidate is finalized, Titen
  shall pass focused and complete local gates, package/install smokes, workflow
  checks, secret and dependency audits, and `git diff --check` from the exact
  candidate commit.
- **AC-ZERO-011 — Event-driven:** When package source changes reach `main`, the
  maintainer shall publish the smallest valid SemVer release manually, create
  matching tag and GitHub release metadata, and verify a clean registry install.
- **AC-ZERO-012 — State-driven:** While sweep cleanup runs, the original dirty
  checkout and unique QA artifacts shall remain byte-preserved or recoverably
  archived, and the final GitHub state shall contain only `main` with zero open
  issues and zero open pull requests.

## Done conditions

- Every starting and newly discovered issue or pull request has a verified
  terminal disposition and a linked GitHub comment.
- All acceptance criteria have reproducible evidence in the paired terminal
  plan; no unchecked plan item remains.
- Any required npm package, annotated tag, and GitHub release resolve to the
  exact reviewed commit and pass a clean install smoke.
- `git ls-remote --heads origin` reports only `refs/heads/main`; live GitHub
  queries report zero open issues and pull requests.
- The spec and plan move together to `done/` with terminal metadata.
