---
work_id: cross-platform-cli-installer
status: done
stage: done
outcome: superseded
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-cross-platform-cli-installer.md
---
# Plan

- [ ] Replace the Node launcher with the existing Bun CLI entrypoint, add a read-only exact `--version` response, and remove only the obsolete shim.
- [ ] Extend the CLI and packed-artifact checks for version/help side effects, Bun global execution without Node, npm/pnpm global prefixes, and supported one-off runners.
- [ ] Update package, release, README, and deployment documentation without changing runtime semantics or adding dependencies.
- [ ] Rebase onto current `origin/main`, run focused CLI/package checks and the full required local gate, review the packed tarball, and merge the Titen change.
- [ ] Publish the exact compatible patch manually; create and verify the annotated tag and changelog-derived GitHub Release; smoke a clean registry install before changing the website.
- [ ] Add minimal Bash and PowerShell current-user installers to `titen-web`, including strict version validation, official Bun bootstrap, current-session PATH refresh, exact version verification, and no Titen state creation.
- [ ] Add the install guide to the existing docs/nav/search/Markdown/llms surfaces, update landing and Quickstart commands, set static headers, and extend the existing docs gate with installer contract self-checks.
- [ ] Run website checks/build plus Bash syntax/self-checks and PowerShell parser/self-checks where available; verify invalid versions and dry side-effect boundaries.
- [ ] Back up the website release source, merge/push, deploy the static Worker, and smoke both hostnames for installer bytes, headers, docs, package commands, and a clean production install.
- [ ] Record exact evidence below, move this pair to `done`, re-run workflow/diff checks, verify both origins and the preserved checkout, and remove only installer-owned temporary worktrees/branches.

## Acceptance evidence mapping

- AC-INS-001: CLI tests plus packed Bun-global execution with a PATH containing Bun and `titen` but no Node.
- AC-INS-002: Bash syntax/self-checks and isolated clean-prefix install against the published artifact.
- AC-INS-003: PowerShell parser/self-checks and native Windows evidence when a reachable Windows host is available; otherwise the endpoint shall not be claimed complete.
- AC-INS-004: table-driven invalid-version self-checks for both installers with package-manager invocation guards.
- AC-INS-005: `scripts/verify-pack.sh`, exact registry one-off/global runner transcript, and an explicit Yarn CLI boundary in the install guide.
- AC-INS-006: clean install directory inventory and absence of Titen database/key/server side effects.
- AC-INS-007: source/deployed SHA-256, GET/HEAD status, redirect count, content type, cache, ETag, and `nosniff` on both hostnames.
- AC-INS-008: docs gate, static build, generated Markdown/llms checks, and rendered production command markers.
- AC-INS-009: package version, npm metadata/digest, annotated-tag peel, GitHub Release URL, and exact source commit.
- AC-INS-010: Actions audit, original-checkout before/after status and hashes, manual command transcript, and installer-worktree-only cleanup.

## Security, release, deployment, smoke, and rollback

The CLI change is compatible and contains no migration. Before npm publication,
rollback is a reviewed revert. After publication, rollback is deprecation plus a
new patch; unpublish is not the plan. Before website deployment, create and
verify a git bundle. A bad static deployment rolls back by deploying the
previous reviewed commit. Installer inputs are treated as untrusted, secrets
are never accepted or printed, and no cleanup command may target user data.

## Evidence

The branch's CLI changes already exist on `main`: the package executable points
to the Bun CLI, `titen --version` is side-effect free, and the packed-artifact
gate exercises a Bun-only `PATH`. `titen.dev` returns `200`, while the proposed
`/install.sh` and `/install.ps1` endpoints are absent. Standard Bun, npm, and
pnpm installation already covers the release without two additional remote
scripts or a second repository deployment.

## Closure reason

Superseded by the package-manager path already shipped and documented. The
custom website installers, Windows-host proof, and website deployment were not
implemented or claimed. They require a separate request if package-manager
installation proves insufficient.
