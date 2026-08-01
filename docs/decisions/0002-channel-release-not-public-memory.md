# ADR-0002: Release approved knowledge through channels

- Status: accepted
- Date: 2026-07-27
- Decision owners: Titen maintainers

## Context

Company and enterprise deployments may use Titen behind CRM, website, support,
or messaging chatbots. Those channels need approved knowledge that customers or
partners may receive. Making canonical memory directly public would conflate
evidence quality, internal authorization, and external distribution. A verified
claim can still be confidential, contain personal data, or be unsuitable for a
particular audience.

## Decision

Titen keeps three independent axes:

1. `trust` describes evidence authority;
2. `visibility` controls internal retrieval as `private`, `team`, or
   `organization`;
3. a versioned `knowledge_release` explicitly permits a reviewed snapshot to be
   served through one operator-managed channel and audience.

Initial external audiences are `anonymous`, `authenticated_customer`, and
`partner`. A release references one exact claim version and contains the
approved, possibly redacted or localized content. It records its channel,
audience, approval actor, validity window, status, and revocation history.

`verified` never implies publishable. Creating or activating a release requires
an explicit capability and the configured approval policy. Automatic
classification, tags, similarity, feedback, or model output cannot publish
memory.

External users do not receive Titen credentials or query canonical memory. A
CRM/chatbot gateway authenticates as a service principal and compiles context
from active releases for its channel. Authenticated customer context may also
include memory for the server-resolved customer subject; anonymous callers
cannot supply an arbitrary `subject_id`.

Authenticated-customer channel requests carry a short-lived HMAC-SHA256
assertion from the channel's authenticated gateway. The key is supplied by the
operator and encrypted under Titen's existing external keyring. Titen validates
the signature, channel/audience binding, maximum 15-minute expiry, and one-use
nonce before resolving the subject. It does not accept a raw public
`subject_id`. A future centrally managed/asymmetric issuer may replace this
bounded gateway contract without changing the payload claims.

Release FTS/vector indexes are rebuildable projections of canonical release
rows. Activation and revocation become visible before the next eligible channel
context. Live transactional data such as balances, inventory, payment state,
and order status remains the responsibility of its source API rather than a
stale memory claim.

Channel eligibility also requires the referenced claim version to remain the
current active, undisputed source. A claim version change, dispute,
supersession, expiry, or revocation immediately makes the release ineligible;
background work records it as suspended and a new review is required.

## Consequences

- public-facing chatbots can use governed knowledge without opening the memory
  API or internal evidence;
- one claim may have different approved snapshots for different channels,
  audiences, locales, or validity windows;
- release approval, retrieval, replacement, expiry, and revocation require
  audit and isolation tests;
- customer-specific memory stays separate from anonymous/shared knowledge;
- v0.3 adds channel/release contracts alongside policy and approval features;
- the base Level 5 kernel and v0.2 collaboration path remain unchanged.

## Rejected alternatives

- **Add `public` to memory visibility:** too easy to expose raw or later-mutated
  canonical content and too ambiguous about channel and audience.
- **Treat every verified claim as public:** evidence authority is not a
  disclosure decision.
- **Expose an unauthenticated Titen search endpoint:** moves abuse control and
  tenant isolation into the memory kernel and gives external callers too much
  reach.
- **Copy knowledge into a separate manual database:** loses provenance,
  revocation, portability, and one-source lifecycle guarantees.
