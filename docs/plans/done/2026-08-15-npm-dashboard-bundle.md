---
work_id: npm-dashboard-bundle
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-15
updated: 2026-08-15
owner: titen-maintainers
spec: docs/specs/done/2026-08-15-npm-dashboard-bundle.md
---

# Plan: npm dashboard distribution

- [x] Add the packaged dashboard command and artifact paths with no new
  dependency or credential surface.
- [x] Make `prepack` build dashboard and SDK artifacts and include only the
  required dashboard/adapter files in the npm tarball.
- [x] Update README and titen-web install/dashboard documentation.
- [x] Run focused CLI, adapter, browser, build, pack, and workflow checks.
- [x] Publish the patch release, verify a clean install, and deploy the website
  release metadata.
- [x] Close this spec/plan with registry, install, and rollback evidence.

## Acceptance evidence map

| Acceptance | Evidence |
| --- | --- |
| AC-NDB-001 | npm pack file manifest and secret/mockup exclusion scan |
| AC-NDB-002 | CLI help/port validation and packaged adapter smoke |
| AC-NDB-003 | prepack build plus isolated install version check |
| AC-NDB-004 | existing adapter/session and browser suites |
| AC-NDB-005 | README/docs website build and production smoke |

## Rollback

Unpublish is not used. Revert the release commit and tell users to pin the
previous npm version; restore the previous website release and dashboard bundle
from the recorded deployment backup if needed.

Source rollback is a revert of `47172bf`; npm consumers can pin `0.8.1`.
server-wulan can restore package, dashboard environment, unit, and revision
files from `/opt/titen/backups/npm-dashboard-0.8.2-20260815T021206Z`.

## Verification

`pnpm test:all`, the 70-file pack manifest inspection, `scripts/verify-pack.sh`,
registry install, GitHub release, website build/deploy smoke, and server-wulan
packaged-dashboard smoke passed. The paired spec records exact acceptance
evidence and the unchanged upstream readiness condition.
