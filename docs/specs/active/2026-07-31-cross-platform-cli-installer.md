---
work_id: cross-platform-cli-installer
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-07-31
updated: 2026-07-31
review_after: 2026-08-14
owner: CADIS
---
# Cross-platform CLI installer

## Problem

Titen is published as `titen-memory`, but installing it globally with Bun on a
machine without Node produces a `titen` executable whose Node shim cannot
start. The CLI also has no `--version` contract, and `titen.dev` does not serve
the advertised Unix or Windows installers. Users therefore have runnable
one-off commands but no verified persistent cross-platform installation path.

## In scope

- Make the published `titen` executable run directly on Bun and report its
  package version without creating state.
- Keep one npm package and verify its executable through Bun, npm, and pnpm;
  document that Yarn users run the Bun-owned CLI path rather than a Node-owned
  `yarn dlx` shim.
- Serve a small Bash installer for macOS/Linux/WSL and a PowerShell installer
  for native Windows from `titen.dev`.
- Install current-user CLI tooling only, bootstrap Bun from its official
  installer when missing, accept `latest` or an exact SemVer, and verify the
  installed Titen version.
- Document install, pin, update, uninstall, SDK-only installation, and the
  boundary between installing the CLI and creating Titen state.
- Publish the compatible npm patch manually, deploy the website manually, and
  retain reproducible registry and production smoke evidence.

## Out of scope

- Automatic bootstrap, API-key creation, server startup, systemd, launchd,
  Scheduled Tasks, or database deletion.
- A self-updater, compiled standalone binaries, Docker changes, Homebrew, apt,
  WinGet, Scoop, Chocolatey, or separate package-manager wrappers.
- A compiled JavaScript launcher solely for `yarn dlx`; Yarn remains supported
  for SDK dependencies while the Bun CLI uses `bunx --bun`.
- GitHub Actions or automated npm/Cloudflare deployment.

## Constraints and risks

- The original Titen checkout contains unrelated work and shall not be changed,
  reset, cleaned, stashed, or used as release source.
- `curl | bash` and `irm | iex` trust the served script and TLS. Documentation
  must also provide download-and-inspect commands.
- Installer version input is a command boundary and must reject package specs,
  URLs, whitespace, and shell metacharacters.
- npm publication is immutable in practice. The real packed artifact must pass
  before publication, and the website must not advertise an unpublished fix.
- Installation may leave a successfully installed Bun runtime when a later
  Titen package download fails; it must never create Titen data or credentials.

## Acceptance criteria

- **AC-INS-001 — Event-driven:** When a consumer installs the packed npm artifact with Bun and Node is absent from `PATH`, the generated `titen` executable shall print the exact package version and help with exit code `0` without creating a database or credential.
- **AC-INS-002 — Event-driven:** When a macOS, Linux, or WSL user runs `install.sh` with no compatible Bun on `PATH`, the installer shall install Bun for the current user, install `titen-memory` at `latest` or the requested exact SemVer, verify the exact `titen --version` result, and use no elevated privilege.
- **AC-INS-003 — Event-driven:** When a native Windows user runs `install.ps1` from Windows PowerShell 5.1 or PowerShell 7, the installer shall perform the same current-user Bun and Titen installation contract and shall not change execution policy.
- **AC-INS-004 — Unwanted behavior:** If an installer receives a version other than `latest` or an exact stable SemVer, then it shall exit non-zero before invoking a package manager or creating Titen state.
- **AC-INS-005 — Ubiquitous:** Titen shall expose one `titen` package executable that passes packed-artifact smoke through Bun global install, npm global install, pnpm global install, `bunx --bun`, `npx`, and `pnpm dlx`; documentation shall not claim that Node-owned `yarn dlx` can execute the Bun TypeScript CLI.
- **AC-INS-006 — Ubiquitous:** Installing or reinstalling the CLI shall not bootstrap an organization, print an API key, start a server, install a service, or delete a database, backup, or configuration.
- **AC-INS-007 — Event-driven:** When `titen.dev` is deployed, `/install.sh` and `/install.ps1` shall return the reviewed source bytes with `200`, a non-HTML text content type, `nosniff`, revalidation caching, and no redirect on both canonical hostnames.
- **AC-INS-008 — Event-driven:** When a reader opens the landing page, Quickstart, generated Markdown, `llms.txt`, or the install guide, Titen shall present discoverable OS and package-manager commands without hard-coding the mutable npm latest version and shall distinguish CLI installation from SDK dependency installation.
- **AC-INS-009 — Event-driven:** When the compatible patch is released, npm `latest`, the annotated Git tag, the GitHub Release, and the smoke-tested source commit shall identify the same version and artifact.
- **AC-INS-010 — Ubiquitous:** Titen shall keep GitHub Actions disabled, preserve every unrelated checkout and worktree, and use documented local manual checks, publication, deployment, and production smoke.

## Done conditions

Every acceptance criterion has reproducible evidence; both repositories are
merged and pushed; the npm artifact, annotated tag, and GitHub Release agree;
the production installer URLs and documentation pass smoke on `titen.dev` and
`www.titen.dev`; the original dirty checkout is unchanged; and this spec plus
its paired plan are moved to `done` with terminal evidence.
