# ADR 0007: `mcp:call` is a tool-bundle scope

- Status: Accepted
- Date: 2026-11-03

## Context

A security evaluation of `titen-memory@0.2.1` on 2026-07-31 found a gap between REST and MCP.
A key with only `mcp:call` can call `titen_remember`, `titen_compile`, `titen_checkpoint_save`,
`titen_lease_acquire`, and `titen_handoff`. REST refuses the same key on the matching routes,
because REST requires `observations:write`, `context:compile`, and the other route scopes.

`README.md` says that `mcp:call` includes write-capable memory and coordination tools.
No decision record explained this, so the evaluation reported it as a scope bypass.

Per-tool scopes would make every issued MCP key fail on its next tool call.
That is a breaking change, and it needs a minor release and a key migration.

## Decision

`mcp:call` authorizes every tool that `tools/list` returns.
It is a bundle scope, not a gate in front of the REST scopes.

Each tool handler still applies its own checks. These checks are the same as on REST:

- the trust ceiling of the key;
- key fences, data grants, and record visibility;
- `observations:purge` for the purge tools;
- `claims:write` for `titen_remember` with `consolidate`;
- `context:compile:all` for `titen_compile` with `cross_project`.

To give an agent less authority, issue a key without `mcp:call` and use REST with explicit scopes.
Fences and a lower trust ceiling also limit what an MCP key can reach.

## Consequences

- Existing MCP keys keep working without a migration.
- Treat a key with `mcp:call` as a write credential for memory, checkpoints, leases, and handoffs.
- The API reference and the README state this bundle.
- Read-only MCP keys need per-tool scopes. Revisit this decision in a minor release if hosts ask for them.
