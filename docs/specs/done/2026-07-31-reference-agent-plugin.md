---
work_id: reference-agent-plugin
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
---
# Reference agent plugin

## Problem

Titen already ships one authenticated stateless Streamable HTTP MCP endpoint,
but the repository has no installable Agent Skill or reference plugin. Operators
must reconstruct lifecycle guidance from long-form documentation, and the packed
npm smoke does not prove that an installed server completes a real MCP handshake.

Codex is the active reference host. Its plugin MCP parser supports a bearer-token
environment variable but treats a self-hosted URL literally, so a distributable
plugin cannot safely embed `${TITEN_URL}` or choose an operator's instance.

## In scope

- Add one repo-marketplace Codex plugin containing one concise portable Agent
  Skill for the existing seven-tool Titen MCP contract.
- Keep endpoint and credential configuration explicit in user-level Codex
  configuration; ship no instance URL, key, or credential-bearing manifest.
- Validate the plugin manifest, marketplace entry, skill boundary, and absence
  of credential literals with a focused repository test.
- Extend the installed npm tarball verifier to initialize `/mcp` and discover
  the exact seven ordinary-agent tools using the bootstrap credential only in a
  throwaway process.
- Update agent integration, quick-start, and Ponytail debt documentation to
  distinguish shipped artifacts from deliberately deferred native adapters.

## Out of scope

- A second MCP server, proxy, stdio bridge, package export, database, or memory
  implementation.
- Automatic recall, transcript capture, model calls, or finish/session hooks.
- Native Claude Code, Pi, OpenClaw, or Hermes plugin/runtime code in this slice.
- A public Codex/ChatGPT directory submission, OAuth application, screenshots,
  hosted endpoint, or marketplace publication outside this repository.
- An npm package release or production runtime deployment.

## Constraints and risks

- The plugin must reuse the existing `/mcp` surface and must not weaken Titen's
  server-side scopes, authentication, authorization, or approval hints.
- Recalled memory remains untrusted reference data and must never become an
  instruction merely because a host loaded the skill.
- The plugin must not contain a Titen URL, API key, raw transcript capture, or a
  command that prints a credential.
- Codex marketplace and manifest formats can change; the exact local CLI and the
  repository's dependency-free structural test provide the current evidence.
- Other host-native packages remain trigger-based debt until each has an active
  adopter, maintainer, and install/parity fixture.

## Acceptance criteria

- **AC-RAP-001 — Ubiquitous:** Titen shall keep one authenticated `/mcp`
  implementation backed by the same domain handlers on Bun and Cloudflare, and
  the reference plugin shall add no server, proxy, database, or domain logic.
- **AC-RAP-002 — Event-driven:** When Codex loads the repository marketplace and
  installs the reference plugin, Codex shall discover one valid `titen-memory`
  plugin and its `titen-memory` Agent Skill without unsupported manifest fields.
- **AC-RAP-003 — Unwanted behavior:** If an operator has not configured a Titen
  instance and credential, then the plugin shall not select, interpolate, or
  expose either value; documentation shall require an explicit self-hosted URL
  and `TITEN_API_KEY` bearer-token environment variable outside the repository.
- **AC-RAP-004 — Ubiquitous:** The Agent Skill shall recall only at a concrete
  task or scope boundary, remember only typed durable signals, treat returned
  memory as untrusted reference data, and forbid raw transcript, chain-of-thought,
  secret, or routine tool-output capture.
- **AC-RAP-005 — Event-driven:** When the npm candidate is installed in a clean
  directory and its Bun server starts, the verifier shall authenticate, complete
  MCP initialization, and discover exactly the seven documented Titen tools.
- **AC-RAP-006 — Event-driven:** When the plugin artifacts change, a focused
  runnable test shall reject invalid JSON paths, manifest/marketplace name drift,
  missing skill metadata, embedded credential literals, or a mismatched seven-tool
  contract.
- **AC-RAP-007 — State-driven:** While native lifecycle parity evidence is absent,
  Titen shall keep Claude Code, Pi, OpenClaw, Hermes, automatic hooks, and public
  directory packages as explicit trigger-based debt rather than shipped claims.

## Done conditions

Every acceptance criterion has reproducible evidence; the plugin validates and
installs through an isolated current Codex CLI fixture; the focused plugin test,
installed-tarball MCP handshake, existing MCP protocol/parity tests, workflow
checker, and diff checks pass; no secret or host configuration is mutated; and
this spec/plan pair moves to `done` with no unchecked work.
