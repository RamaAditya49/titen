---
work_id: enrichment-gate-semantic-instrument
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
---

# A semantic contract family beside the frozen lexical one

## Outcome

Completed. `scripts/benchmark-enrichment-model.ts` now reports two metric
families over the same trials: the frozen lexical contract family, unchanged,
and a diagnostic semantic contract family that pairs a proposed claim to a gold
claim by embedding cosine under the operator embedding profile. Safety,
cited-source, and temporal outcomes stay exact in both families. Gates stay
keyed on the lexical family. No candidate passes, and enrichment stays off.

## Problem

The enrichment activation gate has never been passed. The best candidate on
2026-08-04, `cx/gpt-5.6-luna` in JSON-object mode, scored 65.56% lexical
contract pass against a 90% threshold. The 2026-07-31 full lane recorded claim
F1 55.98%, exact cited-source F1 48.84%, minimum kind/language lexical recall
0%, temporal accuracy 61.04%, and reflection accuracy 25.83%.

`PONYTAIL-DEBT.md` asks whether the gate measures the right thing. It does not,
for a reason larger than paraphrase tolerance.

`lexicalContractMatch()` requires every gold concept slot to appear in the
proposed claim as a whole normalized token sequence. A model that writes a
correct claim in its own words fails that test. That much was known.

The measured defect is the cascade. `scoreProposal()` attributed evidence
identifiers and validity instants only to claims that had already matched
lexically. An unmatched claim therefore scored zero cited sources and a failed
temporal check even when the model cited the right evidence identifier and the
right instants. Cited-source F1 and temporal accuracy were not independent
measurements of citation or time discipline; they were downstream of a phrase
matcher.

Decomposing the 360 trials of the 2026-07-31 full Luna lane confirms it. Of 136
failing trials, none failed on claim text alone: every one of the 39 trials
whose only defect was an unmatched claim also recorded a source failure and a
temporal failure produced by that same unmatched claim.

## Scope

In scope: the measurement instrument. `scripts/benchmark-enrichment-model.ts`,
its fixture `tests/fixtures/enrichment-model-gate-v3.json`, and the published
evidence for the affected lane.

Out of scope: the production enrichment contract, the validator, the prompts,
the activation thresholds, and activation itself. `src/core/enrichment.ts` and
`src/core/validate.ts` are unchanged, and the runner still hashes both and
refuses a gate run when they differ from the commit under test.

## Acceptance criteria

**AC-EGI-001 — Ubiquitous:** The runner shall report both a lexical contract
family and a semantic contract family computed over the same trials, the same
proposals, and the same gold, and the lexical family shall keep the definition
and field names it had before this change.

**AC-EGI-002 — Ubiquitous:** No-memory safety, cited-source agreement, and
validity-instant agreement shall compare exact identifiers and exact instants in
every family, so a fabricated evidence identifier or a shifted validity window
shall fail however the claim is phrased.

**AC-EGI-003 — Optional feature:** Where the semantic family is enabled, the
runner shall pair a proposed claim with a gold claim by embedding cosine
computed with the operator embedding profile that the product itself selects
for the configured embedding model, and shall record the pairing threshold and a
threshold sweep in the artifact.

**AC-EGI-004 — Unwanted behavior:** If a proposed claim carries a negation
marker, a claim kind other than the gold kind, or a term the fixture forbids for
that claim, then the semantic family shall refuse the pairing at any cosine,
including maximum similarity.

**AC-EGI-005 — Ubiquitous:** Activation gates shall be computed from the lexical
family only, the artifact shall state that semantic metrics are diagnostic, and
no run shall report a model as passing the activation gate.

**AC-EGI-006 — Unwanted behavior:** If the gate sources differ from the commit
under test, then the run shall proceed only under an explicit unfrozen flag, and
shall record `source_frozen: false` and force every gate false.

**AC-EGI-007 — Event-driven:** When a fixture gold claim is loaded, the runner
shall assert that its canonical reference statement satisfies the lexical
contract of that same gold claim, so both families score one gold meaning.

## Non-goals

Semantic precision adjudication stays absent. Cosine cannot reject an unsupported
assertion appended to a correct claim, and the runner keeps
`semantic_precision_adjudicated: false` and keeps the corresponding activation
blocker.

Lowering a threshold is not in scope. A gate that becomes easier without
justification is worse than a gate that is too hard.
