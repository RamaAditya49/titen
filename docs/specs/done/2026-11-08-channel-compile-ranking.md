---
work_id: channel-compile-ranking
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-08
updated: 2026-11-08
owner: maintainers
---
# Task-ranked channel context compile

Issue #381. The channel compile read releases oldest first with a fixed limit
of 200 and used `task` only to count tokens. A release past the 200th
activation could never be served. A small budget filled with the oldest
releases, and newer corrections dropped first. The response did not say what it
left out.

Scope: `src/core/governance.ts` (`compileChannelContext`), one migration in
`src/core/migrations.ts`, and `docs/reference/api.md`. Retrieval code is reused
and not changed.

## Design

Migration 28 adds `channel_release_fts`, scoped by organization and channel like
`claims_fts`. It backfills active releases. Triggers on `channel_releases` add a
row when a release becomes active and remove it when the release leaves the
active state or is deleted.

The compile query applies every eligibility rule first: organization, channel,
audience, active lifecycle, validity window, claim head, `minimum_trust`, and
retention exclusions. It then orders matching releases by `bm25`, followed by
non-matching releases newest activation first. A task with no terms skips the
index and orders by newest activation. The 200-release bound applies after
ordering. A separate count of eligible releases gives `omitted_items`.
`budget_exhausted` marks a release that did not fit in `max_tokens`.

## Acceptance criteria

- **AC-REL-001 — Event-driven:** When a channel has an active release whose content matches the terms of `task`, Titen shall include that release ahead of non-matching releases within `max_tokens`.
- **AC-REL-002 — Event-driven:** When a channel has more than 200 eligible releases, Titen shall be able to return any one of them for a `task` that matches it.
- **AC-REL-003 — Event-driven:** When `task` has no indexable terms, Titen shall order eligible releases newest activation first.
- **AC-REL-004 — Event-driven:** When eligible releases are left out because of budget or the candidate bound, Titen shall report `omitted_items` greater than 0.
- **AC-REL-005 — Unwanted behavior:** If a release is revoked, expired, below the channel `minimum_trust`, or under a retention exclusion, then Titen shall not return it, regardless of relevance.

## Done conditions

The contract case passes on Bun and the D1 harness. A migration test shows that
releases active before the migration are searchable after it. Existing release
and retention checks still pass.

## Completion evidence

All five acceptance criteria passed; the paired plan maps each to its check.
