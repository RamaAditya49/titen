# Ponytail debt ledger

Generated from every Ponytail source marker on 2026-07-30. This is a trigger-based
ledger, not a backlog promise: keep each shortcut until its stated ceiling is
observed.

## Agent integration

| Location | Deliberate shortcut | Ceiling | Upgrade trigger |
| --- | --- | --- | --- |
| `docs/architecture/agent-integration.md:118` | One portable Agent Skill and per-host MCP recipes before native lifecycle hooks | No automatic recall or end-of-session flush | A real host needs automatic lifecycle behavior and has a parity fixture |
| `docs/architecture/agent-integration.md:119` | Pi uses REST/SDK instead of a native extension | Pi cannot consume Titen through built-in MCP | Pi becomes an active adopter; then ship the smallest reviewed npm extension |
| `docs/architecture/agent-integration.md:120` | No polyglot universal plugin or separate host artifacts | Install UX remains host-specific | Each proposed artifact has a maintainer and an install smoke fixture |
| `docs/architecture/agent-integration.md:121` | No public Codex/ChatGPT directory package or listing assets | Titen is configured directly, not discoverable in that directory | A public directory submission is scheduled |

## Runtime and retrieval

| Location | Deliberate shortcut | Ceiling | Upgrade trigger |
| --- | --- | --- | --- |
| `src/runtime/bun/vectors.ts:17` | Derive a monotonic score from L2 distance | Scores cannot be compared across queries as calibrated similarity | Product behavior needs cross-query score comparison; normalize vectors and use cosine distance |
| `src/core/maintenance.ts:18` | Scan organizations once per bounded tick | One busy tenant can delay later tenants within that tick | Measured tenant delay breaches the maintenance freshness window; add per-organization cursors |
| `src/core/indexing.ts:16` | Re-embed the current claim statement without a stored version hash | Repeated claim writes can waste embedding calls | Measured repeated embeddings are material; persist and compare the indexed statement hash |
| `src/core/tokens.ts:4` | Conservative four-characters-per-token estimate | Less accurate for code and non-Latin text | A configured model tokenizer is available; retain this as the no-model fallback |
| `src/core/vectors.ts:8` | Keep only a small shared vector boundary | Provider/store dimension mismatch is detected late | More than one embedding dimension/provider is supported; add a readiness mismatch check |
| `src/core/webhooks.ts:436` | Queue one bounded event page per pass | A large tenant backlog may need several ticks | Oldest pending work exceeds the maintenance freshness window; add per-organization cursors |

## Test harness

| Location | Deliberate shortcut | Ceiling | Upgrade trigger |
| --- | --- | --- | --- |
| `tests/contract/cloudflare-d1.test.ts:75` | Retry one Miniflare D1 shim parse failure without backoff | A second consecutive shim fault fails the case | Miniflare handles its own non-JSON error payload; remove the workaround |

## Summary

- Markers: 11.
- Markers without an upgrade trigger: 0.
- Native agent artifacts intentionally deferred: portable skill automation,
  Pi extension, per-host packages, and public directory packaging.
