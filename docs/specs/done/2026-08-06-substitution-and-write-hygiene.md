---
work_id: substitution-and-write-hygiene
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-06
updated: 2026-08-08
owner: ramaaditya
---

# Stop competing on retrieval; become the substitute and the instrument

## Problem

The 2026-08-04/06 benchmark programme settled what Titen can and cannot claim,
and the answer removes the strategy the project was implicitly pursuing.

Retrieval accuracy is refuted as a wedge. Titen FTS+vector beats a
hundred-line dense control (35/12/453, p = 0.0011) but is indistinguishable from
Mem0's LLM-free mode (3/4/53, p = 1.0), and answer accuracy is a flat null across
eight pre-registered comparisons. At the top of this table everyone is inside
everyone else's noise.

The assets assumed to be uncontested are not. A competitor publishes Titen's
governance differentiators by name in an arXiv paper with a university co-author
and has ~45x the stars. The 2026 concurrency literature argues against leases,
and zero issues across mem0, Letta, or Cognee request locking primitives. A
5,873-star single Go binary tells the zero-dependency story with better
packaging than a Bun runtime and a `pnpm install`.

Two things survive that subtraction.

**A substitution gap.** `@modelcontextprotocol/server-memory` takes ~441,501
downloads a month while Anthropic's own README calls it "an educational
reference implementation, not production-ready software". We measured it at
recall@1 0.050 against Titen's 0.900 — the only non-noise gap in the entire
programme. Its whole state is one `memory.json` behind nine named tools, which
makes replacing it a substitution, not a race. But Titen currently demands
*more* setup than the thing it outperforms: `src/runtime/bun/mcp-stdio.ts:44`
throws without `TITEN_MCP_URL` and `TITEN_API_KEY`.

**An unmeasured failure mode.** The most frequently reported pain in agent
memory is write-side accumulation, not retrieval. The one public audit found
97.8% of 10,134 entries were junk after 32 days, over half of it the system
re-extracting its own recalled output. Upgrading the extraction model moved that
only to 89.6%. No benchmark measures it, and Titen's mandatory-provenance write
path is shaped to constrain exactly that mechanism — but the claim is currently
unprovable, because provenance is caller-declared and unverified.

## Non-goals

Recorded so they are refused deliberately rather than drifted into.

- Any further retrieval or answer-accuracy lane. Both are refuted by our own
  pre-registered measurements.
- More governance, federation, or org-hierarchy code. 2,210 lines already aim at
  a procurement process that will not open for a 9-star repo with no audit.
- More coordination primitives, and leases as a headline anywhere. Keep the
  code; never lead with it.
- "Zero dependencies" as the acquisition pitch. It is a supporting fact for the
  deployment envelope, not a wedge.

## EARS acceptance criteria

- **AC-SUB-001 — Event-driven:** When `npx titen-memory mcp` is invoked with no
  environment configured, Titen shall create or open a local store, provision a
  real organization, workspace, project and owner principal as ordinary rows,
  and serve MCP over stdio without an HTTP hop, an API key, or an outbound
  network call.
- **AC-SUB-002 — Unwanted-behaviour:** If auto-provisioning cannot satisfy
  `assertTrustCeiling` or the authorization predicates honestly, then Titen
  shall write the real records rather than special-case them, and
  `src/core/**` shall retain zero external imports.
- **AC-SUB-003 — Event-driven:** When a caller invokes any of the nine
  `@modelcontextprotocol/server-memory` tool names, Titen shall serve them
  against observations and claims, with `search_nodes` routed through Titen
  retrieval rather than a linear scan.
- **AC-SUB-004 — Event-driven:** When a `memory.json` is present at
  `MEMORY_FILE_PATH` or in the working directory on first run, Titen shall
  import it without data loss.
- **AC-PROV-001 — Ubiquitous:** Titen shall require `source.ref` on the HTTP
  write path, matching the obligation the MCP tool spec already states.
- **AC-PROV-002 — Event-driven:** When an observation is written while carrying
  a context token issued by `titen_compile`, Titen shall stamp it with a
  server-assigned `source.type` of `recalled` that the caller cannot forge or
  override.
- **AC-PROV-003 — Unwanted-behaviour:** If a caller submits an observation
  declaring `recalled` provenance it was not issued, then Titen shall reject the
  write, and a runnable check shall fail if such a write is accepted.
- **AC-AUDIT-001 — Event-driven:** When `titen audit PATH` is run against a
  `memory.json`, a Mem0 export, or a Titen store, Titen shall report
  exact-duplicate, near-duplicate, recall-loop, secret-pattern, and stale rates,
  each with per-item evidence, without any network call or upload.
- **AC-AUDIT-002 — Unwanted-behaviour:** If a store lacks the signal a metric
  needs, then Titen shall report it as "not measurable from this export" and
  shall not report it as a failure or fold it into a composite score.
- **AC-DUR-001 — Event-driven:** When N writers concurrently submit identical
  and overlapping content on either runtime, Titen shall hold exactly one claim
  per canonical hash, lose zero observations, and leave no partial write from a
  failed batch.

## Falsification

Written before the work so it cannot be rationalised afterwards. Each is
checkable by a hostile third party using public tools.

- **2026-11-01, 60 days after substitution ships.** Fewer than 10 distinct
  non-maintainer GitHub accounts with `titen-memory` in a committed MCP config
  kills the substitution play. The response is to stop investing in
  distribution and say publicly that the download pool was noise.
- **90 days after the audit tool ships.** Fewer than 5 distinct external runs
  and zero published numbers kills the write-hygiene wedge. The honest
  conclusion is then that Titen is a well-engineered library with no market.
- **Continuous.** If Anthropic ships ranked search in the reference server, or a
  lighter competitor ships the nine tool names and `memory.json` import first,
  or any incumbent publishes their own junk-rate audit, the corresponding play
  is foreclosed and we say so rather than argue methodology.

If all three read zero by 2027-02-01, the correct output is a written
post-mortem stating the category cannot be entered from here — not a v0.7
roadmap.

## Evidence

Measured results in [`docs/testing/EVALS.md`](../../testing/EVALS.md) and
published at [titen.dev/benchmark](https://titen.dev/benchmark). Landscape survey
in
[`docs/research/2026-08-04-memory-agent-landscape.md`](../../research/2026-08-04-memory-agent-landscape.md).
