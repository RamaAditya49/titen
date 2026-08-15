---
work_id: npm-dashboard-bundle
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-15
updated: 2026-08-15
review_after: 2026-08-29
owner: titen-maintainers
---

# npm dashboard distribution

## Problem

The npm package currently ships the Bun runtime and SDK but omits the checked-in
Astro dashboard and its same-origin adapter. A fresh package installation can
therefore run the service but cannot obtain the current dashboard release.

## In scope

- Include the production Astro dashboard build and the adapter entrypoint in the
  npm tarball without including credentials, source mockups, or private data.
- Add a `titen dashboard` Bun CLI command with a bounded port override that
  serves the packaged dashboard through the existing adapter.
- Make `prepack` rebuild the dashboard and npm SDK so published artifacts cannot
  silently lag the checked-in dashboard.
- Update public install/dashboard documentation and the release website with
  the packaged-dashboard path.
- Publish a patch release and prove an isolated install can resolve the new
  command and packaged dashboard markers.

## Out of scope

- Automatic public exposure, reverse-proxy configuration, or credential storage.
- Changing the dashboard API, session protocol, database schema, or readiness
  semantics.
- Copying mockup source, memory content, passwords, API keys, or server data into
  the package or public documentation.

## Acceptance criteria

- **AC-NDB-001 — Ubiquitous:** A published npm tarball shall contain the current
  dashboard HTML/assets and adapter entrypoint, while excluding credentials,
  mockup source, and private runtime data.
- **AC-NDB-002 — Event-driven:** When an operator runs `titen dashboard`, the
  CLI shall load the packaged adapter and serve `/dashboard/` from that same
  release; `--port` shall be validated before startup.
- **AC-NDB-003 — Ubiquitous:** `prepack` shall rebuild both dashboard and SDK
  artifacts, and a clean install shall report the same package version as npm.
- **AC-NDB-004 — Event-driven:** When the packaged dashboard calls the adapter,
  existing same-origin authorization/session behavior shall remain unchanged.
- **AC-NDB-005 — Ubiquitous:** Documentation shall direct new installs to the
  packaged dashboard command and explain that live mode still requires explicit
  operator configuration and private ingress.

## Done conditions

- Paired plan is completed and moved to `docs/plans/done/`.
- Build, package, install-clean, browser/adapter, workflow, and npm registry
  verification pass.
- Patch release and public docs are deployed without sensitive information.
