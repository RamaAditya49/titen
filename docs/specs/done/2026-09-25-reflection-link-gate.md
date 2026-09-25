---
work_id: reflection-link-gate
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-09-25
updated: 2026-09-25
owner: CADIS
---
# Reflection link gate

## Problem

A shadow test on a live store showed that the derivation gate saves almost nothing: only 3% of derivations abstain, and at the default threshold the gate skipped 1 of 60. Reflection is the larger lane (2,808 jobs), and 96% of its outcomes are link-only. A link is a pairwise classification, and a decision model does that well.

## Evidence

Shadow run on 130 past reflection jobs (3,633 premise pairs, TypeSafe `jev-1.13.0`, one request per job, 331 ms mean):

- Jev returned "none" for 0 of the 348 pairs that the generative model linked.
- Manual adjudication of sampled disagreements: Jev was right on 7/7 duplicates the model missed, on 3/3 supersessions at confidence ≥ 0.5, and on 4/4 related pairs at confidence ≥ 0.85. It was wrong on a conflict at 0.28. It sometimes called true duplicates "related".
- A synthesis yes/no question did not separate add jobs (median 0.60) from link jobs (median 0.70). Jev must not decide synthesis.
- The generative model ordered supersession links inconsistently (110 newer-first, 70 older-first).

## Scope

Let the decision gate answer reflection jobs with a link-only proposal when at least one premise pair is confident. Keep claim synthesis with the generative model.

## Out of scope

Synthesis routing, reflection scheduling, compile-time use, and changing link semantics.

## Acceptance criteria

- **AC-RLG-001 — Event-driven:** When a reflection job has at least one pair at or above the link threshold, Titen shall return a link-only proposal without the generative call.
- **AC-RLG-002 — Ubiquitous:** Titen shall put the newer claim first in a supersession link and shall drop a supersession pair with equal or missing dates.
- **AC-RLG-003 — Ubiquitous:** Titen shall require confidence of at least 0.9 for a conflict link and shall keep at most eight links, ordered conflict, supersession, duplicate, related.
- **AC-RLG-004 — Event-driven:** When no pair is confident, an answer is malformed, or the gate fails, Titen shall continue to the generative call.
- **AC-RLG-005 — Unwanted behavior:** If `TITEN_EXTRACT_GATE_LANES` names an unknown lane or the link threshold is outside [0.5, 1), then Titen shall report `configured_error`.
- **AC-RLG-006 — Ubiquitous:** Titen shall keep `derivation` as the default lane and shall fold lanes and link threshold into the provider identity.

## Done conditions

Focused tests and the contract suite pass on `rama-tuf`, a live shadow run through the shipped code passes, and the docs list the new variables.
