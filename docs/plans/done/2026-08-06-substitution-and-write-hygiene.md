---
work_id: substitution-and-write-hygiene
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-06
updated: 2026-08-08
owner: ramaaditya
spec: docs/specs/done/2026-08-06-substitution-and-write-hygiene.md
---

# Plan — substitution first, then the instrument

Six items. Every one is hours or days, deliberately: a single maintainer with no
CI who publishes by hand cannot carry a months-long item, and the two that
matter are cheap to try and structurally expensive for an incumbent to copy.

## Dependency spine

S1 unblocks S2 and S5. S2's `memory.json` parser is reused by S4. **S3 must land
before S4** or the recall-loop metric is self-declared and therefore worthless.
S6 gates only discovery.

## Sequence

### Week 0 — S6: list in the official MCP registry (hours)

`registry.modelcontextprotocol.io/v0/servers?search=titen` returned count 0 when
this plan was written, while the reference server's README routed every
discovery query there. It now returns count 1
(`io.github.RamaAditya49/titen-memory`, active, published 2026-08-07T05:33:16Z). First only
because it has a propagation delay. This is plumbing, not strategy; 12,700+
servers are already listed and the standalone effect is approximately zero.

- [x] Publish to the official MCP registry.

### Week 1 — S1: zero-config local mode (days)

`src/runtime/bun/mcp-stdio.ts:44` throwing without `TITEN_MCP_URL` and
`TITEN_API_KEY` is the single line between Titen and every play below. Nothing
is reachable while trying Titen costs more than the incumbent's entire
lifecycle.

- [x] `npx titen-memory mcp` with no environment opens or creates
      `~/.titen/memory.db`, auto-provisions org/workspace/project/owner as real
      rows, serves MCP over stdio in-process, FTS-only, no outbound call.
- [x] The existing served mode and its auth path are untouched — an additional
      entry point, not a relaxation.
- [x] If auto-bootstrap would require special-casing `assertTrustCeiling` or
      authorization inside `src/core/`, take the longer route and write real
      records. `src/core/`'s zero-external-import discipline is what keeps the
      Cloudflare runtime buildable and is not tradeable for a shortcut.

### Week 2 — S2: drop-in for the reference server (days)

The acquisition play. Ship as early as possible, because the kill criterion runs
60 days after it lands and the point is to learn early whether the pool is real.

- [x] Serve the nine reference tool names alongside `titen_*`:
      `create_entities`, `create_relations`, `add_observations`,
      `delete_entities`, `delete_observations`, `delete_relations`,
      `read_graph`, `search_nodes`, `open_nodes`.
- [x] Route `search_nodes` through Titen retrieval instead of a linear scan.
- [x] Import an existing `memory.json` on first run from `MEMORY_FILE_PATH` or
      the working directory.
- [x] Document the swap as a one-line diff in an MCP config. Claim a lossless
      substitute for a broken default; do not claim to beat the field.

### Week 2, same push — S5: concurrent-writer durability suite (hours)

S1 invites multiple agents onto one local SQLite file, so this cannot lag it.
Correctness, not accuracy — it sits outside the refuted race.

- [x] Publish the invariants before running anything: exactly one claim per
      canonical hash, zero lost observations, no partial write survives a failed
      batch.
- [x] N concurrent writers with identical and overlapping content, on both
      Bun/SQLite and D1 via the existing `test:d1` path.
- [x] Publish Titen's own violations first. Record a system lacking a primitive
      as "primitive absent", never "fail".

### Week 3 — S3: close the two provenance holes (days)

Produces no visible feature, which makes it the first item cut under pressure.
**Cutting it invalidates S4.**

- [x] Require `source.ref` on the HTTP write path. Breaking; ship as a minor
      bump and say so.
- [x] `titen_compile` returns a server-issued context token; observations
      written under it are stamped `source.type: recalled`, unforgeable by the
      caller.
- [x] Reject or flag `recalled` observations at consolidation so the loop is
      closed, not merely labelled.
- [x] Runnable check that fails if a forged `recalled` write is accepted.

### Weeks 4-5 — S4: `titen audit` (days)

The strategic payload, and the only item that still pays off if S2's pool turns
out to be noise, because it runs against stores Titen does not own.

- [x] `npx titen-memory audit PATH` over `memory.json`, a Mem0 export, or a
      Titen store.
- [x] Five counts, each with per-item evidence a skeptic can check by hand:
      exact-duplicate, near-duplicate (same canonical hash), recall-loop,
      secret-pattern, stale-since-write.
- [x] No network, no LLM, no upload. The report is a local file the user chooses
      to share.
- [x] Publish Titen's own store's numbers — including whatever is embarrassing —
      in the same commit that ships the tool.
- [x] Publish the detection rules before running them on anyone. Counterexamples
      in the Jepsen shape; never a leaderboard, never a composite score.

## Not in this plan

The refusals in the spec's non-goals, plus the `memory_20250818` backend, which
does not enter the queue until its trigger fires: S2 landed **and** either ≥10
external MCP configs appear, or someone files a request for a serverless
memory-tool backend.

## Honest odds

Shipping S1+S2+S5+S6: high. Kill criterion 1 passing: roughly a third. Three
external `titen audit` write-ups by 2027-02-01: low, and it is the
highest-variance, highest-value item — if it lands, Titen becomes the instrument
rather than a competitor, which is a position nobody takes by shipping features.

Most likely outcome: all six ship, all six work, and almost nobody notices. At
that point the kill criteria fire and the correct answer is to stop investing
and keep Titen as a well-built library its author uses. That costs about six
weeks and leaves a smaller, more honest codebase behind.

## Acceptance evidence

Audited against source on 2026-08-08, after the boxes had sat unticked through
two releases. Every item is proven in code or by a live check, not by its
commit message; the load-bearing tests were re-run during the audit.

- **S1 zero-config local mode** — `src/runtime/bun/mcp-stdio.ts:386` falls
  through to `runLocalMcpStdio` when neither `TITEN_MCP_URL` nor
  `TITEN_API_KEY` is set; `provisionLocalOwner` writes real org/workspace/
  membership/project rows in one batch under fixed ids, so a race loses on the
  primary key instead of splitting the store. The served path still requires
  both variables. No `assertTrustCeiling` special-case was added.
  `tests/integration/local-mode.test.ts` green.
- **S2 reference-server drop-in** — all nine compat names in
  `src/core/mcp.ts:853-866`, served alongside the native `titen_*`;
  `search_nodes` calls `POST /v1/context/compile` (`:824`), not a scan;
  `memory.json` import replays through the same tools behind an
  `.imported` marker. One-line swap documented in `docs/reference/api.md`.
  `tests/contract/mcp-compat.test.ts` 6/6.
- **S3 provenance** — `source.ref` mandatory at
  `src/core/observations.ts:130` and shipped as the breaking 0.7.0 entry;
  compile returns `context_token`; a declared `recalled` and an unrecognized
  token are both refused; consolidation refuses recalled evidence
  (`src/core/claims.ts:166`). The runnable check lives in the shared
  `tests/contract/cases.ts`, so it runs on **both** runtimes.
- **AC-SUB-001** — `src/runtime/bun/mcp-stdio.ts:386` takes the no-environment
  branch; `openLocalStore` (`:210-235`) creates `~/.titen`, migrates, and builds
  the app with no `vectors` argument (FTS-only) and no bound socket;
  `provisionLocalOwner` (`:153-200`) writes organization, workspace, membership
  and project as ordinary rows.
- **AC-SUB-002** — no local-mode branch exists in any `assertTrustCeiling` call
  site, and `src/core/**` still has exactly one non-relative import
  (`version.ts` reading `package.json`), so the zero-external-import discipline
  held.
- **AC-SUB-003** — the nine compat names are registered in `COMPAT_HANDLERS`
  (`src/core/mcp.ts:853-866`) beside the native tools, and `compatSearchNodes`
  (`:816-843`) calls `POST /v1/context/compile` at `:824`.
- **AC-SUB-004** — `referenceMemoryPath` (`src/runtime/bun/mcp-stdio.ts:252-258`)
  resolves `MEMORY_FILE_PATH` then the working directory, and
  `importReferenceMemory` (`:290-342`) replays every record through the same MCP
  tools under a `.imported` marker so a second start cannot double-import.
- **AC-PROV-001** — `requireString(source, "ref", ...)` at
  `src/core/observations.ts:130`, shipped as the breaking 0.7.0 entry.
- **AC-PROV-002** — `POST /v1/context/compile` returns `context_token`
  (`src/core/context.ts:291`); the stamp is applied only by the server
  (`observations.ts:157`) after `isIssuedContextToken` confirms the row.
- **AC-PROV-003** — a caller-declared `recalled` is rejected outright and an
  unrecognized token fails closed (`observations.ts:149-156`); consolidation
  refuses recalled evidence (`src/core/claims.ts:166`). The dual-runtime case
  "recalled provenance is server-issued, unforgeable, and closes the loop"
  (`tests/contract/cases.ts`) asserts all four rejections.
- **AC-AUDIT-001** — `titen audit` over a store path reports the five rates
  (`src/runtime/bun/audit.ts:32-36`) each with per-item evidence
  (`:457-510`), over a reference-server store, a Mem0 export, or a Titen
  store — all three covered by `tests/integration/audit.test.ts` — with no
  network call, asserted by "the installed CLI produces a report without
  touching the network".
- **AC-AUDIT-002** — a store lacking a signal is rendered `unmeasurable`
  (`src/runtime/bun/audit.ts:503`), never a zero and never a failure; the five
  counts are reported separately with no composite anywhere in the report, and
  `tests/integration/audit.test.ts` covers the unrecognised-file path
  ("refuses a file it cannot recognize instead of reporting zeros").
- **AC-DUR-001** — `assertConcurrentWriterDurability`
  (`tests/contract/durability.ts`) asserts one claim per canonical hash, zero
  lost observations, and `partial_rows == 0` after a failed batch; it is
  imported by `tests/contract/cloudflare-d1.test.ts` ("D1 holds the durability
  invariants under concurrent writers") and by `tests/integration/durability.ts`
  for bun:sqlite, including an eight-process lane on one file. Measured in the
  audit run: 6 writers / 24 requests / 4 created / 20 replayed / 0 failed, and
  104 requests / 20 created / 84 replayed / 0 failed across eight processes.
- **S4 `titen audit`** — `src/runtime/bun/cli.ts:236` over
  `src/runtime/bun/audit.ts`; exactly five counts, per-item evidence, a
  missing signal reported as `unmeasurable` rather than zero; three input
  formats covered by `tests/integration/audit.test.ts`; rules published in
  `docs/reference/audit.md`; Titen's own numbers published in the same commit
  (`docs/testing/2026-08-07-titen-audit-self-report.md`).
- **S5 concurrent-writer durability** — invariants stated before the run in
  `tests/contract/durability.ts`; the same harness is imported by the D1
  contract suite and by an integration lane that uses eight separate OS
  processes on one file; `docs/testing/2026-08-07-durability.md` publishes
  Titen's own violation and records absent primitives as absent.
- **S6 registry listing** — live: `search=titen` returns count 1,
  `io.github.RamaAditya49/titen-memory`, active, published
  2026-08-07T05:33:16Z, with `mcpName` present on the npm versions the
  registry checks.

Three stale or false statements outlived the code and were corrected in the
closing commit: `CHANGELOG.md` called the context token a "Stateless HMAC"
while `src/core/observations.ts:82-88` says "Deliberately not an HMAC" and
implements a `context_runs` primary-key lookup; `README.md` and
`docs/deployment/mcp-registry.md` both still said Titen was not listed. The
registry doc also gained a **Refreshing the listing** section, because the
entry is a snapshot of `server.json` and trails npm `latest` until republished.

## Verification

`pnpm check:workflow` green. Contract suite 113/113 on bun-sqlite including
the forged-`recalled` case; mcp-compat 6/6; local-mode + audit + durability
11/11. Registry status verified live against
`registry.modelcontextprotocol.io`.
