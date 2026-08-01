# Ponytail debt ledger

Generated from tracked Ponytail comment markers and re-audited on 2026-08-01. This is a
trigger-based ledger, not a backlog promise: keep each shortcut until its
source-owned ceiling or trigger is observed.

Run `pnpm check:ponytail` after moving, adding, or removing a marker. The check
is local and uses tracked Git content; it does not require hosted automation.

## Agent integration

| Location | Deliberate shortcut | Ceiling | Upgrade trigger |
| --- | --- | --- | --- |
| `docs/agent-plugins.md:128` | Keep the standalone ClawHub skill as the temporary public install surface | Installation requires a separate skill plus native MCP config merge | The upstream inspector sandbox recovers; publish the validated bundle from commit `1cc8823` and replace this path |
| `docs/architecture/agent-integration.md:128` | Ship host packages without lifecycle hooks | No automatic recall or flush | A measured host workflow needs it and a parity fixture covers failure behavior |
| `docs/architecture/agent-integration.md:129` | Use an operator-selected adapter for Pi instead of a custom extension | Pi has no built-in MCP client | The selected adapter is insufficient and a full process-authority review exists |
| `docs/architecture/agent-integration.md:130` | Defer vendor-specific public catalog submissions | No vendor-specific listing assets | A maintainer schedules the relevant vendor review |
| `plugins/claude/titen-memory/.clawhubignore:1` | Omit Claude's remote MCP file and use OpenClaw's native MCP config | OpenClaw requires the native config merge | OpenClaw bundle HTTP import ships |

## Core and runtimes

| Location | Deliberate shortcut | Ceiling | Upgrade trigger |
| --- | --- | --- | --- |
| `src/core/accounts.ts:42` | Throttle password failures in one service process | Multiple public replicas can bypass each other's local buckets | A deployment exposes more than one public API replica; add the platform edge rate-limit binding |
| `src/core/accounts.ts:124` | Reject a small local list of common and account-specific passwords | It does not cover a maintained breached-password corpus | Self-registration is introduced; add an offline maintained breach corpus without creating a network secret boundary |
| `src/core/context.ts:92` | Anchor compilation to the current time | Point-in-time recall is unavailable | A caller needs historical recall; accept and thread an optional `at` through retrieval (#118) |
| `src/core/db.ts:41` | Use one global SQL parameter chunk size | Wide lists multiply expensive statement round trips | A bounded query remains dominated by round trips after its SQL shape is fixed |
| `src/core/enrichment.ts:607` | Use one durable cursor per scope and pipeline instead of a queue framework | A fixed 100-row page must eventually cover old anchors | **No source trigger.** |
| `src/core/idempotency.ts:21` | Keep a fixed 24-hour replay window | A re-ingest after one day can duplicate every record | Re-sync must converge independently of the replay window; add statement/content-hash uniqueness (#101) |
| `src/core/indexing.ts:26` | Re-embed the current claim statement without tracking the indexed version | Repeated claim writes waste embedding calls | Store the indexed statement hash when measured repeated embeddings are material |
| `src/core/maintenance.ts:30` | Run one bounded organization-ordered pass per tick | A busy tenant can delay others within a tick | Measured delay breaches the maintenance freshness window; add per-organization cursors |
| `src/core/migrations.ts:10` | Keep migrations forward-only | A bad upgrade requires restore from a verified snapshot | Deployment review needs a preview; add `migrate --dry-run` while retaining the snapshot runbook (#116) |
| `src/core/tokens.ts:4` | Estimate one token per four characters | Accuracy is limited for non-Latin scripts and code | The configured provider exposes an exact model-tokenizer contract; retain this fallback |
| `src/core/validate.ts:43` | Cap lexical candidates at 200 | Matches beyond the fixed pool are unreachable | Recall evaluation shows a quality miss requiring a per-request limit |
| `src/core/vectors.ts:8` | Use one shared vector boundary and persisted fingerprint | No provider factory or readiness network probe | **No source trigger.** |
| `src/core/vectors.ts:864` | Detect canonical-only restore through an empty-index check without a second metadata protocol | Partial external index loss still requires the documented drain/query smoke | **No source trigger.** |
| `src/core/webhooks.ts:460` | Queue one bounded event page per pass | A large tenant backlog may need several passes | Measured backlog exceeds the maintenance freshness window; add per-organization cursors |
| `src/runtime/bun/server.ts:132` | Use one process, one database handle, and synchronous `bun:sqlite` on the main thread | Throughput is limited by one event-loop core | An equivalent-quality, durability-preserving small-team workload misses its accepted latency or throughput objective; profile before workers or read replicas (#123) |

## Benchmarks

| Location | Deliberate shortcut | Ceiling | Upgrade trigger |
| --- | --- | --- | --- |
| `scripts/benchmark-enrichment-model.ts:601` | Use locked lexical aliases as a deterministic contract scorer | It cannot judge free-form semantic quality | A free-form production corpus becomes a release gate; use blinded independent adjudication |

## Dashboard

| Location | Deliberate shortcut | Ceiling | Upgrade trigger |
| --- | --- | --- | --- |
| `scripts/dashboard-adapter.ts:107` | Keep dashboard sessions in one adapter process | Restart logs users out and multiple replicas cannot share sessions | A deployment needs multiple dashboard adapter replicas; add a shared encrypted session store |

## Summary

- Markers: 22.
- Markers without a source trigger: 3.
- Native agent work intentionally deferred: lifecycle hooks, a Pi MCP client
  extension, automatic OpenClaw bundle-to-remote-MCP import, and vendor-owned
  public catalog submissions.

## Audit notes — 2026-08-01

- All 22 tracked source markers still map one-to-one to this ledger; the local
  ledger checker passes.
- The forward-only migration marker names `migrate --dry-run` as its upgrade,
  but that command and its regression test now ship. Reword or retire this
  marker during the next source change; it is no longer an open implementation
  debt as written.
- The standalone ClawHub publication marker is ready for a bounded revalidation:
  upstream openclaw/clawhub#3327 is closed. Closure is not publication proof, so
  keep the fallback until the unchanged bundle passes a real hosted publish.
- The historical-context marker cites Titen issue #118, but that issue concerns
  timestamp validation rather than point-in-time recall. The behavioral ceiling
  remains real; repair the stale issue reference before treating it as scheduled
  work.
- The three no-trigger markers remain rot risks: enrichment cursor fairness,
  the intentionally narrow vector boundary, and partial external-index-loss
  detection need measurable source-owned triggers before implementation.
- Roadmap `Planned` rows and unchecked boxes inside cancelled or superseded work
  plans are not Ponytail debt. At audit start, canonical `origin/main` had zero
  active spec/plan pairs; five terminal plans retained 32 deliberately unmet
  historical checks.
