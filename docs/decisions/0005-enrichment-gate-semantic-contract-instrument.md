# ADR-0005: The enrichment gate reports a semantic contract family beside the lexical one

- Status: accepted; instrument change only, no activation
- Date: 2026-08-04
- Decision owners: Titen maintainers

## Context

[ADR-0004](./0004-model-assisted-memory-enrichment.md) makes production
activation of model-assisted enrichment conditional on a frozen evaluation. That
gate has never been passed. The best candidate measured on 2026-08-04,
`cx/gpt-5.6-luna` in JSON-object mode, scored 65.56% lexical contract pass
against a 90% threshold, and the 2026-07-31 full lane recorded claim F1 55.98%,
exact cited-source F1 48.84%, minimum kind/language lexical recall 0%, temporal
accuracy 61.04%, and reflection accuracy 25.83%.

`PONYTAIL-DEBT.md` records the honest question: is the gate measuring the right
thing? Scoring free-form model output against a frozen lexical fixture punishes
correct paraphrase. A model that writes "the team must rehearse rollback before
customers are affected" instead of the fixture's wording is correct, and the
scorer marked it wrong.

Re-reading the scorer found a larger defect than paraphrase tolerance.
`scoreProposal()` attributed evidence identifiers and validity instants only to
claims that had already matched lexically, so an unmatched claim scored zero
cited sources and a failed temporal check even when the model cited the exact
right evidence identifier and the exact right instants. Cited-source F1 and
temporal accuracy were therefore not independent measurements. Decomposing the
2026-07-31 full Luna lane confirms the cascade: of 136 failing trials, not one
failed on claim text alone, and all 39 trials whose only defect was an unmatched
claim also carried a source failure and a temporal failure caused by that same
unmatched claim.

A separate fact in the same debt entry is infrastructure, not model quality.
Strict JSON-schema mode scored 0% across 720 calls because the 9router relay
ignores `response_format` entirely; a schema containing a bogus type with
`strict: true` still returns HTTP 200. Schema mode has never been tested against
a conforming provider and this ADR does not change that.

## Decision

The gate runner reports two metric families over the same trials, the same
proposals, and the same gold.

1. **Lexical contract family.** Unchanged. Same slot phrases, same field names,
   same greedy first-eligible pairing, same numbers. It remains the only family
   a gate reads.
2. **Semantic contract family.** Diagnostic. Identical in every respect except
   claim pairing, which uses embedding cosine between the proposed claim and the
   fixture's canonical gold claim, computed with the operator embedding profile
   that Titen itself selects for the configured embedding model
   (`embeddingInput` in `src/core/vectors.ts`, document role).

Four rules bound the second family.

- **Guards stay lexical.** Claim kind must match exactly, the claim must carry
  no negation marker, and it must contain no term the fixture forbids for that
  claim. Cosine cannot separate a proposition from its negation, so polarity is
  never delegated to it.
- **Identifiers and instants stay exact.** Evidence and premise identifiers
  compare by exact string equality, validity instants by exact instant equality,
  in both families. A fabricated evidence identifier is wrong however it is
  phrased. Only the pairing changes, which is what removes the cascade.
- **Safety cannot move.** Every fixture case in a safety category
  (`no_memory`, `tentative`, `third_party`, `injection`) has gold action
  `abstain` and therefore no gold claim, so no pairing rule can reach it. The
  loader asserts this, `no_memory_safety` is computed from the lexical family
  only, and the summary carries a `safety_outcome_divergence` counter that must
  stay zero.
- **Gates stay lexical.** Every activation gate is computed from the lexical
  family. The artifact records `semantic_contract_metrics_are_gating: false` and
  an activation blocker saying the semantic family does not relax the gate.

The fixture gains one field per gold claim: a canonical natural-language
statement used as the semantic reference. The loader asserts that this statement
satisfies the lexical contract of the same gold claim, so the two families score
one gold meaning rather than two.

A run whose gate sources differ from the commit under test is permitted only
under an explicit `--unfrozen` flag. Such a run records `source_frozen: false`
and forces every gate false, because an instrument-development run must not be
able to pass anything.

## What this decision does not do

- **It does not retroactively pass any past candidate.** Changing an instrument
  produces a new measurement, not a new verdict on an old one. Every recorded
  candidate result stands as measured, and no historical artifact is rewritten.
- **It does not activate enrichment.** Model-assisted enrichment remains
  disabled, its rollout gate in ADR-0004 remains open, and the activation
  blockers are unchanged apart from the two this change adds.
- **It does not lower a threshold.** The 90% contract, 95% claim F1, 95% source
  F1, 85% per-kind-and-language recall, 100% no-memory safety, 90% temporal,
  90% reflection, and 90% repeat-stability thresholds are untouched and still
  read the lexical family.
- **It does not adjudicate semantic precision.** Cosine pairs a claim with a
  gold claim; it cannot reject an unsupported assertion appended to a correct
  one. `semantic_precision_adjudicated` stays false, the self-test still asserts
  that the appended-assertion case passes in both families, and the
  corresponding activation blocker stays.
- **It does not make the semantic family a gate.** Promoting any semantic metric
  to gate-bearing requires a new ADR that states its threshold and the evidence
  for it.

## Consequences

- The maintainer can see how much of a reported failure was paraphrase and how
  much was a real defect, and can read cited-source and temporal discipline
  without the phrase matcher in the path.
- The gate becomes more expensive to run in full: the semantic family needs an
  embedding endpoint. It is opt-in through `--semantic`, and a run without it
  behaves exactly as before.
- Two providers now shape one artifact, so the manifest records the embedding
  model, dimensions, profile, input rendering hash, threshold, and sweep beside
  the language model identity.
- A cosine threshold is a tuning knob on a real system. The runner reports a
  sweep at 0.70, 0.75, 0.80, 0.85, and 0.90 rather than a single number, so the
  reader sees sensitivity instead of a chosen result.

## Rejected alternatives

- **Lower the lexical thresholds.** The debt entry asks for an honest
  instrument, not an easier bar. A gate that gets easier without justification
  is worse than one that is too hard.
- **Replace the lexical family.** Deleting it would destroy comparability with
  every recorded run and would delegate polarity to cosine.
- **An LLM judge.** It adds a second unattested model to the measurement path,
  and published audits of LLM-judged memory benchmarks report false-accept rates
  above 60%.
- **Entailment classification.** A natural-language-inference model is a new
  dependency and a new failure mode for a diagnostic that a cosine already
  answers well enough to size the paraphrase share.
- **Rewrite the fixture into full sentence equality.** That trades one lexical
  instrument for a stricter one.

## Related

- [Model-assisted memory enrichment](./0004-model-assisted-memory-enrichment.md)
- [Instrument measurement](../testing/2026-08-04-enrichment-gate-instrument.md)
- [Evaluation contract](../testing/EVALS.md)
