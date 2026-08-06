---
work_id: substitution-and-write-hygiene
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-08-06
updated: 2026-08-06
owner: ramaaditya
spec: docs/specs/active/2026-08-06-substitution-and-write-hygiene.md
review_after: 2026-08-20
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

`registry.modelcontextprotocol.io/v0/servers?search=titen` returns count 0 while
the reference server's README routes every discovery query there. First only
because it has a propagation delay. This is plumbing, not strategy; 12,700+
servers are already listed and the standalone effect is approximately zero.

- [ ] Publish to the official MCP registry.

### Week 1 — S1: zero-config local mode (days)

`src/runtime/bun/mcp-stdio.ts:44` throwing without `TITEN_MCP_URL` and
`TITEN_API_KEY` is the single line between Titen and every play below. Nothing
is reachable while trying Titen costs more than the incumbent's entire
lifecycle.

- [ ] `npx titen-memory mcp` with no environment opens or creates
      `~/.titen/memory.db`, auto-provisions org/workspace/project/owner as real
      rows, serves MCP over stdio in-process, FTS-only, no outbound call.
- [ ] The existing served mode and its auth path are untouched — an additional
      entry point, not a relaxation.
- [ ] If auto-bootstrap would require special-casing `assertTrustCeiling` or
      authorization inside `src/core/`, take the longer route and write real
      records. `src/core/`'s zero-external-import discipline is what keeps the
      Cloudflare runtime buildable and is not tradeable for a shortcut.

### Week 2 — S2: drop-in for the reference server (days)

The acquisition play. Ship as early as possible, because the kill criterion runs
60 days after it lands and the point is to learn early whether the pool is real.

- [ ] Serve the nine reference tool names alongside `titen_*`:
      `create_entities`, `create_relations`, `add_observations`,
      `delete_entities`, `delete_observations`, `delete_relations`,
      `read_graph`, `search_nodes`, `open_nodes`.
- [ ] Route `search_nodes` through Titen retrieval instead of a linear scan.
- [ ] Import an existing `memory.json` on first run from `MEMORY_FILE_PATH` or
      the working directory.
- [ ] Document the swap as a one-line diff in an MCP config. Claim a lossless
      substitute for a broken default; do not claim to beat the field.

### Week 2, same push — S5: concurrent-writer durability suite (hours)

S1 invites multiple agents onto one local SQLite file, so this cannot lag it.
Correctness, not accuracy — it sits outside the refuted race.

- [ ] Publish the invariants before running anything: exactly one claim per
      canonical hash, zero lost observations, no partial write survives a failed
      batch.
- [ ] N concurrent writers with identical and overlapping content, on both
      Bun/SQLite and D1 via the existing `test:d1` path.
- [ ] Publish Titen's own violations first. Record a system lacking a primitive
      as "primitive absent", never "fail".

### Week 3 — S3: close the two provenance holes (days)

Produces no visible feature, which makes it the first item cut under pressure.
**Cutting it invalidates S4.**

- [ ] Require `source.ref` on the HTTP write path. Breaking; ship as a minor
      bump and say so.
- [ ] `titen_compile` returns a server-issued context token; observations
      written under it are stamped `source.type: recalled`, unforgeable by the
      caller.
- [ ] Reject or flag `recalled` observations at consolidation so the loop is
      closed, not merely labelled.
- [ ] Runnable check that fails if a forged `recalled` write is accepted.

### Weeks 4-5 — S4: `titen audit` (days)

The strategic payload, and the only item that still pays off if S2's pool turns
out to be noise, because it runs against stores Titen does not own.

- [ ] `npx titen-memory audit <path>` over `memory.json`, a Mem0 export, or a
      Titen store.
- [ ] Five counts, each with per-item evidence a skeptic can check by hand:
      exact-duplicate, near-duplicate (same canonical hash), recall-loop,
      secret-pattern, stale-since-write.
- [ ] No network, no LLM, no upload. The report is a local file the user chooses
      to share.
- [ ] Publish Titen's own store's numbers — including whatever is embarrassing —
      in the same commit that ships the tool.
- [ ] Publish the detection rules before running them on anyone. Counterexamples
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
