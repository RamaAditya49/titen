---
work_id: cross-host-agent-distribution
status: done
stage: done
outcome: cancelled
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
---
# Cross-host agent distribution

## Problem

Titen's existing Codex plugin proves the portable Agent Skill and original seven-tool
MCP contract, but users of Claude Code, ZCode, Cursor, OpenClaw, Hermes, Pi,
OpenCode, Windsurf, and TRAE still have to reconstruct host-specific packaging
or configuration. ClawHub authentication is available to the maintainer, but no
Titen bundle has been published there.

The hosts do not share one plugin ABI. Some accept marketplace bundles, Hermes
loads Python plugins, Pi installs packages, and several editors expose MCP and
Agent Skills without a third-party runtime plugin format. Calling all of these
artifacts the same thing would create false compatibility claims.

## In scope

- Keep the existing authenticated Titen `/mcp` endpoint as the only memory tool
  implementation and expose nine ordinary-agent tools, adding only project
  resolution and explicit consolidation through existing domain handlers.
- Add a Claude marketplace bundle that is also installable by ZCode and
  OpenClaw and publish that bundle to ClawHub. Exclude the Claude-only remote
  MCP declaration from the ClawHub artifact and ship OpenClaw's native remote
  MCP config because OpenClaw stable only imports stdio servers from bundles.
- Add a native Cursor marketplace plugin, a native Hermes skill plugin, and a
  Pi package containing the portable Titen skill.
- Add copyable native MCP/skill kits for OpenCode, Windsurf, and TRAE, whose
  supported integration surfaces do not require another in-process plugin.
- Keep all endpoint and bearer values in environment or host secret storage,
  using each host's documented interpolation syntax.
- Update README, agent-integration documentation, and Ponytail debt to describe
  exactly what is shipped, how it installs, and which runtime hooks remain
  deliberately absent.
- Add dependency-free structural tests plus installed host validators where the
  relevant CLI is available locally.

## Out of scope

- A second MCP server, stdio proxy, REST-to-MCP bridge, database, model client,
  or host-specific copy of Titen domain policy.
- Automatic transcript capture, automatic recall/flush hooks, autonomous agent
  loops, or a native in-process OpenClaw memory provider.
- Reimplementing an MCP client inside Pi; Pi's package supplies the skill and
  relies on an operator-selected MCP adapter until Pi ships a native client.
- Submitting to Cursor's reviewed public catalog or a vendor-owned Windsurf,
  TRAE, ZCode, or Hermes catalog that requires a separate vendor review.
- An npm `titen-memory` release, service deployment, schema change, or GitHub
  Actions workflow.

## Constraints and risks

- Repository and verified runtime behavior remain authoritative over host docs;
  host formats are current as of 2026-07-31 and can change independently.
- No artifact may contain a real URL, API key, token, or command that prints a
  credential. The ClawHub CLI may read its existing mode-0600 auth config but
  the token must not enter source, logs, issue comments, or release evidence.
- Claude/OpenClaw use `${ENV_VAR}`, Cursor and Windsurf use
  `${env:ENV_VAR}`, and OpenCode uses `{env:ENV_VAR}`. TRAE documents UI/import
  secret scanning rather than a portable interpolation syntax, so its recipe
  must not invent one. Tests must reject syntax drift because a valid-looking
  wrong placeholder can leak a literal token string to the server.
- OpenClaw stable accepts Streamable HTTP through native `mcp.servers` config
  but imports only stdio MCP declarations from compatible bundles. The
  ClawHub artifact must therefore omit `.mcp.json`, retain the portable skill,
  and pair it with an environment-backed OpenClaw config fragment.
- ClawHub publication is an external immutable version. Validation and dry-run
  must pass from the exact merged source before the live publish.
- Host packages must preserve Titen's scope-before-retrieval, untrusted-memory,
  typed-write, and explicit coordination boundaries.

## Acceptance criteria

- **AC-CHD-001 — Ubiquitous:** Titen shall keep one authenticated `/mcp`
  implementation and nine ordinary-agent tools; no distribution artifact shall
  add a server, proxy, database, model client, or memory policy implementation.
- **AC-CHD-002 — Event-driven:** When Claude Code or ZCode loads the Titen
  Claude marketplace bundle, the host shall discover one `titen-memory` skill
  and one remote HTTP `titen` MCP connection using environment-backed URL and
  bearer-header placeholders. When OpenClaw installs the ClawHub artifact and
  applies the native config fragment, it shall load the same skill plus one
  native Streamable HTTP `titen` connection without executable plugin code or
  an unsupported bundle-MCP diagnostic.
- **AC-CHD-003 — Event-driven:** When Cursor loads the Titen Cursor marketplace,
  Cursor shall discover a valid `titen-memory` plugin with one portable skill
  and one remote HTTP MCP connection using Cursor's environment interpolation.
- **AC-CHD-004 — Event-driven:** When Hermes loads the Titen plugin, Hermes
  shall register the bundled skill under its plugin namespace without adding
  tools, hooks, transcript capture, or a memory-provider implementation.
- **AC-CHD-005 — Event-driven:** When Pi loads the Titen package, Pi shall
  discover the portable `titen-memory` skill without executing extension code;
  documentation shall state that MCP tools require an operator-selected adapter.
- **AC-CHD-006 — Event-driven:** When an OpenCode, Windsurf, or TRAE operator
  follows its shipped kit, the host shall receive the same portable skill where
  supported and a remote MCP configuration using documented environment
  interpolation or the host's secret-aware UI rather than a credential literal.
- **AC-CHD-007 — Unwanted behavior:** If a distribution artifact contains a
  credential literal, unsupported path, mismatched plugin name, wrong host
  interpolation syntax, divergent skill copy, or tool-contract drift, then the
  focused distribution test shall fail.
- **AC-CHD-008 — Event-driven:** When the exact merged, OpenClaw-safe
  Claude-format bundle passes ClawHub validation and dry-run, the maintainer
  shall publish one immutable
  bundle-plugin release under the authenticated `RamaAditya49` owner and record
  its public URL, version, source commit, and scan state without exposing auth.
- **AC-CHD-009 — State-driven:** While lifecycle parity fixtures are absent,
  every shipped artifact shall remain instruction/configuration-only and shall
  not add automatic recall, flush, transcript, or coordination hooks.

## Done conditions

All acceptance criteria have reproducible evidence; current Claude and Hermes
CLIs validate/load their native packages in isolated state; structural tests
cover every shipped host; ClawHub validates, dry-runs, publishes, and exposes the
exact merged bundle; existing MCP, package, workflow, route, and diff gates pass;
README and architecture claims match the artifacts; no secret or user host
configuration is committed or mutated; and the paired spec/plan moves to `done`
with no unchecked work.
