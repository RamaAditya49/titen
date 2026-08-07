# `titen audit` run against Titen

Date: 2026-08-07

Verdict: **Titen's own store accumulates. 17.9% of it is byte-identical
duplicates six seconds after it was written, 96.7% of it was never read back,
and its `@modelcontextprotocol/server-memory` compatibility surface turns one
entity into six.**

The detection rules were published in
[`docs/reference/audit.md`](../reference/audit.md) before this was run, and this
is the first store the tool was run against. Nothing below is a ranking, nothing
is combined into a score, and no number here is compared to another system.

## The number that matters most is one Titen cannot report

`~/.titen/memory.db` did not exist on the maintainer's machine when this was
written. Neither did any other Titen database. The whole reason `titen audit`
exists is a public audit that found 97.8% of 10,134 entries were junk after
**32 days** of real traffic. Titen has no 32-day store, no 32-day user, and no
way to fake one. Every number below comes from a store that is minutes old.

So: nothing in this document bounds long-run accumulation, in Titen or in
anything else. It shows the instrument works, and it shows two defects the
instrument found in its own author's product. That is all it shows, and stating
that plainly is the point of publishing it first.

## Method

| Field | Value |
| --- | --- |
| tool | `titen audit`, `src/runtime/bun/audit.ts`, SHA-256 `8dd9ee1e8cb6183c072c340a2a6d8c82b488ac242cc4725f1505908caef0720c` |
| check | `tests/integration/audit.test.ts`, SHA-256 `b0bb2aaac49c4752829bfaf46b3c5c787c84441d5a26a56cab6d9c8e2b1c3ea8` |
| base commit | `5470a048748396503d6d33e1fab7feec27765f39`, plus the in-flight zero-config, compatibility, provenance and durability work not yet committed |
| host | Bun 1.3.13, AMD Ryzen AI 9 HX 370, Linux 7.0.0-28-generic, NVMe |
| lane | FTS-only. No embedding provider, no vector store, no extraction model. |
| network | none. The tool makes no outbound call; the test asserts it under a `fetch` that throws. |

Two corpora, both written through Titen's real HTTP write path into a real
zero-config local store, then audited with the shipped command.

### Corpus A — this repository's own history, recorded the way an agent records

Content nobody planted: `git log --format='%H%n%s%n%b'` over all 181 commits on
`main`, split into its 986 non-empty lines. Each line was written as one
observation (`kind: imported_source`, `source: {type: "git_commit", ref: <sha>}`,
`trust: asserted`, no `source.id`), then materialized one-to-one into a
`semantic_fact` claim with the line as its statement — the naive extraction step
an agent actually performs.

Then five compile-and-write-back cycles, which is the loop that fills stores in
the field: compile a pack for a task, take the top three items, and write each
one back as a new observation while holding the pack's `context_token`. The five
tasks were `what did the webhook fix change`, `how is the D1 release gate
stabilized`, `what does the benchmark evidence support`, `which advisories were
pinned`, `what is the dashboard live verification`. That produced 15 write-backs
and a final store of 1,001 observations.

### Corpus B — the compatibility surface under a repeat burst

A fresh local store, then six identical `create_entities` calls issued
concurrently through the MCP endpoint, followed by one `add_observations`. This
reproduces, through a different instrument, the defect the concurrent-writer
work found on the same surface
([`2026-08-07-durability.md`](./2026-08-07-durability.md)).

## Results

### Corpus A — 1,001 entries

| Metric | Count | Rate |
| --- | --- | --- |
| exact duplicate | 179 | 17.9% |
| near duplicate | 1 | 0.1% |
| recall loop | 15 | 1.5% |
| secret pattern | 0 | 0.0% |
| stale | 968 | 96.7% |

### Corpus B — 13 entries

| Metric | Count | Rate |
| --- | --- | --- |
| exact duplicate | 10 | 76.9% |
| near duplicate | 0 | 0.0% |
| recall loop | 0 | 0.0% |
| secret pattern | 0 | 0.0% |
| stale | 13 | 100.0% |

These ten numbers are not combined, averaged, or ranked, here or anywhere.

## What the findings actually say

### Titen's canonical hash is a replay key, not a duplicate detector

179 redundant entries in 27 groups. The largest group is 147 byte-identical
copies of `Co-Authored-By: CADIS <agent@cadis.digital>` — a real commit trailer,
repeated across real commits, and stored 147 times.

None of it was deduplicated, and the reason is structural rather than a bug,
which makes it worse. Two facts from the store itself:

```
SELECT COUNT(*) FROM observations                        -> 1001
SELECT COUNT(*) FROM observations WHERE canonical_hash IS NULL -> 1001
SELECT COUNT(*) FROM claims                              ->  986
SELECT COUNT(DISTINCT statement) FROM claims             ->  822
```

`src/core/observations.ts` computes the canonical hash **only when the caller
supplies `source.id`**. Every observation here has `canonical_hash IS NULL`, so
the partial unique index that upholds "exactly one record per canonical hash"
never applied to a single row.

The claim layer computes its hash unconditionally and still did not collapse
anything, because that hash covers the claim's `sources` and its position in the
batch. Two identical statements supported by two different observations are two
different canonical hashes, so the 164 duplicated lines became 164 duplicated
claim statements: 986 claim rows, 822 distinct statements.

Both keys are doing exactly what they were built for — making a retried request
idempotent — and neither one is a content-duplicate detector. The concurrent-writer
suite's invariant "exactly one claim per canonical hash" holds and is not
contradicted by this. What this shows is that holding it buys nothing against
the failure mode people actually report, and that the write path's dedup story
is narrower than a reader would assume.

### The near-duplicate rule caught one thing, and it is the right one

`Co-Authored-By: CADIS …` appears 147 times and `Co-authored-by: CADIS …` four
times. Those are one canonical group holding two distinct raw texts, so the
exact rule counts 146 + 3 redundant copies and the near rule counts the one
crossing between the spellings. That single crossing is the entire
near-duplicate yield on 1,001 entries, and it is honest: the rule is
exact-match-after-canonicalization, so it detects case, spacing and punctuation
drift and nothing else. Paraphrase is invisible to it. The 0.1% here is a floor,
not an estimate.

### Almost nothing written was ever read back

968 of 1,001 entries were never served after they were written. Five compiles
returned 33 items in total, drawn from 986 claims. A store built by an agent
that writes everything and compiles occasionally reaches 3.3% of what it stored,
within minutes, before any decay or drift has had time to matter.

This is an upper bound on staleness — direct `GET /v1/claims/:id/evidence` reads
are not logged per record — and it is measured over a store with no history.
Both caveats push the same way: it is not a flattering number and it is not
supposed to be.

### The recall-loop detector fires, on both mechanisms, on every planted case

All 15 write-backs were detected, and every one was detected **twice
independently**: by the server-assigned `source_type = 'recalled'` stamp that
the provenance work added, and by the text match against what the pack had
served moments earlier. The two mechanisms agreeing on 15/15 is what makes the
metric worth reporting at all — a self-declared label would have been worth
nothing.

What this does not show: a field rate. The corpus was built to contain
write-backs, so 1.5% is a property of the script, not of agents. The finding is
that the detector works and that both of its halves work.

### The secret rules found nothing, which is weak evidence

Zero matches across 1,001 entries. Commit messages are a corpus that humans
review before it exists; a real agent memory store is not. Read this as "the
rules did not false-positive on a thousand lines of technical English", which is
a useful thing to know, and not as "Titen stores are clean".

### The compatibility surface duplicates under concurrency

Six concurrent identical `create_entities` calls left six copies of the entity
type and six of its observation: 10 redundant entries in a 13-entry store, 76.9%.
The reference server this surface replaces would have written the entity once.
This is the same defect the concurrent-writer suite recorded, found here by a
completely different route, and it is open.

The honest framing of the substitution play, until it is fixed: Titen is a
lossless substitute for `@modelcontextprotocol/server-memory` on retrieval and
**not yet** on concurrent identical writes.

## Reproducing this

```sh
# Corpus A content, verbatim, from any checkout of this repository:
git log --format='%H%n%s%n%b' | grep -v '^$' | wc -l     # 986 at the base commit

# Audit any store, export, or memory.json(l). Nothing leaves the machine:
bun src/runtime/bun/cli.ts audit ~/.titen/memory.db
bun src/runtime/bun/cli.ts audit ./memory.jsonl --json > audit.json
```

The corpora themselves are rebuilt by the recipe in the Method section above
against a fresh `openLocalStore`; they are not committed, because a committed
1,001-row SQLite fixture would be a fixture, and the point is that the numbers
come from the write path rather than from a file somebody curated.

## What would change these numbers

- Setting `source.id` on writes turns the canonical key on — but it would not
  collapse this group, because that key also covers `source.ref`, and these 147
  copies arrived under 147 different commit hashes. Deduplicating repeated
  *content* across different sources is something Titen does not do at all
  today. Whether it should is a product decision this document does not make.
- Fixing the compatibility surface's concurrent-write path.
- Running Titen for 32 days. Nothing else substitutes for that, and until
  somebody does, this document's most important row stays empty.

## Falsification

From the spec: 90 days after this tool ships, fewer than five distinct external
runs and zero published numbers kills the write-hygiene wedge, and the honest
conclusion is then that Titen is a well-engineered library with no market. If
an incumbent publishes their own junk-rate audit first, the play is foreclosed
and we say so rather than argue methodology.
