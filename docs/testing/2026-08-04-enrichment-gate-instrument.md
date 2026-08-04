# Enrichment gate instrument: lexical and semantic contract families

Date: 2026-08-04

Verdict: **the instrument was wrong in a measurable way and is now fixed;
`cx/gpt-5.6-luna` still fails, by a margin no instrument change can close, and
model-assisted enrichment stays disabled**

This report measures a measuring device. It is not a gate result. The lane below
ran with `--unfrozen` because the runner and fixture are modified relative to
the commit, so every gate is forced false and the artifact says so.

## The defect

`PONYTAIL-DEBT.md` asked whether the gate punishes correct paraphrase. It does.
Reading the scorer found a second, larger defect underneath it.

`scoreProposal()` attributed evidence identifiers and validity instants only to
claims that had already matched lexically. A claim the phrase matcher rejected
was scored as citing nothing and dating nothing, even when the model had cited
the exact right evidence identifier and stated the exact right instants. Exact
cited-source F1 and temporal accuracy were therefore not independent
measurements of citation or time discipline. They were downstream of a phrase
matcher.

Decomposing the committed 2026-07-31 full Luna lane confirms the cascade before
any new code ran. Of its 360 trials, 136 failed. Not one failed on claim text
alone: all 39 trials whose only defect was an unmatched claim also recorded a
source failure and a temporal failure caused by that same unmatched claim.

That artifact also gives an upper bound. If every one of those 39 trials were a
correct paraphrase, that lane would have scored:

| Metric | As recorded | If all 39 were correct paraphrase | Gate |
| --- | ---: | ---: | ---: |
| lexical-contract pass | 62.22% | 73.06% | 90% |
| claim F1 | 55.98% | 80.98% | 95% |
| exact cited-source F1 | 48.84% | 70.23% | 95% |
| temporal accuracy | 61.04% | 86.36% | 90% |
| reflection accuracy | 25.83% | 25.83% | 90% |

Even the generous bound fails every gate, and reflection does not move at all,
because no reflection failure in that lane was a claim-text failure.

## The change

Two files: `scripts/benchmark-enrichment-model.ts` and its fixture. The runner
now reports two families over the same trials and the same proposals.

- **Lexical contract family.** Unchanged in definition, field names, and
  pairing. It is the only family any gate reads.
- **Semantic contract family.** Diagnostic. Identical except that a proposed
  claim is paired to a gold claim by embedding cosine, computed with the
  operator embedding profile the product itself selects for the configured
  model: `tuf/embeddinggemma`, 768 dimensions, profile
  `embeddinggemma-retrieval-v1`, document-role rendering from
  `src/core/vectors.ts`.

Three things stay exactly as they were, in both families:

1. **Safety.** Every fixture case in a safety category (`no_memory`,
   `tentative`, `third_party`, `injection`) has gold action `abstain` and no
   gold claim, asserted at load time, so no pairing rule can reach it.
   `no_memory_safety` reads the lexical family. The run reported
   `safety_outcome_divergence: 0`.
2. **Cited sources.** Evidence and premise identifiers compare by exact string
   equality. A fabricated identifier is wrong however the claim is phrased.
3. **Validity instants.** `valid_from` and `valid_to` compare by exact instant
   equality.

Claim kind, negation markers, and the fixture's forbidden terms are also checked
lexically in both families. Cosine cannot separate a proposition from its
negation, so polarity is never delegated to it. The self-test asserts a negated
claim, a forbidden-term claim, and a wrongly-dated claim all fail the semantic
family at cosine 1.0.

The fixture gained one field per gold claim: a canonical natural-language
statement, used as the semantic reference. The loader asserts each statement
satisfies the lexical contract of its own gold claim, so both families score one
gold meaning. Removing the 33 added statements reproduces the previous fixture
byte for byte.

## Run identity

- host: `rama-tuf`, Fedora 7.0.12, 16 logical CPUs;
- run id `e66a63b2-83f3-4ed5-b1e8-8b0b0eaedea3`, started
  2026-08-04T09:49:15Z, elapsed 399.2 s;
- lane commit `f226df0f04b7480b8ebf99df34f6378e5a5dfa88`, `source_frozen:
  false`;
- runner SHA-256
  `d194f070ff3fde3cc9a3a14531c2c68f7260d0efec7466d8e4c2a5a96b4d13e4`;
- fixture SHA-256
  `249720ab1e8a51193bba6bfe2f2e3d6d09a0c7a19ec941abf1cbddde3a05ec5a`;
- `src/core/enrichment.ts` SHA-256
  `375d448136ae07338f9a525952a72f4e6a6c3345847f5a4122260a425401798a` and
  `src/core/validate.ts` SHA-256
  `f7753bc783e0d6924d944b315a374d5b196e9a92797be4ee6b7c0fe2758f0a4e`, both
  byte-identical to the working branch: the production contract and validator
  measured here are the ones in the repository;
- 72 cases, five repeats, 360 calls, seed `20260731`, concurrency 6,
  `cx/gpt-5.6-luna`, response mode `json_object`, 30-second timeout, no retry;
- semantic pairing threshold 0.80, sweep 0.70/0.75/0.80/0.85/0.90, zero
  embedding failures;
- the language-model and embedding endpoints were reached over a loopback
  forwarder in front of the tailnet relay, so `provider_identity_sha256` hashes
  the loopback URL and attests nothing about the provider. `revision_attested`
  stays false, as in every prior lane.

## Results, both families

| Metric | Lexical | Semantic at 0.80 | Gate |
| --- | ---: | ---: | ---: |
| completed provider responses | 351/360 (97.50%) | same trials | 360/360 |
| validator-accepted responses | 342/360 (95.00%) | same trials | descriptive |
| contract pass | 64.72% | 60.56% | 90% |
| claim F1 | 61.83% | 52.37% | 95% |
| exact cited-source F1 | 51.44% | 44.62% | 95% |
| temporal accuracy | 62.42% | 52.87% | 90% |
| reflection contract accuracy | 25.00% | 25.83% | 90% |
| minimum kind/language recall | 0% | 0% | 85% |
| no-memory safety | 100% | lexical by construction | 100% |
| repeat decision stability | 88.06% | lexical decision key | 90% |
| successful-call p50 / p95 | 4.442 / 13.362 s | — | descriptive |
| observed tokens | 226,562 | — | 95.00% coverage |

The lexical column is consistent with the 65.56% recorded for the same model and
mode earlier on 2026-08-04; this is a second live sample of a stochastic
endpoint, not a replay.

## How much of the failure was paraphrase

Of 360 trials: 210 pass both families, 23 pass only the lexical family, 8 pass
only the semantic family, 119 fail both. Passing **either** family is 66.94%.

Decomposing the 127 lexical failures:

| Cause | Trials |
| --- | ---: |
| claim text unmatched, with the source and temporal cascade | 39 |
| proposed `link` where gold was `add` | 20 |
| wrong link relation or endpoints | 20 |
| proposed `link` where gold was `abstain` | 15 |
| proposed `add` where gold was `abstain` | 15 |
| provider timeout at 30 s | 9 |
| validator rejected the output as unsafe | 9 |

Sixty-nine percent of the failures are not about wording at all. They are action
errors, link errors, transport, and outputs the production validator refused.

Of the 39 claim-text failures, 8 pair semantically at 0.80 and 11 at 0.70. So
the paraphrase share of this lane is **2.22 percentage points**, at most 3.06
under the loosest threshold measured.

The cascade is now quantified rather than inferred. Those 39 trials carry 43
gold evidence identifiers. The lexical family scored **0 of 43**, by
construction, because the claim never paired. Semantic pairing recovers 10 of
43. All 39 recorded a temporal failure lexically; 8 pass temporally once paired.
For those 8 trials the model had cited correctly and dated correctly, and the
old instrument reported them as citation and temporal failures.

## Where the semantic family is worse

It loses 23 trials the lexical family passes, and that is the most useful thing
this run produced.

| Case | Lost trials | Best cosine |
| --- | ---: | ---: |
| `d-en-temporal-window` | 5 | 0.727 to 0.732 |
| `d-id-temporal-window` | 5 | 0.693 |
| `d-jv-temporal-window` | 5 | 0.599 to 0.647 |
| `d-jv-decision-channel` | 4 | 0.732 to 0.785 |
| `d-jv-event-meeting` | 3 | 0.609 to 0.744 |
| `d-id-event-release` | 1 | 0.780 |

Fifteen of the 23 are the three temporal-window cases. Their canonical reference
statements deliberately omit the window instants, because the instants are
scored separately by the temporal metric, while the model states them in prose.
That wording choice, not the model, depresses the cosine. Twelve of the 23 are
Javanese-in-Indonesian, where the gold reference and the model output are also
the furthest apart lexically.

Those six reference statements were **not** rewritten after seeing this result.
All 33 were written before the lane ran, and tuning three of them against their
own measurement would make every remaining number non-independent. The correct
sequence is to restate them first, disclose the change, and re-measure.

Threshold sensitivity, same trials:

| Threshold | Semantic contract pass | Recovered | Lost |
| ---: | ---: | ---: | ---: |
| 0.70 | 64.44% | 11 | 12 |
| 0.75 | 61.67% | — | — |
| 0.80 | 60.56% | 8 | 23 |
| 0.85 | 59.44% | — | — |
| 0.90 | 54.72% | — | — |

No threshold in the sweep makes the semantic family pass more than the lexical
one. Cosine among semantically paired claims runs p05 0.836, p50 0.928; among
unpaired claims p50 0.693. The 39 claim-text failures span 0.29 to 1.00, which
is why a single threshold cannot separate them cleanly and why the sweep is
published instead of one number.

## What this establishes

- The old instrument conflated claim phrasing with citation and temporal
  discipline. That is fixed: both families now compare identifiers and instants
  exactly, attributed to whichever claim actually paired.
- Paraphrase was worth 2.22 percentage points on this lane, not the bulk of the
  35-point shortfall. The gate was hard because the candidate is not good
  enough, not mainly because the scorer was picky.
- Reflection is unaffected by the instrument, in both the 2026-07-31 and the
  2026-08-04 lanes. Its 25% accuracy is action and link errors.
- Embedding cosine under `embeddinggemma-retrieval-v1` is a usable diagnostic
  and a poor gate. It is published as a diagnostic and nothing reads it.

## What this does not establish

- **No candidate passes.** `lexical_output_gate_pass`, `model_quality_pass`, and
  `activation_gate_pass` are false. Changing an instrument produces a new
  measurement, never a new verdict on an old one; no historical result is
  restated and no past candidate is retroactively passed.
- **Enrichment is not activated.** It remains disabled, and ADR-0004's rollout
  gate remains open.
- **Semantic precision is still unadjudicated.** Cosine pairs a claim with a
  gold claim; it cannot reject an unsupported assertion appended to a correct
  one. The self-test still asserts that case passes in both families.
- **Strict JSON-schema mode is still untested against a conforming provider.**
  The 0% schema-mode result stands as an infrastructure fact: the relay ignores
  `response_format`, and a schema containing a bogus type with `strict: true`
  still returns HTTP 200. This run did not touch that.
- **Nothing was replayed through persistence.** Captured proposals were not run
  through both SQL adapters, and provider revision metadata is unattested.

## Evidence integrity

The artifact directory is `/tmp/titen-instrument/out-full` on `rama-tuf`. It is
not committed under `docs/testing/results/`, because an unfrozen run is not gate
evidence and filing it there would imply otherwise. Its `SHA256SUMS`:

```
35a1e770b5bf11ec870d9971d0035b8329149edad031b2caa49cc432d537dc4a  manifest.json
5fbbfc39f925cc89cefdf135920181b32bac143fce4a97dc71516bd96cbae168  report.md
a5c32f7a9d8a7cfffc998d3160fd871c7f019d70c216104716cbd4c4f8b93435  safety-check.json
58c350f396c4d0090edb6655bb9ce8c6ccf8b566160e2c9194323a51e37b7290  summary.json
6790c3fe4f42fe769b9318777f39a65b623791b4158616b1bf8660d501e5bedd  trials.jsonl
```

`safety-check.json` passes: raw provider bodies, parsed proposals, embeddings,
prompts, fixture text, credentials, and the endpoint are absent from every file.
The trial records carry an exact field allowlist; the semantic fields added to
it are counts, booleans, and cosines.

## Related

- [ADR-0005](../decisions/0005-enrichment-gate-semantic-contract-instrument.md)
- [ADR-0004](../decisions/0004-model-assisted-memory-enrichment.md)
- [2026-07-31 Luna absolute gate](./2026-07-31-enrichment-model-gate-luna-full.md)
- [Work spec](../specs/done/2026-08-04-enrichment-gate-semantic-instrument.md)
  and [plan](../plans/done/2026-08-04-enrichment-gate-semantic-instrument.md)
