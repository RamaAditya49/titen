---
work_id: scale-and-concurrency
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
spec: docs/specs/done/2026-08-04-scale-and-concurrency.md
---

# Scale and concurrency measurement plan

## Steps

- [x] Trace the real compile path before writing a generator: read
  `src/core/retrieval.ts` for the FTS MATCH expression, `src/core/context.ts`
  for what compile persists, and `src/runtime/bun/sqlite.ts` for the durability
  pragmas, so the harness measures the shipped behaviour and the report can
  explain the ceiling instead of guessing at it.
- [x] Reuse the provisioning pattern already proven in
  `scripts/benchmark-retrieval-h2h.ts` — `openDatabase`, `createSqliteDb`,
  `migrate`, `createApiKey`, `organizationStatement` — so no credential is ever
  written to a stream and no new abstraction appears.
- [x] Spawn the service as a separate process with the shipped
  `titen serve` command rather than calling `serve()` in-process. A load
  generator sharing one event loop with `Bun.serve` would measure itself.
- [x] Read the child's `VmRSS` and `utime`+`stime` from `/proc`, and this
  process's own CPU from `process.cpuUsage`, so the report can separate a
  service ceiling from a client ceiling.
- [x] Strip every `TITEN_EMBED_*` and `TITEN_EXTRACT_*` name from the child
  environment instead of documenting that they must be unset.
- [x] Generate a topical synthetic corpus: topic of claim `i` is `i % 400`,
  tokens drawn without replacement from that topic's 24-token pool, document
  length varying between 8 and 20 tokens. A flat vocabulary gives either a
  perfectly flat recall curve or a full-corpus posting list per term; topics
  give a rare term corpus-wide and same-topic competitors that grow with the
  corpus, which is what actually happens to a memory store.
- [x] Make decade N a strict prefix of decade 10N and put every gold claim
  inside the first decade, so the query set is identical at every decade.
- [x] Time the FTS projection rebuild by executing migration 11's own statement
  list rather than a re-implementation of it, so the measured build cost stays
  bound to the shipped schema.
- [x] Declare the ceiling rule as a constant before the run and return null
  when throughput never plateaus.
- [x] Add the assert-based `--self-test` covering generator determinism, topic
  isolation, prefix stability, nearest-rank percentiles, both branches of the
  ceiling rule, the error-code redaction, the presence of migration 11, and the
  environment strip.
- [x] Run two independent full invocations on `benchmark-host` against the clean
  v0.5.7 clone, detached, and publish both.
- [x] Notice that `/tmp` on that host is tmpfs before publishing an ingest
  number as a durable-write figure, and add a third invocation with `TMPDIR`
  pointed at the NVMe filesystem. This needed no code: `mkdtempSync` already
  honours `TMPDIR`.
- [x] Write the dated evidence document in the house style of
  `docs/testing/2026-07-31-embedding-s-validation-v2-full.md`: locked method,
  result tables, what binds first, and what the run does not prove.
- [x] Copy back only `manifest.json`, `summary.json`, `raw.jsonl` and
  `SHA256SUMS`, verify the checksums locally, and scan the artifacts for
  credentials and corpus text before committing them.
- [x] Run `node scripts/check-workflow-docs.mjs`.

## Acceptance evidence

Values below are run 1 unless stated; run 2 reproduces every cell within a few
percent and both are in the raw artifact.

- **AC-SCALE-1:** at 1,000 / 10,000 / 100,000 claims the harness reported
  2,365 / 2,170 / 1,850 claims per second, FTS projection rebuild of
  11.7 / 89.4 / 966.8 ms, checkpointed databases of
  5,685,248 / 48,742,400 / 480,628,736 bytes, and service resident memory after
  ingest of 97.8 / 96.4 / 100.6 MiB peaking at 130.1 / 121.5 / 149.7 MiB during
  the query sweep.
- **AC-SCALE-2:** at 100,000 claims, clients 1 / 8 / 32 / 64 gave
  87.8 / 89.8 / 88.1 / 89.9 requests per second with p95 of
  11.99 / 154.38 / 372.71 / 734.44 ms; the full four-level matrix for all three
  decades is in `raw.jsonl`.
- **AC-SCALE-3:** `CEILING_GAIN` is 0.1, declared as a module constant. It
  fired at 32 clients for 1,000 claims in run 1 and 8 in run 2, at 8 for 10,000
  in both, and at 1 for 100,000 in both. `findCeiling` returns null when
  throughput keeps improving, and the self-test asserts both branches plus a
  refusal on a non-finite throughput — the fault that made a whole earlier run
  report "no ceiling" everywhere.
- **AC-SCALE-4:** `goldIndices` places all 100 golds inside the smallest decade
  and `claimTokens` makes decade N a prefix of decade 10N, so the same 100
  queries ran at every decade: recall@1 1.00 / 0.81 / 0.49 and MRR@10
  1.000 / 0.897 / 0.609.
- **AC-SCALE-5:** every sweep row carries `service_cores_used` and
  `client_cores_used`. The service held 0.98 to 1.11 cores at every level of
  every decade; the client never exceeded 0.21 and fell to 0.03 at 64 clients
  on the largest corpus, which is what rules out a client-bound reading.
- **AC-SCALE-6:** the service is started with `Bun.spawn` running
  `bun src/runtime/bun/cli.ts serve`; `procRssKb` and `procCpuSeconds` read the
  `status` and `stat` files under `/proc` for that child pid.
- **AC-SCALE-7:** `childEnv` drops every key prefixed `TITEN_EMBED` or
  `TITEN_EXTRACT`; the self-test sets both and asserts neither survives.
  `manifest.json` records `vector_lane: disabled` and
  `embedding_provider: none`.
- **AC-SCALE-8:** `assertRedacted` runs over every artifact before it is
  written, against each generated API key and 32 sampled statements, and throws
  `ForbiddenContentInArtifact` rather than warning. A post-run scan of all four
  files for corpus tokens, `Bearer `, key prefixes, endpoints and filesystem
  paths matched nothing.
- **AC-SCALE-9:** the evidence document names one thread as the binding
  resource in every configuration, with the `/proc` figures behind it, and
  separates the two things that thread waits on: `fsync` dominates on durable
  storage at 1,000 claims (0.44 service cores, 74% of compile throughput lost
  against tmpfs) and CPU dominates at 100,000 (0.95 cores, 13% lost). It also
  states that the recall intercept and the competitor density are properties of
  the generator rather than of Titen.
- **Durable-storage variant (run 3):** ingest fell to 355 / 309 / 311 claims
  per second against 2,365 / 2,170 / 1,850 on tmpfs, with ingest CPU at 0.48 to
  0.58 cores, and recall@1 and MRR@10 were unchanged at every decade, which is
  the check that the two configurations differ only in storage.

## Verification

- `bun scripts/benchmark-scale.ts --self-test` passes on this workstation and
  on `benchmark-host`.
- Three full invocations completed with exit 0 and zero request failures across
  36,000 measured compiles each.
- `sha256sum -c SHA256SUMS` passes in every published result directory.
- `node scripts/check-workflow-docs.mjs` passes.
- No `titen.db` or `titen.db.vec` exists in either repository root; every run
  used a temporary directory and removed it.

## Rejected alternatives

- **A load-testing dependency (autocannon, k6).** `EVALS.md` allows one only
  when the built-in runner cannot generate or measure the required concurrency
  accurately. It can: the client stays under a fifth of one core at every level
  and the run publishes that number so the claim is checkable.
- **Repeating each concurrency level five times inside one invocation.** Each
  level already reports a distribution over 3,000 requests. Two independent
  full invocations give the run-to-run spread for the single-shot numbers —
  ingest, rebuild, size, resident memory — at no extra code.
- **An externally authored corpus for the recall curve.** Mr. TyDi Indonesian
  has 100 documents in the vendored slice. Growing it to 10^5 would mean
  generating documents anyway, and its licence keeps it out of this repository.
  A declared synthetic generator with a published curve shape is the honest
  instrument; the report says so.
- **Running the 10^6 tier.** Nothing in the product justifies the run time yet,
  and 10^5 already shows the binding resource.
