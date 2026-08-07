# Concurrent-writer durability

Date: 2026-08-07

Verdict: **the canonical write path holds all three invariants on both runtimes,
and Titen's own MCP compatibility surface violates the first one**

Three invariants were written down before anything was run. Two runtimes and
three lanes were then measured against them, and each invariant was falsified on
purpose by removing the primitive that upholds it, so that a passing result means
something. The canonical path — `POST /v1/observations` and
`POST /v1/consolidations` — held every invariant in every lane. The reference-server
compatibility surface added for the substitution play does not: six concurrent
identical `create_entities` calls leave six permanent copies. That is published
here first, before any result that flatters us.

This is a correctness claim, not an accuracy claim. Nothing in this document
touches retrieval quality, and none of it should be read as a ranking result.

## The invariants, declared before the run

- **I1 — exactly one claim per canonical hash.** N writers submitting
  byte-identical content converge on one record identity. A duplicate here is
  permanent damage: nothing downstream removes it, and every later read pays for
  it. Scoped, precisely, to `(org_id, actor_id, canonical_hash)` — see
  "Where the primitive is absent".
- **I2 — zero lost observations.** Every concurrent submission either creates its
  record or replays the record that won. No submission returns success without a
  durable row, and every distinct payload survives the burst.
- **I3 — no partial write survives a failed batch.** A write whose batch fails
  leaves no observation, no FTS projection, no history row, no event, no outbox
  work and no idempotency receipt behind.

A system that has no primitive for one of these is recorded as **primitive
absent**, never as "fail". The distinction is used below, and it applies to
Titen: one input shape has no canonical hash at all, and that is reported as
absence rather than as a failure to dedup.

## What the invariants are testing

`src/core/db.ts:4` states the structural position, and it was verified rather
than assumed:

> D1 has no interactive transactions, so every atomic write in Titen is expressed
> as a statement batch that the driver commits all-or-nothing.

The consequence is that dedup cannot be a networked read-then-write. It is a
partial unique index — `observations_canonical_replay` and
`claims_canonical_replay`, added in migration 15 (`src/core/migrations.ts:1333`)
— evaluated by the database inside the same atomic batch as the insert.

There *is* a read-then-write check in front of it
(`src/core/observations.ts:123`, `src/core/claims.ts:224`). It is a fast path,
not the safety mechanism. When it loses the race, the batch fails on the unique
index and the handler re-reads the winner and replays it
(`src/core/observations.ts:242`, `src/core/claims.ts:374`). The falsification
section below removes the index and shows the fast path alone is worth nothing
under concurrency.

## Locked method

| Field | Value |
| --- | --- |
| system under test | `titen-memory` 0.6.1, commit `5470a048748396503d6d33e1fab7feec27765f39`, plus the two test files below |
| shared assertions | `tests/contract/durability.ts`, SHA-256 `a79647c6a56ee6850cc64631bb6b68ea3d24105cb1c7bdaf149146cf1dc7b444` |
| Bun lanes | `tests/integration/durability.test.ts`, SHA-256 `46261bbbe7b8df44979547450294a2f257bd9f35fa247f80e447002c04ae0e43` |
| D1 lane | `tests/contract/cloudflare-d1.test.ts`, last case, via `pnpm test:d1` |
| Bun host | Bun 1.3.13, AMD Ryzen AI 9 HX 370, 24 threads, Linux 7.0.0-28-generic, NVMe |
| D1 host | `rama-tuf`, Bun 1.3.14 / Node v24.18.0, workerd via Miniflare, AMD Ryzen 9 8945H, 16 threads, Linux 7.0.12-201.fc44 |
| lane | FTS-only. No embedding provider, no vector store, no extraction model. |

The compatibility-surface finding was measured against the same checkout with
the in-flight MCP substitution work applied but not committed:
`src/core/mcp.ts`, SHA-256
`0a800e0234f2ce88da43bc8279ddb802684c07a19e13164510b991809dddda2a`. It is
therefore a finding about work in progress, reported early because that is when
it is cheap to fix, and it is not a statement about any released version.

Three lanes, because one of them is weaker than it looks:

1. **Bun, in process.** Six app instances over one `bun:sqlite` connection,
   twenty-four concurrent observation submissions across four payloads, then six
   concurrent identical consolidations.
2. **Bun, across processes.** Eight operating-system processes, separate
   connections, one WAL file — the shape zero-config local mode creates when
   several agents share `~/.titen/memory.db`. A wall-clock barrier per payload
   aligns the first touch of each one across all eight processes.
3. **Cloudflare D1.** The same shared assertions from lane 1, against a real
   `workerd` D1 database through the driver in
   `src/runtime/cloudflare/d1.ts`.

## Results

Every lane holds I1, I2 and I3. No submission was rejected in any lane.

| Lane | Writers | Requests | Rows created | Replays | Failures | Rows left by the failed batch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Bun, in process — observations | 6 | 24 | 4 | 20 | 0 | 0 |
| Bun, in process — consolidations | 6 | 6 | 1 | 5 | 0 | 0 |
| Bun, 8 processes — observations | 8 | 104 | 20 | 84 | 0 | not run in this lane |
| Cloudflare D1 — observations | 6 | 24 | 4 | 20 | 0 | 0 |
| Cloudflare D1 — consolidations | 6 | 6 | 1 | 5 | 0 | 0 |

Row counts were checked against the database, not against the responses: for the
in-process and D1 lanes, four observations, four distinct canonical hashes, four
FTS rows, four history rows and four `observation.appended` events, from
twenty-four concurrent submissions; one claim, one claim source, one claim FTS
row and one history row from six. The cross-process lane leaves twenty rows —
twelve shared payloads plus one private payload per process — with twenty
distinct canonical hashes and twenty FTS and history rows, from 104 requests.
I3 is asserted by snapshotting six table counts before a deliberately broken
batch and re-reading them after.

### Did the race actually open?

A durability suite that never provokes the race proves nothing, so every lane
counts the batches the unique index rejected. This number is instrumentation,
not an assertion.

| Lane | Canonical collisions observed |
| --- | --- |
| Bun, in process — observations | **0** |
| Bun, in process — consolidations | 5 of 5 possible |
| Bun, 8 processes — observations | 2, 6, 8, 13, 14, 15 across six runs |
| Cloudflare D1 — observations and consolidations | 25 of 25 possible |

The zero is the honest part. On `bun:sqlite`, twenty-four concurrent observation
submissions issued from one event loop **serialise**: tracing the driver shows
writer 0 completing its select *and* its insert before writer 1's select runs.
The in-process Bun lane therefore exercises the fast path for observations, not
the race, and it would pass even with the unique index removed. It is reported
as a weaker result rather than folded into a pass.

Consolidations do race in the same lane — all five losers collided — and on D1
every possible collision occurred, because each `all()` there is a real round
trip into `workerd` and the requests genuinely interleave. The cross-process Bun
lane is the one that matters for local mode, and it opens the window between two
and fifteen times per run depending on scheduling.

## Falsification: removing the primitive

Each invariant was re-run with the mechanism that upholds it removed. A suite
that cannot fail is not evidence.

| Removed | Lane | Result |
| --- | --- | --- |
| `observations_canonical_replay`, `claims_canonical_replay` | Bun, in process | **I1 violated** — six concurrent consolidations minted six claims |
| `observations_canonical_replay` | Bun, 8 processes | **I1 violated** — shared payload 0 minted four identities |
| both indexes | Cloudflare D1 | **I1 violated** — six concurrent writers minted six identities for one payload |
| batch atomicity (each statement committed on its own) | Bun, in process | **I3 violated** — the failed batch left rows behind |

The D1 result is the load-bearing one. It is the mem0 duplicate class reproduced
exactly — concurrent writers, identical content, a read-then-write check in
front, permanent duplicates behind — and the only difference between the failing
run and the passing one is a partial unique index evaluated inside the atomic
batch.

## Titen's own violation: the MCP compatibility surface

Publishing this first was the rule set before the work started.

The nine reference-server tool names added for the substitution play dedup
entities, observations and relations by reading the graph and skipping what is
already present (`loadCompatStore` in `src/core/mcp.ts`). The rows they write
carry `source: { type, ref }` with **no `id`**, so `canonical_hash` is `NULL`
(`src/core/observations.ts:107`) and the partial unique index does not apply to
them. The read-then-write check is all there is.

Measured, on the working tree named in the method table:

| Call | Repetitions | Result |
| --- | --- | --- |
| `create_entities`, identical | 3 sequential | correct — one entity, one observation |
| `add_observations`, identical | 3 sequential | correct — one observation |
| `create_entities`, identical | 6 concurrent | **6 duplicate observations**, all `canonical_hash NULL` |
| `add_observations`, identical | 6 concurrent | **6 duplicate observations** |
| `create_relations`, identical | 4 concurrent | **4 duplicate relations** |

No call returned an error. `read_graph` afterwards shows the entity carrying its
single observation six times over, and nothing removes them later. Sequential
use is clean, so this is a pure time-of-check-to-time-of-use race, not a broken
filter.

Two things make it worth fixing before the substitution ships rather than after.
The reference server this path replaces deduplicates `add_observations` against
the contents already on the entity, so a client that switches to Titen gets a
*regression* on the one hygiene guarantee the incumbent does offer. And the whole
premise of the write-hygiene wedge is that Titen does not mint the duplicates it
proposes to audit for.

The fix is structural and small: give the compat writes a stable `source.id`
derived from the entity name and content, which is exactly the field the
canonical path uses, and the same index that carries the three lanes above
carries this one too. It was not applied here — `src/core/mcp.ts` belongs to the
substitution work in flight, and a durability report is the wrong place to edit
someone else's write path.

This finding is deliberately **not** in the automated suite: landing a red test
in a shared tree blocks the work that has to fix it. Reproduce it with the block
at the end of this document.

## Where the primitive is absent

Not everything Titen writes has a canonical hash, and calling that a dedup
failure would be dishonest. Two shapes, both measured:

- **No `source.id`, no canonical hash.** `src/core/observations.ts:107` assigns
  `canonical_hash` only when `source.id` is present. Six concurrent identical
  writes without it produced six rows, all `canonical_hash NULL`, all `201`. This
  is **primitive absent**, not a violation of I1 — there is no canonical hash for
  a second row to collide with. It is also the mechanism behind the
  compatibility-surface finding above, and it applies to any MCP caller that
  omits `source_id`, which `titen_observe` accepts as optional.
- **Dedup is per actor, not per organisation.** The index is
  `(org_id, actor_id, canonical_hash)`. Two agents in one organisation writing
  byte-identical content produce two rows, by design: provenance is per actor and
  collapsing it would erase who observed what. I1 is scoped accordingly
  throughout this document.

## What this run does not show

- **No incumbent was run.** No mem0, no reference server, no MemPalace. Every
  number here is Titen's own. Nothing in this document is a comparison, and the
  motivating claims about other projects' open issues were not re-verified here.
- **No real Cloudflare.** The D1 lane is `workerd` under Miniflare against a
  local D1 database — the same bundle `wrangler` deploys, but not the production
  service, and not its distributed concurrency.
- **One host per runtime, small N.** Six in-process writers, eight processes,
  seconds of wall clock. No soak, no crash-injection, no power-loss test; `PRAGMA
  synchronous = FULL` is trusted rather than demonstrated.
- **No process-level I3.** The cross-process lane asserts I1 and I2 only. The
  failed-batch invariant is asserted in the in-process and D1 lanes, where the
  fault can be injected into a real write batch.
- **The in-process Bun observation lane did not race.** Stated above; it is not
  evidence about the unique index on that runtime.
- **Canonical writes only.** Import, purge, lifecycle, governance, federation and
  the enrichment queue have their own concurrency behaviour and are not covered.

## Reproduce

Invariant suite, from this checkout:

```sh
bun test tests/integration/durability.test.ts   # Bun, in process and across processes
pnpm test:d1                                    # Cloudflare D1, last case
```

Both print a `[durability] {...}` line per lane with the counts in the results
tables, including `canonical_collisions`.

Falsify it — each of these must fail:

```sh
# I1: drop the index and re-run any lane
#   await db.exec("DROP INDEX observations_canonical_replay")
#   await db.exec("DROP INDEX claims_canonical_replay")
# I3: replace the batch with per-statement commits
#   for (const stmt of stmts) await db.batch([stmt])
```

The compatibility-surface violation, as measured:

```ts
import { openLocalStore } from "./src/runtime/bun/mcp-stdio";

const local = await openLocalStore("/tmp/compat-probe.db");
let id = 0;
const callTool = async (name: string, args: unknown) =>
  (await (await local.app(new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${local.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: (id += 1), method: "tools/call",
      params: { name, arguments: args },
    }),
  }))).json()) as any;

const entity = {
  entities: [{ name: "billing", entityType: "service", observations: ["Handles refunds"] }],
};
await Promise.all(Array.from({ length: 6 }, () => callTool("create_entities", entity)));
const graph = (await callTool("read_graph", {})).result.structuredContent;
console.log(graph.entities.find((e: any) => e.name === "billing").observations);
// ["Handles refunds", "Handles refunds", "Handles refunds",
//  "Handles refunds", "Handles refunds", "Handles refunds"]
```
