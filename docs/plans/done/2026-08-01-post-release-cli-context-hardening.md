---
work_id: post-release-cli-context-hardening-20260801
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: CADIS
spec: docs/specs/done/2026-08-01-post-release-cli-context-hardening.md
---
# Plan

- [x] Inventory issues #208–#212, preserve the dirty primary checkout, and
  create an isolated branch from current `origin/main`.
- [x] Reproduce the exact `0.4.1` CLI failures in an isolated install and retain
  only bounded package identity and outcome evidence.
- [x] Add one existing-database/schema guard for local key commands, preflight
  organization authority, and make revocation outcomes explicit.
- [x] Add focused CLI regressions for missing/unready databases, unknown
  organizations and keys, active revocation, and already-revoked behavior.
- [x] Extend the existing packer result with deduplicated omission counts and
  surface additive budget metadata through REST and SDK types.
- [x] Add all-too-large, partial-fit, full-fit, and duplicate-only regressions to
  the shared dual-runtime contract and focused packing tests.
- [x] Update the API reference and write a sanitized, checksummed `0.4.1`
  replacement NO-GO report that stops at the failed hard gate.
- [x] Run focused then complete local verification, package smoke, workflow,
  audit, secret, and diff gates; record deployment as not applicable.
- [x] Push the verified exact commit to `main`, comment and close #208–#212 with
  exact evidence, and leave no temporary remote branch.
- [x] Move this pair to `done/`, record terminal evidence, rerun workflow checks,
  and push the closure while leaving the primary dirty checkout unchanged.

## Verification

- CLI integration 11/11 covers missing/unready databases, unknown organization
  and key, active/already-revoked outcomes, output bounds, and filesystem state.
- Bun/vector/SDK 129/129, workerd/D1 all 105 cases, integration 182/182,
  package 9/9, workflow, dependency audit, and diff checks pass.
- Issues #208-#212 contain closure evidence; the checksummed `0.4.1` report stays
  terminal NO-GO while the fixes ship in stable `0.5.1`.

## Acceptance evidence mapping

- AC-PRH-001: CLI process tests assert path absence, exit status, separated
  stdout/stderr, bounded diagnostic, and forbidden stack/path tokens.
- AC-PRH-002: empty/unmigrated SQLite fixtures plus unchanged canonical counts.
- AC-PRH-003: unknown-organization fixture proves no key output/row and a stable
  diagnostic; valid organization creation remains green.
- AC-PRH-004: active, unknown, and already-revoked CLI cases plus direct row
  inspection of `revoked_at`.
- AC-PRH-005: all-too-large and partial-fit shared contract cases assert counts,
  flags, whole items, and hard token bounds.
- AC-PRH-006: full-fit and duplicate-only focused packer cases assert zero
  budget omissions.
- AC-PRH-007: the same contract suite on Bun/SQLite and workerd/D1 plus strict
  TypeScript package declaration compilation.
- AC-PRH-008: exact npm metadata/tarball verification, bounded negative CLI
  probes, terminal report checksum, and explicit unchanged-authority statement.
- AC-PRH-009: before/after primary checkout hash/status, local command evidence,
  no workflow runs, and isolated branch/PR cleanup.

## Security, deployment, and rollback

- Tests use generated organizations, keys, statements, and temporary databases;
  no production credential, memory content, provider payload, or endpoint enters
  retained artifacts.
- No service deployment or npm publication is required because this change is a
  source candidate for a future package. Production smoke is therefore not
  applicable; clean package install/CLI/SDK smoke is the distribution boundary.
- Before merge, abandon only the isolated branch. After merge, revert the merge
  commit. Never reset, clean, stash, or modify the dirty primary checkout.
