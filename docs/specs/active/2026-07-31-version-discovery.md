---
work_id: version-discovery
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-07-31
updated: 2026-07-31
review_after: 2026-08-14
owner: CADIS
---
# Version discovery

## Problem

The CLI reports only its installed package version, while agent hosts install a
separately versioned plugin or skill. Users have no single manual command that
shows the current stable CLI and plugin releases. MCP initialization also uses
the deployment revision as `serverInfo.version`, so values such as `dev`,
`test`, or a Git SHA are presented as the server implementation version.

## In scope

- Add an explicit, read-only `titen version --check` command that reads the
  stable schema-1 release manifest at `https://titen.dev/version.json`.
- Report the installed CLI version, stable CLI version, stable plugin version,
  and stable Titen release/install links without executing remote instructions.
- Report the package SemVer as MCP `serverInfo.version` while keeping the
  deployment revision in health/readiness responses.
- Document manual CLI and host-native plugin update paths.

## Out of scope

- Background polling, startup banners, telemetry, self-update, downloaded code
  execution, a tenth MCP tool, plugin hooks, or host-specific updater code.
- GitHub Actions, automated npm publication, or automated website deployment.
- Changing plugin payloads or their independently versioned manifests.
- Replacing npm dist-tags as the package installation source of truth.

## Constraints and risks

- The release manifest is untrusted network input. The CLI must require HTTPS,
  schema 1, the stable channel, and exact stable SemVer values before display.
- A missing, malformed, or unavailable manifest must fail the explicit check
  clearly and must not affect ordinary CLI commands or server startup.
- The website endpoint is deployed separately. Repository tests must inject a
  local response and cannot treat an uncommitted or undeployed web change as
  production evidence.
- The original checkout and unrelated worktrees contain other work and must not
  be modified, reset, cleaned, stashed, or committed.

## Acceptance criteria

- **AC-VER-001 — Event-driven:** When a user runs `titen version --check` and the schema-1 stable manifest is valid, Titen shall print the installed CLI version, stable CLI version, stable plugin version, CLI status, and fixed `https://titen.dev` release/install links without creating a database, credential, or background process.
- **AC-VER-002 — Unwanted behavior:** If the release endpoint is unavailable, non-successful, malformed, non-stable, or contains invalid component versions, then Titen shall exit the explicit check non-zero with a bounded error and shall not print or execute a remote-provided command or URL.
- **AC-VER-003 — Ubiquitous:** Titen shall report the exact package SemVer as MCP `serverInfo.version` on Bun and Cloudflare while continuing to report the independently configured deployment revision through health and readiness.
- **AC-VER-004 — Ubiquitous:** Titen shall document that CLI release discovery is manual, plugin updates remain owned by each host's native manager, CLI and plugin versions are independent, and GitHub Actions remain disabled.
- **AC-VER-005 — Ubiquitous:** Titen shall add no runtime dependency, automatic network request, MCP tool, updater abstraction, plugin payload change, schema migration, or deployment mutation for version discovery.

## Done conditions

The focused CLI/release-manifest and MCP tests pass, the packed artifact reports
the package version through both CLI and MCP, Worker dry-build and workflow
checks pass, documentation matches the web schema, no GitHub Action exists, the
change is merged and pushed, and this pair is moved to `done` with reproducible
evidence.
