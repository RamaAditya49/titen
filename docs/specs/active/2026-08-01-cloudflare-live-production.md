---
work_id: cloudflare-live-production
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-01
updated: 2026-08-01
review_after: 2026-08-15
owner: CADIS
---
# Prefix-isolated Cloudflare live production

## Problem

The dashboard login form exposes a maintainer-specific `rama` placeholder, and
Titen's Cloudflare evidence stops at local workerd/D1 emulation. The repository
therefore cannot truthfully claim a live D1, Vectorize, Workers AI, or Worker
deployment.

## Scope

- replace the maintainer-specific username placeholder with the canonical
  bootstrap username `owner` and keep its browser contract covered;
- provision a persistent, isolated Cloudflare stack in the authenticated Rama
  Digital account using the `titen-test-` prefix: Worker `titen-test-api`, D1
  `titen-test-db`, and Vectorize index `titen-test-claims-v1`;
- bind D1, Vectorize, and Workers AI natively, with BGE-M3 embeddings and a Cron
  Trigger for bounded background index maintenance;
- apply the canonical D1 schema, bootstrap a temporary-password owner account,
  deploy one exact revision, and verify live authentication, isolation,
  canonical persistence, semantic retrieval, dashboard-adapter behavior, and
  rollback/redeploy;
- update the Cloudflare runbook, repository maturity evidence, README status,
  package release, GitHub release, and stable titen.dev discovery only after all
  live gates pass.

## Out of scope

- enabling optional model-assisted derivation/reflection, because Workers AI
  embedding availability is not the locked extraction evaluation required by
  FR-13;
- Cloudflare Queue, KV, R2, Durable Objects, an ORM, a provider SDK, a custom
  deployment service, or GitHub Actions;
- deleting or reusing existing `titen-qa-*` or other adjacent account resources;
- claiming that an isolated `titen-test-*` verification is a customer traffic
  cutover, global availability result, or universal retrieval-quality threshold;
- storing bootstrap credentials, passwords, API keys, prompts, memory content,
  or raw embeddings in Git, docs, logs, release assets, or chat.

## Constraints and risks

- The generic `wrangler.jsonc` remains reusable; the account-specific live
  config is separate and contains only non-secret resource identifiers.
- D1 is canonical and Vectorize is rebuildable. Vectorize mutations are
  eventually consistent, so verification must retry within a declared bound.
- BGE-M3 output must match the immutable 1024-dimension cosine index contract.
  The deployment fingerprint identifies the observed Cloudflare catalog entry;
  it is not an independent attestation of provider weight immutability.
- Worker rollback does not reverse D1 migrations. A pre-change Time Travel
  bookmark and schema-compatible prior Worker version are required.

## Acceptance criteria

- **AC-CFL-001 — Ubiquitous:** Titen shall show `owner`, not a maintainer name,
  as the username example on the login form, and its browser test shall submit
  the same canonical bootstrap username.
- **AC-CFL-002 — Ubiquitous:** The checked-in Rama Digital deployment contract
  shall name every provisioned resource with the `titen-test-` prefix, bind D1,
  Vectorize, Workers AI, and Cron natively, and contain no credential or account
  API token.
- **AC-CFL-003 — Event-driven:** When the exact release candidate is deployed to
  `titen-test-api`, `/healthz` shall return healthy and `/readyz` shall report the
  deployed revision, current schema, and configured semantic capability without
  a partial-tuple or dependency error.
- **AC-CFL-004 — Event-driven:** When an authorized principal writes evidence and
  drains indexing, Titen shall persist canonical D1 state, complete a live
  Workers AI embedding and Vectorize upsert, and retrieve the intended claim for
  a keyword-free semantic query within 60 seconds.
- **AC-CFL-005 — Unwanted behavior:** If a protected live request is missing a
  credential or uses a principal outside the target organization/project, then
  Titen shall return a non-disclosing denial and shall expose no foreign content,
  count, or topology.
- **AC-CFL-006 — Event-driven:** When the live Worker receives a fresh request
  after deployment and canonical writes, Titen shall retain the written evidence
  and return the same authorized result without relying on isolate memory.
- **AC-CFL-007 — State-driven:** While the dashboard adapter targets the live
  Worker, a bootstrapped human owner shall complete forced password replacement,
  sign in with an HttpOnly session, discover all authorized product areas, add a
  bounded-role user, and receive no product shell before password replacement.
- **AC-CFL-008 — Unwanted behavior:** If the candidate Worker is rolled back,
  then the previous schema-compatible version shall become ready without losing
  canonical D1 data; redeploying the candidate shall restore semantic readiness
  and the authenticated live smoke.
- **AC-CFL-009 — Event-driven:** When all local, live, security, persistence,
  dashboard, and rollback gates pass, maintainers shall record reproducible
  non-secret evidence, update the status from Planned, publish one exact stable
  npm/GitHub version, update titen.dev stable discovery, and leave no active work
  artifact or unabsorbed release branch.

## Done conditions

Every acceptance criterion has current reproducible evidence; the retained
Cloudflare resource names, deployed revision, Worker URL, D1 bookmark, semantic
fingerprint, test counts, rollback result, package/tag, and titen.dev manifest
agree; credentials remain outside durable evidence; and this pair is moved to
`done` with no unchecked plan item.
