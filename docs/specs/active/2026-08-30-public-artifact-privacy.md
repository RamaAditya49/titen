---
work_id: public-artifact-privacy-20260830
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-30
updated: 2026-08-30
review_after: 2026-09-13
owner: CADIS
---

# Public artifact privacy

## Problem

This repository is an open-source product. Tracked documentation and package
artifacts must not expose private deployment names, private network identifiers,
personal filesystem paths, or operational commands tied to one private runtime.
Historical evidence currently uses some environment-specific examples.

## Scope and constraints

This work replaces private environment identifiers in the current public tree
with generic examples. It adds a deterministic local release check for known
private identifier classes. The check scans tracked source, documentation,
package files, and generated public metadata. It does not rewrite Git history.

Private backup, deployment, and smoke evidence stays outside the repository.
Generic security and deployment guidance remains public and reproducible.

## Requirements

- **AC-PUBLIC-001 — Ubiquitous:** Tracked public artifacts shall not contain a
  private host name, private domain, private network identifier, personal home
  path, credential, or environment-specific secret location.
- **AC-PUBLIC-002 — Event-driven:** When a maintainer runs the public-artifact
  check, it shall scan the tracked release surface and shall report each match
  with its file and rule without printing a secret value.
- **AC-PUBLIC-003 — Unwanted behavior:** If a forbidden identifier appears in a
  tracked release artifact, then the public-artifact check shall exit nonzero.
- **AC-PUBLIC-004 — Ubiquitous:** Public examples shall use neutral domains,
  neutral host names, environment variables, or documented placeholders.
- **AC-PUBLIC-005 — Ubiquitous:** The npm tarball and public release notes shall
  contain no private deployment evidence or private rollback instructions.
- **AC-PUBLIC-006 — State-driven:** While a private runtime is upgraded, its
  backup paths, service details, endpoint names, and smoke evidence shall remain
  outside tracked repository files and public release content.

## Non-goals

This work does not rewrite Git history. It does not delete public technical
evidence that can be retained with neutral identifiers. It does not publish a
private deployment guide or private inventory.

## Done conditions

The public-artifact check passes on the tracked tree and packed npm tarball. The
checker has positive and negative fixture tests. Existing environment-specific
examples use neutral values. Private upgrade evidence exists only in the
operator handoff. The paired plan has no unchecked item, and both artifacts move
to `done/`.
