---
work_id: release-bound-retrieval-harness
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
spec: docs/specs/done/2026-08-04-release-bound-retrieval-harness.md
---

# Release-bound retrieval harness plan

## Steps

- [x] Read the external harness on its machine before writing anything: its
  fixture, its Titen runner, its scorer, its fixture verifier and its run
  script, so the repository version reproduces the reasoning rather than the
  file layout.
- [x] Copy the fixture into `tests/fixtures/retrieval-h2h.json`, keeping the
  disclosed authorship warning, and repoint its provenance note at the archived
  runner that already lives in this repository.
- [x] Write `scripts/benchmark-retrieval-h2h.ts` in the existing
  `scripts/benchmark-*.ts` house style: header stating the env vars it reads,
  argument parser with a self-test branch, redaction check before every write.
- [x] Boot the runtime through the existing `serve()` helper and provision
  through the existing `createApiKey`/`organizationStatement` helpers instead of
  spawning a CLI and parsing a key out of its stdout, so no credential is ever
  rendered to a stream.
- [x] Port the scorer, the repeat aggregation, the integrity refusal and the
  overlap rule, keeping the scorer blind to system-specific fields.
- [x] Pin the fixture by a hash over its scored content only, so prose in the
  fixture stays editable and the ground truth does not.
- [x] Add the assert-based self-test covering the metric maths, the
  missing-case accounting, the abstention rule, the argument floors, the pin,
  the archived-source provenance of every core fact and every case, and both
  sides of the winner refusal.
- [x] Leave the competitor's runner out and document the external comparison
  contract in the header instead.
- [x] Record the paired spec and plan and run the workflow checker.

## Acceptance evidence

- **AC-RBRH-001:** `scoreRun` consumes only the neutral contract. The live
  `--compare` run scored a second system from a file through the identical
  `scoreCase`/`scoreRepeat` path and produced a comparison block.
- **AC-RBRH-002:** `PINNED_FIXTURES` maps `titen-057-h2h-v2` to
  `d7e2785158e659aef5ae192e1f74d4a9d1b693f6ef9ffe84ee507bf13bed92a5`, computed
  by `fixtureContentHash` over the six scored fields. The self-test asserts the
  shipped file still hashes to it and that moving one gold breaks the hash.
- **AC-RBRH-003:** a fixture with `cases[0].relevant` changed was rejected with
  `content sha256 dd87db60... does not match the pinned d7e27851...`, exit 1,
  and no output directory was created.
- **AC-RBRH-004:** `report.md` from the real run lists recall@1, recall@3,
  recall@10, MRR@10, nDCG@3, nDCG@10 and `no_result_correct`; `metric_notes.
  excluded` states why precision@10 is absent.
- **AC-RBRH-005:** `--repeats 4` and `--warmup 1` are rejected by the parser;
  the real five-repeat run reported `recall_at_1=0.5714 [0.5714, 0.7143]` and
  `mrr_at_10=0.7347 [0.7347, 0.8095]`, a median with its full range.
- **AC-RBRH-006:** against a near-identical rival the run printed
  `no winner: recall_at_1 ranges overlap`; against a rival returning nothing it
  printed `winner=titen-fts | lexical FTS5 only, no embedding configured`.
- **AC-RBRH-007:** artifacts were scanned for `PAY-7842`, `Mira prefers`,
  `Apa kode insiden`, `Bearer ` and `api_key` and matched none; every failure is
  recorded as a class such as `HTTP_POST__v1_context_compile_503`.
- **AC-RBRH-008:** a comparison file with `corpus_size` 37 and one with a wrong
  `fixture_content_sha256` were both rejected before any repeat ran, exit 1.
- **AC-RBRH-009:** `scoreRun` records `blocking_integrity_failures` and clears
  `scoreable` when a repeat's corpus is not intact or the repeat count is under
  the floor; the self-test asserts both. Proven live by pointing the vector lane
  at an unusable loopback provider: every repeat reported
  `corpus_intact=false`, the run printed
  `UNSCOREABLE ... BLOCKING titen-vec: corpus not intact in repeats 1, 2, 3, 4, 5`
  and exited 1.
- **AC-RBRH-010:** `bun scripts/benchmark-retrieval-h2h.ts --self-test` passes
  and fails when a metric definition changes.

## Verification

```
$ bun scripts/benchmark-retrieval-h2h.ts --self-test
self-test ok fixture=titen-057-h2h-v2 content_sha256=d7e2785158e659aef5ae192e1f74d4a9d1b693f6ef9ffe84ee507bf13bed92a5

$ bun scripts/benchmark-retrieval-h2h.ts --fts-only --out RUN
  repeat 1: corpus_intact=true indexed=0/38 packer_engaged=0 errors=0
  repeat 2: corpus_intact=true indexed=0/38 packer_engaged=0 errors=0
  repeat 3: corpus_intact=true indexed=0/38 packer_engaged=0 errors=0
  repeat 4: corpus_intact=true indexed=0/38 packer_engaged=0 errors=0
  repeat 5: corpus_intact=true indexed=0/38 packer_engaged=0 errors=0
ok titen-retrieval-h2h-v1 titen-fts repeats=5 corpus=38
  recall_at_1=0.5714 [0.5714, 0.7143]
  recall_at_3=0.8571 [0.8571, 0.8571]
  mrr_at_10=0.7347 [0.7347, 0.8095]
  ndcg_at_3=0.7517 [0.7517, 0.8044]
  no winner: single run: a winner claim needs a second system scored on the same fixture
  publishable=false artifacts=RUN

$ bun scripts/benchmark-retrieval-h2h.ts --fts-only --out RUN2 --compare rival-close.json
  no winner: recall_at_1 ranges overlap

$ bun scripts/benchmark-retrieval-h2h.ts --fts-only --out RUN3 --compare rival-weak.json
  winner=titen-fts | lexical FTS5 only, no embedding configured
```

`publishable=false` above is correct and load-bearing: the working tree was
dirty during verification, and the harness will not certify a number that
cannot be reproduced from a commit.

The lexical lane ran against the real Bun/SQLite runtime over loopback HTTP.
The vector lane's success path was NOT smoked: no embedding provider was
available and none was contacted, so no vector-lane number and no vector-lane
support is claimed by this work. Only its fail-closed path was exercised, by
pointing it at a loopback port with nothing listening. The Cloudflare runtime is
not exercised by this harness at all.

The repository suites were run to confirm the new files break nothing:

```
$ pnpm test:api
 9 pass / 0 fail        (contract, Bun/SQLite)
 pass 111 / fail 0      (contract, Cloudflare D1 under miniflare)
 136 pass / 0 fail      (SDK)
===API_EXIT=0===

$ pnpm test:integration
 201 pass
 0 fail
===INT_EXIT=0===

$ pnpm check:workflow
workflow docs OK (86 artifacts)
workflow checker self-test OK
Ponytail debt ledger OK (0 tracked markers).
```

## Closure reason

Completed as specified. The instrument is committed and reproducible; no
retrieval number is published by this work, and `docs/testing/EVALS.md` remains
correct in declining to publish one until a release runs the harness on a clean
tree.
