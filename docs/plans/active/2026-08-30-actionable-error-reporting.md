---
work_id: actionable-error-reporting-20260830
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-30
updated: 2026-08-30
review_after: 2026-09-13
owner: CADIS
spec: docs/specs/active/2026-08-30-actionable-error-reporting.md
---

# Actionable Error Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add safe actionable error guidance and a verified agent-owned GitHub issue workflow, then release it to npm, titen.dev, and `server-wulan`.

**Architecture:** Keep existing public error codes and attach constant support guidance in response metadata. Add project-specific recovery metadata only to the caller-supplied reference path. Preserve that metadata through MCP and teach every distributed agent skill to triage before it uses host GitHub authority.

**Tech Stack:** TypeScript 5.9, Web Standards APIs, Bun 1.3, SQLite, Cloudflare D1, MCP JSON-RPC, pnpm 11, npm, GitHub CLI, and systemd.

**Spec:** `docs/specs/active/2026-08-30-actionable-error-reporting.md`

## Global constraints

- Preserve the nine-tool MCP contract.
- Preserve existing HTTP statuses and public error codes.
- Do not add a dependency, migration, provider, or server-side GitHub token.
- Do not expose secrets, memory content, prompts, request bodies, stacks, or provider responses.
- Do not add GitHub Actions or automated deployment.
- Use the exact CADIS commit trailer.
- Wait for browser approval before npm publication.
- Keep Mem0 active on `server-wulan`.

---

### Task 1: Establish the active work lifecycle

**Files:**

- Create: `docs/specs/active/2026-08-30-actionable-error-reporting.md`
- Create: `docs/plans/active/2026-08-30-actionable-error-reporting.md`

**Interfaces:**

- Consumes: `docs/engineering/requirements-workflow.md`.
- Produces: EARS criteria `AC-AER-001` through `AC-AER-018` and this evidence map.

- [x] **Step 1: Validate the active spec and plan.**

  Run: `node scripts/check-workflow-docs.mjs`

  Expected: PASS with the new active pair.

- [x] **Step 2: Commit the approved spec and plan.**

  Commit subject: `docs: rencanakan pelaporan error actionable`

### Task 2: Add bounded REST error guidance

**Files:**

- Modify: `src/core/errors.ts`
- Modify: `src/core/http.ts`
- Modify: `src/core/projects.ts`
- Modify: `tests/contract/cases.ts`

**Interfaces:**

- Produces: `supportGuidance(error: ApiError): ErrorSupportGuidance`.
- Produces: `meta.support.classification`, `meta.support.action`, and `meta.support.docs_url`.
- Produces on missing project reference: `meta.reason`, `meta.reference`, and `meta.can_create`.

- [x] **Step 1: Write dual-runtime failing contract assertions.**

  Extend `resolution never creates a project without the create capability`.
  Assert `404 NOT_FOUND`, `project_not_registered`, normalized reference,
  truthful `can_create`, and no created project.

- [x] **Step 2: Run the Bun contract and confirm RED.**

  Run: `bun test tests/contract/bun-sqlite.test.ts --test-name-pattern "resolution never creates"`

  Expected: FAIL because the metadata does not exist.

- [x] **Step 3: Implement constant support guidance and resolver metadata.**

  Build actions and documentation URLs from allowlisted constants. Do not use an
  exception message or request body.

- [x] **Step 4: Run the focused Bun contract and confirm GREEN.**

  Run the Step 2 command.

  Expected: PASS.

- [x] **Step 5: Run the same contract on D1.**

  Run: `pnpm build:worker && pnpm test:d1`

  Expected: PASS, including the resolver assertions.

### Task 3: Preserve safe metadata through MCP and SDK

**Files:**

- Modify: `src/core/mcp.ts`
- Modify: `src/sdk.ts`
- Modify: `tests/integration/mcp-protocol.test.ts`
- Modify: `tests/sdk/sdk.test.ts`

**Interfaces:**

- MCP error text keeps top-level `code` and `message` and adds `meta`.
- `meta.request_id` identifies the MCP HTTP request.
- `TitenError.meta.support` preserves the REST guidance unchanged.

- [x] **Step 1: Write failing MCP and SDK tests.**

  Make a missing-project tool call and assert the resolver metadata, support
  guidance, and request ID. Make an SDK request and assert the same metadata.

- [x] **Step 2: Run focused tests and confirm RED.**

  Run: `bun test tests/integration/mcp-protocol.test.ts tests/sdk/sdk.test.ts`

  Expected: FAIL because MCP drops `ApiError.meta` and support guidance is absent.

- [x] **Step 3: Implement the minimal metadata preservation.**

  Reuse the central support helper. Keep unknown exceptions at the fixed
  `Tool execution failed.` text.

- [x] **Step 4: Run focused tests and confirm GREEN.**

  Run the Step 2 command.

  Expected: PASS.

### Task 4: Define the host-owned issue workflow

**Files:**

- Modify: `skills/titen-memory/SKILL.md`
- Modify: `plugins/titen-memory/skills/titen-memory/SKILL.md`
- Modify: `plugins/claude/titen-memory/skills/titen-memory/SKILL.md`
- Modify: `plugins/cursor/titen-memory/skills/titen-memory/SKILL.md`
- Modify: `plugins/hermes/titen-memory/skills/titen-memory/SKILL.md`
- Modify: `plugins/pi/titen-memory/skills/titen-memory/SKILL.md`
- Modify: `tests/integration/agent-plugin.test.ts`

**Interfaces:**

- Consumes: safe REST/MCP error envelope.
- Produces: one identical triage and reporting policy for every host package.

- [x] **Step 1: Add the canonical triage policy.**

  Require expected recovery, synthetic reproduction, version/runtime checks,
  duplicate search, private security reporting, and a sanitized issue or draft.

- [x] **Step 2: Copy the exact policy to every distributed skill.**

  Keep all six files byte-identical.

- [x] **Step 3: Extend the artifact consistency test.**

  Assert byte identity and required safety boundaries. Do not claim this test
  evaluates model behavior.

- [x] **Step 4: Run the agent package test.**

  Run: `bun test tests/integration/agent-plugin.test.ts`

  Expected: PASS.

### Task 5: Document the public behavior

**Files:**

- Modify: `docs/reference/api.md`
- Modify: `docs/agent-guide.md`
- Modify: `docs/architecture/agent-integration.md`
- Modify: `docs/FRD.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Documents the additive `meta.support` contract.
- Documents expected resolver recovery and host-owned GitHub issue authority.

- [x] **Step 1: Update the API reference.**

  Add the exact support fields, classifications, resolver fields, and MCP
  preservation behavior.

- [x] **Step 2: Update the agent guide and integration architecture.**

  Add the triage sequence, report fields, security path, and draft fallback.

- [x] **Step 3: Update README and Unreleased changelog.**

  State that agents distinguish setup errors from verified defects. Do not claim
  automatic server-side issue creation.

- [x] **Step 4: Run route, workflow, and diff checks.**

  Run: `pnpm check:routes && pnpm check:workflow && git diff --check`

  Expected: PASS.

### Task 6: Verify implementation and request review

**Files:**

- Modify only files needed to fix verified review findings.

**Interfaces:**

- Produces: a release candidate that satisfies `AC-AER-001` through `AC-AER-015`.

- [x] **Step 1: Run changed-scope tests.**

  Run: `pnpm test:api && pnpm test:integration && pnpm check:workflow`

  Expected: PASS with zero failures.

- [x] **Step 2: Run package verification.**

  Run: `bash scripts/verify-pack.sh`

  Expected: PASS for packed SDK, CLI, server, root dashboard, and global install.

- [x] **Step 3: Review the complete diff against the spec.**

  Check authorization, disclosure, compatibility, every acceptance criterion,
  and all distributed skill copies. Fix Critical and Important findings.

- [x] **Step 4: Commit and push implementation.**

  Commit subject: `feat: beri panduan error actionable`

### Task 7: Prepare and publish patch release

**Files:**

- Modify: `package.json`
- Modify: lockfile only if the repository release sync requires it.
- Modify: versioned plugin manifests required by `release:sync`.
- Modify: `CHANGELOG.md`

**Interfaces:**

- Produces: `titen-memory@0.9.1`, tag `v0.9.1`, and matching GitHub Release.

- [x] **Step 1: Set version `0.9.1` and close the changelog heading in UTC.**

  Use `0.9.1` because the public change is additive and compatible.

- [x] **Step 2: Run the complete local release gate.**

  Run: `pnpm test:all && bash scripts/verify-pack.sh`

  Expected: PASS with zero failures.

- [x] **Step 3: Commit and push the release candidate.**

  Commit subject: `chore: siapkan rilis error actionable 0.9.1`

- [ ] **Step 4: Start `npm publish` with the explicit npmjs registry.**

  Run: `npm publish --registry https://registry.npmjs.org`

  Expected: npm requests browser approval or publishes after existing approval.

- [ ] **Step 5: Wait for Rama's browser approval when requested.**

  Poll the same live publish process. Do not restart it or claim publication
  before npm returns success.

- [ ] **Step 6: Verify registry integrity and release date.**

  Check npm `latest`, `gitHead`, integrity, shasum, file count, unpacked size,
  and the UTC changelog date.

- [ ] **Step 7: Create and push the annotated tag and generated GitHub Release.**

  Use `scripts/changelog-section.sh` for the release body.

### Task 8: Deploy the website changelog

**Files:**

- Modify in `/home/ramaaditya/Project/titen-web`: generated release metadata,
  release page, and any version assets produced by `pnpm release:sync 0.9.1`.

**Interfaces:**

- Consumes: published npm release, Git tag, and GitHub Release.
- Produces: live `titen.dev/version.json` and `/releases/0.9.1`.

- [ ] **Step 1: Inspect and isolate the current `titen-web` worktree.**

  Preserve unrelated work and branch from current `origin/main`.

- [ ] **Step 2: Run release synchronization and build.**

  Run: `pnpm release:sync 0.9.1 && pnpm release:sync 0.9.1 --check && pnpm build`

  Expected: PASS with matching npm, tag, release, and metadata.

- [ ] **Step 3: Commit, push, and deploy manually.**

  Preserve the repository's commit attribution rules.

- [ ] **Step 4: Smoke the public website.**

  Verify both hostnames, `/version.json`, `/releases/0.9.1`, homepage badge, and
  changelog content.

### Task 9: Upgrade and verify `server-wulan`

**Files:**

- Remote package and service state under `/opt/titen` and `/etc/systemd/system`.
- Backup under `/var/backups/titen/<timestamp>-pre-0.9.1`.

**Interfaces:**

- Consumes: published `titen-memory@0.9.1`.
- Produces: running API and dashboard services at revision `npm-0.9.1`.

- [ ] **Step 1: Inspect current remote revision, service units, drop-ins, schema, and database counts.**

  Use direct `ssh server-wulan`. Fall back through `rama-tuf` only if direct
  access fails.

- [ ] **Step 2: Create and verify a rollback backup.**

  Include canonical database, vector projection, package files, environment,
  service units, drop-ins, modes, checksums, and a restore note.

- [ ] **Step 3: Install exact package `0.9.1`.**

  Use `bun add --exact titen-memory@0.9.1 --registry https://registry.npmjs.org`.

- [ ] **Step 4: Set the effective service revision and restart services.**

  Inspect `systemctl show`, `systemctl cat`, and `DropInPaths` before restart.

- [ ] **Step 5: Run production smoke.**

  Verify service active state, CLI/package version, `/healthz`, `/readyz`, schema,
  SQLite quick check, preserved counts, dashboard/root 200, protected route 401,
  MCP unauthenticated 401, and recent error logs.

- [ ] **Step 6: Roll back if any required smoke fails.**

  Restore `0.9.0`, the database and package backup, and the prior revision
  drop-in. Repeat the smoke and report the verified rollback.

### Task 10: Close workflow evidence

**Files:**

- Move: `docs/specs/active/2026-08-30-actionable-error-reporting.md` to `docs/specs/done/2026-08-30-actionable-error-reporting.md`
- Move: `docs/plans/active/2026-08-30-actionable-error-reporting.md` to `docs/plans/done/2026-08-30-actionable-error-reporting.md`

**Interfaces:**

- Produces: terminal evidence for `AC-AER-001` through `AC-AER-018`.

- [ ] **Step 1: Record exact test, npm, website, backup, and production evidence.**

- [ ] **Step 2: Check every plan item and acceptance mapping.**

- [ ] **Step 3: Set `status: done`, `stage: done`, and `outcome: completed`.**

- [ ] **Step 4: Move both artifacts to `done/` and update the plan spec path.**

- [ ] **Step 5: Run final workflow and repository checks.**

  Run: `node scripts/check-workflow-docs.mjs --self-test && node scripts/check-workflow-docs.mjs && git diff --check`

  Expected: PASS.

- [ ] **Step 6: Commit and push closure evidence.**

  Commit subject: `docs: tutup rilis error actionable 0.9.1`

## Acceptance evidence map

| Acceptance | Planned evidence |
| --- | --- |
| AC-AER-001 | Dual-runtime missing-project contract test |
| AC-AER-002 | Dual-runtime normalized reference and capability assertions |
| AC-AER-003 | Project-row count before and after missing resolve |
| AC-AER-004 | Existing limited-credential create denial contract |
| AC-AER-005 | Existing status/code assertions plus full contract suite |
| AC-AER-006 | REST contract assertions for expected, investigate, and defect-candidate guidance |
| AC-AER-007 | MCP integration test with metadata and request ID |
| AC-AER-008 | Foreign-project contract with absent route-specific metadata |
| AC-AER-009 | MCP unknown-exception sanitization regression |
| AC-AER-010 | Distributed artifact byte-identity test |
| AC-AER-011 | Skill safety policy and verified expected resolver recovery |
| AC-AER-012 | Skill policy, duplicate search evidence, and any issue URL created during verified use |
| AC-AER-013 | Skill draft fallback contract |
| AC-AER-014 | Skill security path and `SECURITY.md` link |
| AC-AER-015 | API, agent-guide, architecture, README, and route-doc checks |
| AC-AER-016 | npm, tag, GitHub Release, and titen.dev version agreement |
| AC-AER-017 | Browser approval plus successful npm publish process |
| AC-AER-018 | Verified backup and `server-wulan` production smoke or rollback |
