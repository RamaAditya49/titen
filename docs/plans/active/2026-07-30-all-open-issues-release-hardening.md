---
work_id: all-open-issues-release-hardening
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-07-30
updated: 2026-07-31
review_after: 2026-08-14
owner: CADIS
spec: docs/specs/active/2026-07-30-all-open-issues-release-hardening.md
---
# Plan

- [x] Freeze the live issue/PR/branch snapshot and preserve the dirty deployment
  worktree plus every branch with unique unabsorbed commits.
- [x] Make migrations atomic/recoverable and runtime startup fail closed; add
  canonical maintenance freshness and an explicit bounded Bun WAL policy.
- [x] Add workspace binding and one shared record-authorization predicate, then
  use it before retrieval, evidence, Atlas, export, event, and webhook projection.
- [x] Withdraw the incomplete v0.3 policy/channel routes, scopes, and verified
  maturity claims until their full security contracts have separate accepted work.
- [x] Fence lease, claim lifecycle, idempotency, and checkpoint operations at the
  shared application/SQL boundary used by REST and MCP.
- [x] Validate an entire import before one atomic commit, reject non-identical ID
  collisions and evidence-less claims, and keep canonical/FTS/provenance aligned.
- [x] Select bounded lexical terms without position bias and expose truncation
  diagnostics.
- [x] Harden webhook destination resolution and delivery claims/retries/timeouts,
  and replace canonical plaintext signing secrets with externally keyed
  authenticated ciphertext plus rotation/recovery documentation.
- [x] Align vector metadata/prefiltering before top-K across Vectorize and
  sqlite-vec, requeue rebuildable projections, and prove noisy-neighbor parity.
- [x] Remove duplicated domain SQL from MCP and add equivalent REST/MCP state,
  security, error, and capability tests.
- [x] Validate MCP Origin, protocol-version, no-SSE GET, and tool annotation
  behavior; replace stale integration claims with an official-source host matrix
  and record native adapter/public-directory deferrals in `PONYTAIL-DEBT.md`.
- [x] Add the reviewer workflow as a canonical read projection with stable
  pagination and existing fenced lifecycle actions; add no generic queue tables.
- [x] Replace the fail-open CLI parser path with a small local command/flag map and
  table-test help and malformed invocations for every documented command.
- [x] Harden SDK constructor/response parsing, add mutation idempotency options,
  and expose documented generic authenticated JSON/raw access plus a maintained
  typed-route capability matrix.
- [x] Make README repository references absolute and simplify pack verification
  to public behavior: pack, install, inspect README, and execute the installed bin.
- [x] Check in the verified loopback-only rootless deployment unit, reconcile or
  remove unverified helpers/limits, document remote access choices, and repeat
  current image/vector/WAL/live evidence.
- [x] Serialize or isolate the workerd restart fixture so the documented clean
  aggregate contract command has no disposed-instance cascade.
- [x] Run focused adversarial/fault tests, `pnpm test:all`, browser on an available
  configured port, workflow checker+self-test, route/docs checks, Worker dry-run,
  normal/custom-prefix pack verification, and installed-tarball CLI/SDK smoke.
- [x] Request and execute the explicit operator window for the `rama-tuf` reboot;
  capture boot, service, health, data-preservation, journal, and full live evidence.
- [ ] Commit the corrective diff with the required CADIS trailer, open, review,
  and merge the PR; enumerate exact branch/worktree cleanup targets and remove
  only merged or superseded ones.
- [ ] Post a specific root-cause/fix/evidence comment to every cutoff issue before
  closing it; leave no issue silently closed and re-snapshot for late arrivals.
- [x] Prepare version `0.2.0` and changelog, verify the exact main commit, publish
  npm through the maintainer approval URL, create the matching GitHub release, and
  verify public registry, dist-tag, package README, CLI, tag, release, Actions-off,
  and zero-open-PR state.
- [x] Reconcile #71 against the current lease contract, return `principal_id`
  from key creation with dual-runtime coverage for #72, and add the smallest
  sandbox HOME/XDG contributor guidance for #73.
- [ ] Run focused and full regression gates, publish the exact verified `0.2.1`
  patch to npm and GitHub, and smoke the public SDK/CLI artifact.
- [ ] Record exact evidence, mark every item complete, and move this pair to
  `docs/specs/done/` and `docs/plans/done/` in the terminal evidence commit.

## Acceptance evidence mapping

- AC-RH-001: per-statement migration fault injection, restart, concurrent-startup,
  and authenticated-route fail-closed cases on Bun/SQLite and workerd/D1.
- AC-RH-002: fresh/stale/disabled maintenance cases plus Bun timer and Cloudflare
  scheduled-handler integration evidence.
- AC-RH-003: bounded Bun WAL write/restart test and documented live measurements.
- AC-RH-004: same-org cross-workspace and paired-hidden-row dual-runtime cases
  covering context, evidence, Atlas, export, events, webhooks, and membership removal.
- AC-RH-005: route/scope inventory, negative requests, roadmap/FRD/API checks.
- AC-RH-006: 20-contender, renewal, non-holder release, and expired-race cases on
  both runtime adapters.
- AC-RH-007: second-half failure, collision, orphan, actor/trust/scope, FTS/history,
  and zero-partial-mutation import cases on both runtimes.
- AC-RH-008: cross-domain/private/self/cycle/concurrent lifecycle cases with
  unchanged relation/history/event/audit/outbox counts on failure.
- AC-RH-009: same-org/different-key, different concrete resource, normalized query,
  changed body, legacy-row, retention, and SDK replay cases.
- AC-RH-010: same-org/different-agent create/read/update/delete REST/MCP cases.
- AC-RH-011: head/tail marker, repetition/punctuation, and long-query bound cases.
- AC-RH-012: IPv4/IPv6/mapped/numeric/private DNS/rebinding/redirect/metadata and
  allowlist tests using injected resolver/fetch boundaries.
- AC-RH-013: 500-to-retry-to-200, terminal failure, timeout, crash recovery,
  concurrent drain, stable ID, pending-age, and oldest-retry evidence.
- AC-RH-014: ciphertext-only SQL/export inspection, missing/wrong key, rotation,
  legacy migration, and redaction tests.
- AC-RH-015: vector metadata adapter assertions, sqlite-vec noisy-neighbor test,
  shared contract parity, rebuild evidence, and live Vectorize smoke when bound.
- AC-RH-016: REST/MCP fixture comparing state, events, audit, errors, trust/scope,
  private/team, lease/checkpoint/handoff, and vector/degraded behavior.
- AC-RH-017: authorized hidden-item exclusion, deterministic eligibility,
  pagination/filter cursor, evidence/audit, and terminal lifecycle cases.
- AC-RH-018: table-driven CLI subprocess cases asserting status/output and no
  DB/WAL/listener/credential side effects.
- AC-RH-019: SDK constructor and injected-response matrix including JSON error,
  empty success, empty failure, HTML, and malformed JSON.
- AC-RH-020: captured-header mutation cases, live replay/conflict case, paginated
  events generic request, streamed export, auth-override denial, and matrix check.
- AC-RH-021: README-link scan and installed-bin smoke with normal and custom npm
  prefix; negative missing-bin fixture.
- AC-RH-022: checked-in unit inspection and install syntax, system/rootless path
  docs, SSH tunnel second-host probe, and removal or verified scope of helpers.
- AC-RH-023: before/after reboot event ID, user-service/container/health/journal,
  full live verifier, image history, actual size, sqlite-vec/model drain evidence.
- AC-RH-024: repeated clean aggregate API/SDK run through the documented command.
- AC-RH-025: merged commit, per-issue closure comments, branch deletion inventory,
  release gates, tag/GitHub/npm identity, dist-tag, public smokes, Actions-off, and
  zero open PR plus final late-issue snapshot.
- AC-RH-026: invalid/same-origin/missing Origin cases, unsupported/current/legacy
  protocol headers, authenticated `GET /mcp` 405, tool annotation assertions,
  official host-source links, and a complete Ponytail marker ledger.
- AC-RH-027: dual-runtime key-creation cases for caller-supplied and generated
  principal IDs, plus SDK handoff setup using the returned identity.
- AC-RH-028: contributor documentation check for an explicit temporary writable
  tool home outside the repository, with no runtime code or dependency change.

## Verification

- Merged implementation/release commits: `3971e3a`, `2bcfdab`, and exact
  release candidate `023fdd0fe2f78d9e67eb15ba66d35a4142e88b7a`.
- Local gates: 71 D1, 90 Bun/vector/SDK, 63 integration, 10 browser, workflow
  checker/self-test, route docs, dashboard adapter, Worker dry-build, and the
  six-stage real-tarball verifier all passed.
- Live gate: schema 10 and 4/4 wrapped federation secrets remained healthy;
  the approved reboot changed boot ID, auto-started the rootless user service
  with `NRestarts=0`, preserved 34 observations, 34 claims, 125 events and the
  recorded event ID, produced no warning-or-higher boot journal entry, and
  passed `scripts/verify-live.ts` with real `embeddinggemma` vectors.
- Reconciliation progress: all original 34 cutoff issues were closed only after
  individual explanatory comments. The late snapshot exposed #71-#73, which
  remain subject to the corrective tasks above.
  Remote branches contain only `main`; enumerated temporary worktrees and local
  branches were removed without modifying the user's original dirty checkout.
- Publication: tag `v0.2.0` resolves to `023fdd0`; npm `latest` resolves to
  `0.2.0` with SHA-1 `fe6826cbdb3f0210fe3b4cf53ef51ec44ee04c55` and passed
  clean registry SDK/CLI/README smokes; GitHub release
  `https://github.com/RamaAditya49/titen/releases/tag/v0.2.0` is public.
- Project policy remained intact: GitHub Actions stayed disabled and no
  workflow was added as a release gate.
- Late focused gates: the key response and handoff path passed 71 D1, 90
  Bun/vector/SDK, and 63 integration tests. A clean temporary HOME/XDG setup
  reached Wrangler's 221.73 KiB / 48.87 KiB dry-build successfully; workflow,
  route-documentation, build, and diff checks passed.

## Security, migration, deployment, and rollback

Migrations are additive and canonical data is never deleted; duplicate active
leases are deterministically released before adding a winner invariant. Team
rows without a trustworthy workspace binding become non-retrievable until
rebound. Projection/vector data is rebuildable and requeued. Plaintext signing
secrets require an operator-provided external key migration and fail closed when
unavailable.

Before merge, rollback is branch closure. Before npm publication, the release
commit/tag can be withheld. After publication, rollback is a newer corrective
release. Withdrawing incomplete v0.3 routes is intentional and documented as the
safe breaking change that requires `0.2.0`. The host reboot and firewall changes
are never attempted without the explicit operator decision described above.
