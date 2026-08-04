---
work_id: enrichment-gate-semantic-instrument
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
spec: docs/specs/done/2026-08-04-enrichment-gate-semantic-instrument.md
---

# Plan: a semantic contract family beside the frozen lexical one

## Approach

Two files change: the gate runner and its fixture. No production source, no new
dependency, no new package. The embedding side reuses the operator profile the
product already ships, imported from `src/core/vectors.ts`, so the diagnostic is
measured with the representation Titen retrieves with rather than a second
opinion invented for the benchmark.

1. **Split the scorer by pairing, not by rule.** `scoreProposal()` becomes
   `scoreFamily()` plus two pairing functions. `lexicalClaimPairs()` keeps the
   greedy first-eligible loop verbatim; `semanticClaimPairs()` takes the highest
   cosine above a threshold. Everything downstream of pairing - evidence
   identifier equality, validity instant equality, counts, links - is shared,
   which is what removes the cascade without loosening any comparison.
2. **Keep the guards lexical.** `contractGuardsPass()` holds claim kind
   equality, the negation-marker rejection, and the fixture's forbidden terms.
   Both families run it. Cosine never decides polarity.
3. **Give the fixture a reference statement.** Each of the 33 gold claims gains
   one canonical natural-language `statement`. The loader asserts that the
   statement satisfies the lexical contract of its own gold claim, so the two
   families cannot drift onto two different golds.
4. **Report both, gate one.** New metrics carry a `semantic_` prefix and sit
   beside the lexical ones. `lexicalGates` is untouched, and `gates` now states
   `semantic_contract_metrics_are_gating: false`.
5. **Make an unfrozen run unable to pass.** `frozenSourceSnapshot()` computes
   `frozen` instead of asserting it, and asserts it only when `--unfrozen` is
   absent. Gate computation reads `options.mode === "full" && frozen`, so a
   development run forces every gate false and says so in the artifact.

## Why the fixture needed a reference statement

The gold claim was a set of concept-slot alias lists. Cosine needs text. The
alternatives were to embed the joined first aliases, which is a keyword bag and
not a claim, or to embed the source observation, which would reward a model for
copying the input instead of stating the claim. Writing the canonical claim once
per case, and asserting it satisfies the same lexical contract, keeps one gold
meaning behind both families.

The fixture edit is additive: removing the 33 new `statement` fields reproduces
the previous file byte for byte, verified by comparison against the commit.

## Deliberate limits

- The semantic family cannot reject an unsupported assertion appended to a
  correct claim; that ceiling is shared with the lexical family and
  `semantic_precision_adjudicated` stays false.
- One threshold cannot be right for every model, so the runner reports a sweep
  at 0.70, 0.75, 0.80, 0.85, and 0.90 beside the 0.80 primary. The threshold is
  a calibration knob on a live embedding endpoint, not a constant of nature.
- The semantic family costs an embedding endpoint, so it is opt-in behind
  `--semantic`. Without the flag the runner behaves exactly as before and emits
  `semantic_contract_enabled: false`.

## Measured outcome

One 360-call lane, `cx/gpt-5.6-luna`, `json_object`, both families:
contract pass 64.72% lexical against 60.56% semantic at threshold 0.80; claim F1
61.83% against 52.37%; cited-source F1 51.44% against 44.62%; temporal accuracy
62.42% against 52.87%; reflection 25.00% against 25.83%; no-memory safety 100%
with `safety_outcome_divergence: 0`.

Paraphrase is worth 2.22 percentage points on this lane: 8 of 360 trials pass
only the semantic family, while 23 pass only the lexical one. Of the 127 lexical
failures only 39 involve claim text at all; the other 88 are action errors, link
errors, timeouts, and validator rejections. The cascade is confirmed: those 39
trials carry 43 gold evidence identifiers and the lexical family scored zero of
them by construction.

The semantic family is therefore a good diagnostic and a bad gate, which is why
the gates did not move. No threshold in the published sweep makes it pass more
than the lexical family.

## Acceptance evidence

**AC-EGI-001** - `bun scripts/benchmark-enrichment-model.ts --self-test` passes.
It asserts for all 72 fixture cases that the gold proposal passes the lexical
family, and that `scoreProposal()` without a cosine matrix returns
`semantic: null`, so a run without `--semantic` is the previous instrument. The
full lane emits both families in one `summary.json`.

**AC-EGI-002** - Safety stayed lexical by construction and by measurement. The
loader asserts every case in a safety category has gold action `abstain` and no
gold claim; `no_memory_safety` is computed from `safety_pass`, which reads the
lexical family; the run reported `safety_outcome_divergence: 0`. The self-test
asserts that a paraphrase whose validity window is wrong - but still supported
by the source - fails the semantic family at maximum cosine.

**AC-EGI-003** - The manifest and summary record
`profile: embeddinggemma-retrieval-v1`, `model: tuf/embeddinggemma`,
`dimensions: 768`, `role: document`, the input-rendering hash, the 0.80
threshold, and the five-point sweep. The profile is resolved through the
product's own `embeddingProfileMatchesModel()`, not hardcoded.

**AC-EGI-004** - The self-test asserts three rejections at cosine 1.0: a negated
proposition, a claim carrying a fixture-forbidden term, and a claim below the
threshold. Mutation check: deleting the negation and forbidden-term guards from
`contractGuardsPass()` fails the self-test with
`AssertionError: a negated proposition must fail at maximum cosine`.

**AC-EGI-005** - `lexical_output_gate_pass`, `model_quality_pass`, and
`activation_gate_pass` are false in the published run. `gates` carries
`semantic_contract_metrics_are_gating: false`, and the activation blockers
include the statement that semantic metrics do not relax the gate. No threshold
was changed.

**AC-EGI-006** - The published lane ran with `--unfrozen` because the runner and
fixture are modified relative to the commit. The artifact records
`source_frozen: false`, every gate is false, and the blocker list leads with the
unfrozen statement.

**AC-EGI-007** - The loader asserts `lexicalContractMatch()` accepts each gold
claim's own statement. Mutation check: rewriting one reference statement into
its negation fails the load with
`AssertionError: d-en-relationship-owner`.

## Verification

Commands run, in order:

1. `bun scripts/benchmark-enrichment-model.ts --self-test --unfrozen` - pass.
2. Mutation check on the fixture assert, restored afterwards - fails as
   intended, then passes again.
3. Mutation check on the semantic guards, restored afterwards - fails as
   intended, then passes again.
4. `npx tsc --noEmit -p tsconfig.json` - no new diagnostic for the runner. The
   remaining ones are the pre-existing `assert.ok` narrowing at the fixture load
   and the Node built-in module resolution this config does not provide, both
   present at the commit.
5. Fixture additivity check against the commit - identical after removing the
   33 added statements.
6. Smoke lane on the benchmark host, three cases, both families reported.
7. Full lane on the benchmark host: 72 cases, five repeats, 360 calls,
   `cx/gpt-5.6-luna`, `json_object`, `--semantic --unfrozen`.

Not verified: schema mode against a conforming provider, dual-runtime
persistence replay of captured proposals, semantic precision adjudication, and
provider revision attestation. All four remain activation blockers.

Numbers, artifact layout, and the interpretation boundary are in
[the instrument measurement](../../testing/2026-08-04-enrichment-gate-instrument.md).
