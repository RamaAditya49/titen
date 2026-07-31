# Ponytail debt ledger

Generated from every Ponytail source marker on 2026-07-31. This is a trigger-based
ledger, not a backlog promise: keep each shortcut until its stated ceiling is
observed.

## Agent integration

| Location | Deliberate shortcut | Ceiling | Upgrade trigger |
| --- | --- | --- | --- |
| `docs/architecture/agent-integration.md` | All host packages omit automatic lifecycle hooks | No automatic recall or end-of-session flush | A measured workflow needs the behavior and a parity fixture covers failure paths |
| `docs/architecture/agent-integration.md` | Pi ships a skill package without an MCP client extension | Pi needs an operator-selected MCP adapter | The selected adapter is insufficient and a full process-authority review exists |
| `plugins/claude/titen-memory/.clawhubignore` | ClawHub omits Claude's remote `.mcp.json` and OpenClaw uses a separate native config fragment | OpenClaw install needs one config merge after the skill bundle | OpenClaw compatible bundles natively import Streamable HTTP MCP servers with environment-backed headers |
| `docs/architecture/agent-integration.md` | Vendor-owned public catalogs are not submitted | Repository marketplaces and ClawHub are the distribution surfaces | A maintainer schedules a specific vendor review and listing assets |

## Runtime and retrieval

| Location | Deliberate shortcut | Ceiling | Upgrade trigger |
| --- | --- | --- | --- |
| `src/runtime/bun/vectors.ts:17` | Derive a monotonic score from L2 distance | Scores cannot be compared across queries as calibrated similarity | Product behavior needs cross-query score comparison; normalize vectors and use cosine distance |
| `src/core/maintenance.ts:18` | Scan organizations once per bounded tick | One busy tenant can delay later tenants within that tick | Measured tenant delay breaches the maintenance freshness window; add per-organization cursors |
| `src/core/indexing.ts:16` | Re-embed the current claim statement without a stored version hash | Repeated claim writes can waste embedding calls | Measured repeated embeddings are material; persist and compare the indexed statement hash |
| `src/core/tokens.ts:4` | Conservative four-characters-per-token estimate | Less accurate for code and non-Latin text | A configured model tokenizer is available; retain this as the no-model fallback |
| `src/core/vectors.ts:8` | Keep only a small shared vector boundary | Provider/store dimension mismatch is detected late | More than one embedding dimension/provider is supported; add a readiness mismatch check |
| `src/core/webhooks.ts:452` | Queue one bounded event page per pass | A large tenant backlog may need several ticks | Oldest pending work exceeds the maintenance freshness window; add per-organization cursors |

## Test harness

| Location | Deliberate shortcut | Ceiling | Upgrade trigger |
| --- | --- | --- | --- |
| `tests/contract/cloudflare-d1.test.ts:75` | Retry one Miniflare D1 shim parse failure without backoff | A second consecutive shim fault fails the case | Miniflare handles its own non-JSON error payload; remove the workaround |

## Summary

- Markers: 11.
- Markers without an upgrade trigger: 0.
- Native agent work intentionally deferred: lifecycle hooks, a Pi MCP client
  extension, automatic OpenClaw bundle-to-remote-MCP import, and vendor-owned
  public catalog submissions.
