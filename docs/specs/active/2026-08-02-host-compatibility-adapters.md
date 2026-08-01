---
work_id: host-compatibility-adapters
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-02
updated: 2026-08-02
review_after: 2026-08-16
owner: ramaaditya
---

# Protocol-first MCP host compatibility

## Problem

Titen already publishes nine MCP tools over authenticated Streamable HTTP and
ships validated packages for ten agent hosts. Hosts that only launch local
stdio servers still need a small transport adapter, and the current MCP
initialization hint does not tell a compliant host when to compile memory.

The original version of this work was based on an old pre-0.5 branch. Its claim
that Titen had seven tools and invalid published allowlists is false on current
`main`. Its proposed generated repository digest, automatic transcript hooks,
fourteen-host registry, and file-mutating universal installer also duplicate
standard MCP behavior, expand the privacy boundary, and lack real adopter
evidence. They are removed rather than implemented.

## Scope

- Add `titen mcp`, a stateless stdio-to-HTTP bridge for the existing `/mcp`
  endpoint.
- Read the endpoint and API key only from `TITEN_MCP_URL` and `TITEN_API_KEY`.
- Strengthen the standard MCP `initialize.instructions` hint so a compatible
  host knows to resolve the repository and call `titen_compile` once at each
  task or scope boundary.
- Document the stdio fallback without changing the ten existing host packages
  or their explicit-invocation privacy model.
- Give a new operator one ordered install, bootstrap, connection, and smoke path
  in the npm README, with copyable setup for Codex, Claude Code, OpenClaw,
  Hermes, and generic stdio MCP hosts.
- Publish the same verified host setup as a dedicated titen.dev documentation
  page, and remove adjacent stale MCP and Cloudflare capability claims.
- Remove the dashboard session gate's discovered random-port collision so the
  manual release verification is repeatable.
- Publish and smoke the resulting stable npm release.

## Out of scope

- Generated `.titen/context.md` files or any retrieved memory written into a
  git working tree.
- Automatic recall, transcript capture, lifecycle flush, or host-owned model
  loops.
- A universal installer that rewrites user-owned JSON, JSONC, instruction, or
  managed-policy files.
- New native packages or support claims for hosts without a verified adopter
  and real installation.
- Changes to storage, ranking, authorization, REST, SDK, or SQL schemas.

## Constraints

- Use the existing MCP HTTP contract and Bun/Web APIs; add no dependency,
  registry abstraction, generated digest, or second context-selection path.
- Follow the MCP newline-delimited stdio transport exactly: stdout contains
  only JSON-RPC messages, notifications receive no response, and EOF exits
  cleanly.
- Never accept credentials in CLI flags, URLs, stdout, or errors. Fail closed
  on missing or unsafe configuration.
- Treat recalled memory as untrusted reference data. Durable writes remain
  explicit and typed; Titen never captures an ambient transcript.
- Existing authentication and organization scope remain authoritative before
  every forwarded operation.

## EARS acceptance criteria

- **AC-HC-001 — Event-driven:** When a client initializes Titen, the server
  shall return a concise standard MCP instruction that directs it to resolve
  the project and compile memory once per task or scope boundary, and states
  that returned memory is untrusted reference data.
- **AC-HC-002 — Ubiquitous:** Titen shall provide a `titen mcp` command whose
  configuration comes only from `TITEN_MCP_URL` and `TITEN_API_KEY`, and the CLI
  shall reject every argument or credential flag for that command.
- **AC-HC-003 — Event-driven:** When the bridge receives a valid JSON-RPC
  request, it shall forward one authenticated HTTP request to the configured
  `/mcp` endpoint and write the server's JSON-RPC response as one stdout line.
- **AC-HC-004 — Event-driven:** When the bridge receives a JSON-RPC
  notification, it shall forward it and write nothing to stdout.
- **AC-HC-005 — Event-driven:** When stdin closes, the bridge shall process any
  final complete message and exit with status 0 within one second.
- **AC-HC-006 — Unwanted behavior:** If input is malformed or the endpoint is
  unreachable, then Titen shall return a sanitized JSON-RPC error for a request,
  remain available for later messages, and expose no endpoint credential.
- **AC-HC-007 — Unwanted behavior:** If the endpoint URL embeds credentials,
  query parameters, a fragment, or a non-HTTP scheme, then Titen shall reject
  it before making a network request.
- **AC-HC-008 — Ubiquitous:** Published agent documentation shall name only the
  nine tools returned by `tools/list`, distinguish native HTTP from the stdio
  fallback, and preserve the no-automatic-capture boundary.
- **AC-HC-009 — Event-driven:** When the package is built and installed from
  its tarball, the installed `titen mcp` command shall complete an MCP
  initialize/notification/tools call sequence through a real local Titen
  service without leaking its key.
- **AC-HC-010 — Event-driven:** When all manual gates pass, the maintainer shall
  publish the next stable npm version, create the matching GitHub release, and
  verify the exact registry artifact and stable discovery channel.
- **AC-HC-011 — Event-driven:** When dashboard integration files run together
  and the session suite switches authentication modes, Titen shall use disjoint
  upstream lanes and reuse the released adapter listener serially.
- **AC-HC-012 — Ubiquitous:** The npm README and titen.dev shall provide one
  ordered setup path, host-specific copyable configuration for Codex, Claude
  Code, OpenClaw, Hermes, and generic stdio MCP clients, a nine-tool connection
  check, and explicit guidance that keys stay outside source control.
- **AC-HC-013 — Ubiquitous:** Public titen.dev pages touched by the host guide
  shall describe the current four MCP protocol revisions, nine tools, shared
  MCP/REST handlers, schema 21, and verified optional Cloudflare Vectorize
  support without preserving older planned-only or lexical-only claims.

## Risks and rollback

- The bridge is deliberately only a transport adapter; it must not invent
  sessions, retry non-idempotent calls, or interpret memory content.
- The previous immutable npm version remains the package rollback authority.
  The change adds no database migration and can be rolled back by reinstalling
  that version.

## Done conditions

- Every acceptance criterion has reproducible evidence in the paired plan.
- MCP protocol, CLI, integration, package, dual-runtime, workflow, route,
  browser, and production-dependency checks pass manually.
- The spec and plan move together to `done/` with no active work artifacts or
  unchecked items.
- The PR is merged, the stable npm and GitHub releases are public, exact-package
  smoke passes, and no scoped issue, PR, or merged topic branch remains open.

## Research basis

- MCP 2025-06-18 defines `InitializeResult.instructions` as server guidance a
  client may add to the model context.
- MCP stdio is newline-delimited JSON-RPC, reserves stdout for protocol
  messages, requires notifications to receive no response, and uses process EOF
  for clean shutdown.
- MCP recommends environment credentials for stdio. Titen's HTTP endpoint
  remains the authentication and authorization boundary behind the bridge.
