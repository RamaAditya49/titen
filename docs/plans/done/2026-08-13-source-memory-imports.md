---
work_id: source-memory-imports
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-13
updated: 2026-08-13
owner: ramaaditya
spec: docs/specs/done/2026-08-13-source-memory-imports.md
---

# Source-memory import and release usability plan

Rama authorized implementation, publication, and website synchronization on
2026-08-13. Execute only the bounded steps below.

## Steps

- [x] Freeze small synthetic fixtures for every shipped profile plus malformed,
      unknown-envelope, symlink, unsafe-Unicode, secret, duplicate, oversized, and
      cross-scope cases. Add focused Honcho missing/duplicate page, Letta
      agent/block-reference/ignored-field/environment-value, MemoMind version,
      Basic Memory grammar, rule-frontmatter/reference, and native-import
      regression fixtures. No real user export enters the repository.
      (AC-SMI-001, AC-SMI-008, AC-SMI-009, AC-SMI-013, AC-SMI-016 through
      AC-SMI-018)
- [x] Add one Bun-side source normalizer with a data table for all 16 profile
      allowlists/classifications and only four parser families: deterministic
      Markdown/text blocks, bounded flat JSON records with the existing Mem0
      mapping factored out of `titen audit`, Honcho page assembly, and Letta
      AgentFile projection. Keep sorted selection, source fingerprints, and one
      bounded preview; use only built-in filesystem, JSON, and Web Crypto support.
      (AC-SMI-001, AC-SMI-002, AC-SMI-008, AC-SMI-009, AC-SMI-012,
      AC-SMI-015 through AC-SMI-017)
- [x] Add `titen import-source` with explicit profile/scope arguments, dry-run by
      default, mutually exclusive local-database and environment-only served target
      selection, and no credential flag or implicit vendor discovery. (AC-SMI-001,
      AC-SMI-002, AC-SMI-004, AC-SMI-010, AC-SMI-012, AC-SMI-015)
- [x] Route accepted entries through the existing principal/project,
      observation, and consolidation handlers; assign deterministic source IDs,
      run IDs, provenance, and idempotency keys; keep imported trust at unverified
      or asserted; preserve procedural-versus-semantic classification without
      activating rules as policy. (AC-SMI-003 through AC-SMI-007, AC-SMI-010
      through AC-SMI-012, AC-SMI-015, AC-SMI-017)
- [x] Make partial apply resumable by stable ordering and replay, report only
      bounded counts/locators, and add an injected-failure test that completes on an
      exact rerun with no duplicate observations or claims. (AC-SMI-006,
      AC-SMI-011)
- [x] Prove FTS-only recall and evidence linkage against the shared Bun/SQLite
      and workerd/D1 contract harnesses; keep source parsing Bun-side and canonical
      behavior runtime-neutral. Re-run the existing Titen JSONL and reference-graph
      import contracts without modifying their expected output. (AC-SMI-003,
      AC-SMI-007, AC-SMI-012, AC-SMI-018)
- [x] Keep context compilation claim-only, count only authorized observations
      with no claim source in the effective subject/project scope, expose the
      bounded diagnostic, and document the observation-to-claim transition.
      (AC-SMI-019)
- [x] Resolve omitted Bun service database flags to `~/.titen/service.db`, create
      its parent only for commands that create state, refuse a missing store in
      `serve`, print the absolute path, and fail closed when a legacy cwd
      `titen.db` would otherwise be bypassed. (AC-SMI-020, AC-SMI-021)
- [x] Document the CLI, all 16 profile allowlists and parser families, the fixed
      Mem0/Honcho/Letta/MemoMind field mappings, rule non-activation boundary,
      limits, preview/apply/backup flow, deferred-source gates, and the snapshot-
      versus-cutover boundary in the API reference and agent/operator guides.
      (AC-SMI-013 through AC-SMI-017)
- [x] Update the `titen-web` Unix installer and its local contract checks for
      non-resolvable PATH failure, the `TITEN_BIN` line, and `--print-path`; update
      install/import docs without adding a JSON protocol or shell-profile edits.
      (AC-SMI-022, AC-SMI-024)
- [x] Run the focused and full applicable manual gates, inspect the npm tarball,
      scan retained fixtures/artifacts for secrets, compare the final diff with this
      spec, and record pre-release evidence. (all)
- [x] Bump the next minor version, commit and push Titen, publish the exact packed
      artifact to npm, create the annotated tag and non-draft GitHub Release, and
      verify a clean registry install plus importer/local/served smoke.
      (AC-SMI-023)
- [x] Synchronize the verified release into `titen-web`, generate required assets,
      run checks/build and installer probes, commit and push, deploy manually,
      smoke both hostnames, close issues #297 through #299 with release evidence,
      then move this pair to `done/` and push the terminal evidence. (AC-SMI-019
      through AC-SMI-024)

## Pre-release evidence — 2026-08-13

All commands below ran on `ssh rama-tuf`. Before each final gate, the changed
and untracked file list was synchronized and compared by per-file SHA-256; the
final focused hardening edit was resynchronized and retested before packing:

- `pnpm test:api`: Worker dry-build passed; D1/workerd 124/124 and
  Bun/SQLite, vectors, and SDK 152/152 passed.
- `pnpm test:integration`: 228/228 passed after the resumable-import case was
  added. The final expanded importer matrix then passed 5/5 in
  `bun test tests/integration/source-import.test.ts`.
- `pnpm check:routes`: 84 routes; `pnpm check:workflow`: 118 artifacts,
  self-test passed, and the existing one-item Ponytail ledger stayed exact.
- `pnpm build`: dashboard static build passed at 12.6 KiB gzip against an
  80 KiB budget. `pnpm audit --prod` reported no known vulnerabilities and
  `git diff --check` passed.
- `pnpm typecheck` remains a known baseline failure: the clean `0.7.4` snapshot
  and this candidate both report exactly 106 historical errors under the
  current toolchain; the final candidate reports zero errors in changed source
  files.
- `TITEN_PACK_OUTPUT=/tmp/titen-memory-0.8.0-final-1786626054.tgz bash
  scripts/verify-pack.sh` passed all 9 clean-consumer checks. The exact preserved
  artifact is 245,004 bytes, SHA-256
  `f335dbfe2728744f355a5225bb8984c80a9c32dae92ab7ce3e4e0cb4449b79dd`,
  and SHA-1 `6a3c000dead8c2f164a46db6aa82cfe1353f7871`.
- The tarball contains 56 allowlisted package entries, identifies itself as
  `titen-memory@0.8.0`, and a high-signal credential scan of every packed byte
  found no retained secret pattern.

## Release and production evidence — 2026-08-13

- Titen release commit `43c2c4ea15e045cd6b0e3130309b1d7d0357def7`
  was pushed to `origin/main`. npm accepted the exact preserved tarball at
  `2026-08-13T13:21:13.988Z`; `latest` resolves to `0.8.0`, registry SHA-1 is
  `6a3c000dead8c2f164a46db6aa82cfe1353f7871`, and registry integrity is
  `sha512-X02XwrdmpJg2taW2sBntYZ03/kEuvSYh47o+qPiTEX/7s4iHIgnMZdTGIY25ch4zkoQEu6dbRzO/nY7f2K7IHg==`.
- Annotated tag `v0.8.0` peels to that exact commit. The published, non-draft,
  non-prerelease GitHub Release is
  `https://github.com/RamaAditya49/titen/releases/tag/v0.8.0`.
- A fresh `npm install titen-memory@0.8.0` on `rama-tuf` passed version,
  target-free preview, local apply, exact replay, served apply, and claim/evidence
  compile recall. Disposable evidence remains at
  `/tmp/titen-registry-smoke-0.8.0-final.ThGS43` on that host.
- `titen-web` commit `989aca2e1e39aeb6d1bb371bfd7252e0c9d4ed15`
  was pushed after a clean candidate checkout on `rama-tuf` passed its frozen
  install, 55-page build, 84-route and 9-MCP-tool documentation checks,
  installer probes, release-sync check, and `git diff --check`. The two existing
  prose warnings remained non-errors.
- The verified pre-deploy bundle is
  `/tmp/titen-web-predeploy-v0.8.0-989aca2.bundle`, SHA-256
  `73456ef1932ddbe43eece4a7640519b19f400cb179ea58d279b2216f701a98be`.
  Manual deployment from the clean pushed commit produced Cloudflare Worker
  Version ID `d7aae794-94f6-40b6-bcf5-dadda8f6eb48`.
- Production smoke from `rama-tuf` passed on both `https://titen.dev` and
  `https://www.titen.dev`: stable manifest `0.8.0`, release page, importer HTML
  and Markdown, CSP and nosniff headers, and exact installer bytes. Live
  `install.sh` SHA-256 is
  `e08df94c66ea4d66ba7dca2edb06724343e5e3a290a2aceabd8464f663235f05`;
  its synthetic missing-PATH probe exited 1 and `--print-path` emitted only the
  verified absolute path.
- Issues #297, #298, and #299 were closed with release and production evidence.
  A final open-issue query returned an empty list.

## Verification

All focused, dual-runtime, integration, workflow, route, build, audit, package,
registry-install, website, installer, deployment, and production-smoke evidence
listed above passed on `rama-tuf`. The only non-passing repository command is the
unchanged typecheck baseline: both clean `0.7.4` and `0.8.0` report the same 106
historical errors, with zero errors in changed source files.

## Acceptance evidence mapping

| Acceptance | Planned evidence                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-SMI-001 | table-driven profile fixtures assert exact sorted locators, chunks, hashes, counts, and repeated-preview equality                                       |
| AC-SMI-002 | spawned CLI dry-run with fetch/database spies plus before/after source and filesystem hashes                                                            |
| AC-SMI-003 | local and served apply tests assert observation kind, direct claim, source link, no synchronous importer model request, and ordinary audit/history rows |
| AC-SMI-004 | crafted Mem0/Markdown authority fields cannot alter principal, organization, subject, project, workspace, trust, or visibility                          |
| AC-SMI-005 | default/private/unverified assertions, asserted ceiling success, and verified/policy-approved rejection                                                 |
| AC-SMI-006 | exact second apply returns replayed results and unchanged observation/claim/source counts                                                               |
| AC-SMI-007 | shared Bun/D1 FTS-only compile fixture returns the imported claim and exact evidence ID under allowed scope only                                        |
| AC-SMI-008 | malformed/unknown/empty/symlink/Unicode/size fixtures fail before a target spy is touched                                                               |
| AC-SMI-009 | every retained secret rule fixture fails as one import; stdout/stderr scan contains rule/locator but no secret or content excerpt                       |
| AC-SMI-010 | invalid key, missing project, foreign workspace, over-trust, and wider-visibility cases return bounded errors and unchanged counts                      |
| AC-SMI-011 | fault after a fixed entry count, exact rerun, final count parity, and duplicate count zero                                                              |
| AC-SMI-012 | package/dependency/schema/route diffs plus Worker dry-build and existing route-doc check                                                                |
| AC-SMI-013 | documentation diff and command-help snapshot match the profile matrix, mappings, and limits in the spec                                                 |
| AC-SMI-014 | docs grep and review retain “snapshot bootstrap” and contain no unsupported drop-in/cutover claim                                                       |
| AC-SMI-015 | one profile-table snapshot covers all 16 IDs, exact allowlists/parser families/kinds, and code search finds no per-vendor client or interface              |
| AC-SMI-016 | Honcho completeness, Letta agent/block-reference/allowlist/environment-value, and MemoMind format/version failures occur before target spies; accepted claims contain only selected fields |
| AC-SMI-017 | fixtures with `@file`, glob/include, MDX, Kiro/Basic Memory references, and conditional frontmatter retain inert evidence but cause zero extra file reads or policy rows |
| AC-SMI-018 | unchanged canonical JSONL and reference-memory compatibility tests prove schema, relation, idempotency, and first-run behavior parity                         |
| AC-SMI-019 | Bun/D1 contract cases prove exact scoped unconsolidated counts, zero hidden-scope leakage, claim-only items, and API wording                                         |
| AC-SMI-020 | CLI tests run bootstrap/serve from different directories, assert one absolute user store, secure parent creation, and missing-store refusal                         |
| AC-SMI-021 | CLI fixture with a cwd `titen.db` and absent user store fails before mutation with the exact explicit `--db` recovery path                                             |
| AC-SMI-022 | isolated fake-Bun installer probes assert default non-zero plus `TITEN_BIN=...`, and `--print-path` stdout contains only the verified absolute binary                       |
| AC-SMI-023 | package tarball digest, npm metadata, clean install smoke, version parity, annotated-tag peel, and GitHub Release metadata                                                   |
| AC-SMI-024 | `titen-web` check/build/deploy transcript plus both-host manifest, release page, docs, installer byte/header, and behavior smoke                                                  |

## Test and verification plan

Run every benchmark, test, build-validation, and package smoke on the dedicated
`rama-tuf` SSH host. The current workstation is limited to editing, inspection,
commit, and release orchestration. On `rama-tuf`, run the smallest focused tests
while implementing, then the applicable manual repository gates:

```text
bun test tests/integration/source-import.test.ts
bun test tests/integration/cli.test.ts
bun test tests/contract/bun-sqlite.test.ts
pnpm test:d1
pnpm test:integration
pnpm build:worker
pnpm check:routes
node scripts/check-workflow-docs.mjs
node scripts/check-workflow-docs.mjs --self-test
bash scripts/verify-pack.sh
pnpm audit --prod
git diff --check

# in titen-web after the npm/tag/GitHub release exists
pnpm check
pnpm build
pnpm release:sync {version} --check
```

The dashboard and browser suites are not required unless implementation touches
their source or a broader regression requires them. No CI/CD workflow is added;
all verification evidence is produced on `rama-tuf` and recorded in this plan.

## Security, migration, deployment, smoke, and rollback

- Parse the full bounded source and scan it before target access. Reject
  symlinks, archives, URLs, vendor databases, unknown schemas, unsafe Unicode,
  secret hits, populated AgentFile environment/secret values, invalid
  agent-to-block references, and incomplete paginated exports; never retain real
  exports as fixtures or artifacts.
- Never dereference rule/memory links, execute MDX/skills, interpret vendor
  frontmatter as authority, or activate imported procedural context as policy.
- Keep served credentials in `TITEN_API_KEY` only. Validate a credential-free
  `TITEN_URL`; sanitize upstream bodies and memory content out of errors.
- Add no SQL migration. Existing observations, claims, FTS, audit, history, and
  optional indexing remain the only persistence paths. Existing v1-v4 canonical
  JSONL and reference-memory graph import behavior remain unchanged.
- Smoke one disposable local database and one disposable served target from
  preview through apply, exact replay, FTS-only recall, backup, restart, and
  recall. Exercise the same generated canonical result in the workerd/D1
  contract harness.
- Publish only the exact tarball verified on `rama-tuf`; preserve it from
  `scripts/verify-pack.sh` with `TITEN_PACK_OUTPUT` and publish that artifact,
  not a repack. npm rollback is a new patch plus deprecation, not unpublish.
  Create the annotated tag and GitHub
  Release only after the registry artifact is verified.
- Back up the `titen-web` release source before deployment. A bad static release
  rolls back by redeploying the previous reviewed commit; no application data is
  stored by the website.
- No live vendor call or source cutover belongs to this work. Source import
  remains a snapshot bootstrap after package and website publication.
- Code rollback removes the CLI/profile code because there is no schema change.
  Data rollback is deliberately not an automatic delete: take `titen backup` or
  a provider-native snapshot before a consequential apply and restore that
  verified snapshot if the imported batch must be reversed.

## Approval boundary

Implementation, npm publication, GitHub release creation, issue closure, and
manual `titen-web` deployment were approved by Rama on 2026-08-13. Raw
transcripts and first-party ChatGPT export parsing remain deliberately excluded.
A fixture-gated profile joins this batch only if its promotion gate was already
satisfied before implementation; otherwise it remains deferred without changing
the four-family importer design.
