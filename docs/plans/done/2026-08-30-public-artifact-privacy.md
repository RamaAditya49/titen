---
work_id: public-artifact-privacy-20260830
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-30
updated: 2026-08-30
owner: CADIS
spec: docs/specs/done/2026-08-30-public-artifact-privacy.md
---

# Plan — Public artifact privacy

- [x] Add failing fixture tests for private host, domain, network, personal-path,
  and secret-location rules plus valid neutral examples.
- [x] Implement a deterministic scanner over tracked public artifacts and add it
  to the repository release gates.
- [x] Replace existing private identifiers with neutral examples while
  preserving reproducible technical meaning.
- [x] Inspect the tracked tree, package manifest, packed tarball, changelog, and
  release notes for private deployment details.
- [x] Run checker fixtures, workflow checks, package smoke, and the complete test
  suite.
- [x] Move this pair to `done/` with evidence and no unchecked work.
- [x] Keep all private upgrade commands and evidence outside the Git worktree.

## Verification mapping

- AC-PUBLIC-001 and AC-PUBLIC-004: tracked-file scan, reviewed replacement diff,
  and neutral-example assertions.
- AC-PUBLIC-002 and AC-PUBLIC-003: checker fixture tests for safe and rejected
  content, exit status, file names, and rule names.
- AC-PUBLIC-005: npm pack file listing, extracted-tarball scan, changelog review,
  and release-note review.
- AC-PUBLIC-006: clean Git status after the private upgrade and a handoff that
  records private evidence only outside public artifacts.

## Acceptance evidence map

| Acceptance | Verified evidence |
| --- | --- |
| AC-PUBLIC-001 | Complete public-tree scan and reviewed replacement diff |
| AC-PUBLIC-002 | Scanner fixture output with file and rule names |
| AC-PUBLIC-003 | Positive and negative scanner exit-status fixtures |
| AC-PUBLIC-004 | Neutral-example assertions and documentation review |
| AC-PUBLIC-005 | Extracted npm tarball and release-note scans |
| AC-PUBLIC-006 | Private operator evidence retained outside tracked files |

## Rollback

Before publication, revert only the isolated public-artifact changes. After
publication, release a corrective patch. The check has no runtime state and
needs no data rollback.

## Candidate evidence

- `pnpm check:public` passes on the complete tracked and untracked public tree.
- Fixture tests cover private host, domain, network, personal path, secret path,
  cloud account ID, and cloud resource ID classes.
- The extracted 76-file npm tarball passes the same scanner.
- The account-specific Cloudflare configuration is absent from the public tree.
- Private runtime upgrade evidence remains outside the Git worktree.
- The public release notes pass the scanner and contain only generic deployment
  evidence.
- The public site uses a sibling checkout default and no tracked Cloudflare
  account identifier. Its repository and generated site pass the scanner.
