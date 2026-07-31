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
| `docs/agent-plugins.md` | Publish the standalone ClawHub skill while the validated bundle package is blocked | OpenClaw setup requires a separate skill install and native MCP config merge | ClawHub fixes `openclaw/clawhub#3327`; publish the bundle from commit `1cc8823` and replace the temporary install path |
| `docs/architecture/agent-integration.md` | Vendor-owned public catalogs are not submitted | Repository marketplaces and ClawHub are the distribution surfaces | A maintainer schedules a specific vendor review and listing assets |

## Runtime and retrieval

| Location | Deliberate shortcut | Ceiling | Upgrade trigger |
| --- | --- | --- | --- |
| `src/runtime/bun/vectors.ts:17` | Derive a monotonic score from L2 distance | Scores cannot be compared across queries as calibrated similarity | Product behavior needs cross-query score comparison; normalize vectors and use cosine distance |
| `src/runtime/bun/server.ts:87` | Serve one process with one synchronous database handle | Throughput stays bound to one core | Measured concurrency needs more throughput; move database work to workers or split read processes (#123) |
| `src/runtime/bun/sqlite.ts:14` | Inherit SQLite's `synchronous=FULL` default | Every commit pays an fsync | A measured durability/latency trade is accepted; set an explicit configurable mode (#124) |
| `src/core/maintenance.ts:18` | Scan organizations once per bounded tick | One busy tenant can delay later tenants within that tick | Measured tenant delay breaches the maintenance freshness window; add per-organization cursors |
| `src/core/indexing.ts:16` | Re-embed the current claim statement without a stored version hash | Repeated claim writes can waste embedding calls | Measured repeated embeddings are material; persist and compare the indexed statement hash |
| `src/core/tokens.ts:4` | Conservative four-characters-per-token estimate | Less accurate for code and non-Latin text | A configured model tokenizer is available; retain this as the no-model fallback |
| `src/core/vectors.ts:8` | Keep only a small shared vector boundary | Provider/store dimension mismatch is detected late | More than one embedding dimension/provider is supported; add a readiness mismatch check |
| `src/core/webhooks.ts:452` | Queue one bounded event page per pass | A large tenant backlog may need several ticks | Oldest pending work exceeds the maintenance freshness window; add per-organization cursors |
| `src/core/context.ts:54` | Anchor compilation to the current time | Point-in-time recall is unavailable | A caller needs historical recall; thread an optional `at` through retrieval (#118) |
| `src/core/db.ts:41` | Use one global SQL parameter chunk size | Wide lists multiply expensive statement round trips | A profile shows material multiplication; tune the hot path (#121) |
| `src/core/idempotency.ts:21` | Keep a fixed 24-hour retry window | Later re-ingest can duplicate records | Re-sync behavior is required; add content-level convergence (#101) |
| `src/core/mcp.ts:45` | Expose only the common seven-tool agent path | REST-only capabilities remain unreachable over MCP | Consolidation/search is approved for ordinary agents (#88, #89) |
| `src/core/migrations.ts:10` | Keep migrations forward-only | Failed upgrades recover from a snapshot | Deployment review needs preview; document snapshots and add `migrate --dry-run` (#116) |
| `src/core/migrations.ts:267` | Accept a retention policy kind without enforcing it | Append-only satellite tables grow indefinitely | Retention policy is implemented in maintenance (#105) |
| `src/core/observations.ts:63` | Enqueue indexing work without checking vector capability | Default no-vector deployments accumulate an undrained outbox | Skip or retire rows when vector indexing is unavailable (#105) |
| `src/core/portability.ts:26` | Export only the memory interchange surface | Export/import is not a full deployment backup | Full portability is required; add dependent tables in authority order (#111) |
| `src/core/portability.ts:41` | Limit export/import by rows independently of transport bytes | A valid export page can exceed the import cap | Cut export pages by accumulated bytes (#112) |
| `src/core/validate.ts:43` | Cap lexical candidates at 200 | Matches beyond the fixed pool are unreachable | Retrieval becomes cheap enough for a request-scaled limit (#121) |

## Test harness

| Location | Deliberate shortcut | Ceiling | Upgrade trigger |
| --- | --- | --- | --- |
| `tests/contract/cloudflare-d1.test.ts:75` | Retry one Miniflare D1 shim parse failure without backoff | A second consecutive shim fault fails the case | Miniflare handles its own non-JSON error payload; remove the workaround |

## Summary

- Markers: 24.
- Markers without an upgrade trigger: 0.
- Native agent work intentionally deferred: lifecycle hooks, a Pi MCP client
  extension, automatic OpenClaw bundle-to-remote-MCP import, and vendor-owned
  public catalog submissions.
