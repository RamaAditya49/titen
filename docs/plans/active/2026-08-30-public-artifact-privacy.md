---
work_id: public-artifact-privacy-20260830
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-08-30
updated: 2026-08-30
review_after: 2026-09-13
owner: CADIS
spec: docs/specs/active/2026-08-30-public-artifact-privacy.md
---

# Plan — Public artifact privacy

- [ ] Add failing fixture tests for private host, domain, network, personal-path,
  and secret-location rules plus valid neutral examples.
- [ ] Implement a deterministic scanner over tracked public artifacts and add it
  to the repository release gates.
- [ ] Replace existing private identifiers with neutral examples while
  preserving reproducible technical meaning.
- [ ] Inspect the tracked tree, package manifest, packed tarball, changelog, and
  release notes for private deployment details.
- [ ] Run checker fixtures, workflow checks, package smoke, and the complete test
  suite.
- [ ] Move this pair to `done/` with evidence and no unchecked work.
- [ ] Keep all private upgrade commands and evidence outside the Git worktree.

## Verification mapping

- AC-PUBLIC-001 and AC-PUBLIC-004: tracked-file scan, reviewed replacement diff,
  and neutral-example assertions.
- AC-PUBLIC-002 and AC-PUBLIC-003: checker fixture tests for safe and rejected
  content, exit status, file names, and rule names.
- AC-PUBLIC-005: npm pack file listing, extracted-tarball scan, changelog review,
  and release-note review.
- AC-PUBLIC-006: clean Git status after the private upgrade and a handoff that
  records private evidence only outside public artifacts.

## Rollback

Before publication, revert only the isolated public-artifact changes. After
publication, release a corrective patch. The check has no runtime state and
needs no data rollback.
