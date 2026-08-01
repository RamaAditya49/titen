<h1 align="center">Titen</h1>

<p align="center">
  Collaborative memory for AI agents, with evidence you can trace back to its source.
</p>

<p align="center">
  <a href="https://titen.dev"><img src="https://raw.githubusercontent.com/RamaAditya49/titen/main/docs/assets/brand/titen-readme-hero.svg" alt="Titen collaborative memory for AI agents" width="100%"></a>
</p>

<p align="center">
  <a href="https://titen.dev"><strong>Website</strong></a> ·
  <a href="https://github.com/RamaAditya49/titen/blob/main/docs/README.md">Documentation</a> ·
  <a href="https://www.npmjs.com/package/titen-memory">npm</a> ·
  <a href="https://github.com/RamaAditya49/titen/blob/main/CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/titen-memory"><img alt="npm version" src="https://img.shields.io/npm/v/titen-memory?style=flat&amp;labelColor=3E3630&amp;color=A9552A"></a>
  <a href="https://www.npmjs.com/package/titen-memory"><img alt="npm downloads" src="https://img.shields.io/npm/dm/titen-memory?style=flat&amp;labelColor=3E3630&amp;color=223A57"></a>
  <a href="https://github.com/RamaAditya49/titen/blob/main/LICENSE"><img alt="Apache-2.0 license" src="https://img.shields.io/badge/license-Apache--2.0-171310?style=flat&amp;labelColor=3E3630"></a>
</p>

<p align="center">
  Built with <a href="https://cadis.digital/">C.A.D.I.S Agent</a>.
</p>

Titen is a self-hosted memory service for teams of AI agents. It keeps source
observations separate from derived claims, compiles context within the caller's
scope, and gives parallel agents explicit checkpoints, leases, and handoffs.

Canonical records live in SQL. Full-text and optional vector indexes are
rebuildable. Retrieved memory is untrusted reference data, not an instruction.

## What it provides

- Append-only observations with provenance and timestamps.
- Evidence-linked claims that preserve contradictions and supersession history.
- Token-bounded context compilation after tenant, subject, and visibility checks.
- Authenticated REST, Streamable HTTP MCP, and a TypeScript SDK.
- Collaboration state for checkpoints, leases, handoffs, feedback, and events.
- Enterprise roles, approvals, releases, retention, legal holds, and identity mappings.
- Opt-in signed federation for recallable canonical claims and their evidence.
- Versioned JSONL export and import. Titen does not run agent loops.

## Project status

Titen is pre-1.0. The core service is usable, but public contracts may still
change between minor releases. The current release includes the memory kernel,
REST API, MCP server, TypeScript SDK, collaboration tools, enterprise
governance, signed federation, and the operator dashboard.

You can run Titen on Bun with SQLite or on Cloudflare Workers with D1. Semantic
retrieval is optional: use `sqlite-vec` on Bun, or Vectorize and Workers AI on
Cloudflare. Titen runs in your own infrastructure.

See the [maturity matrix](https://github.com/RamaAditya49/titen/blob/main/docs/ROADMAP.md#maturity-matrix)
for detailed runtime evidence and remaining gates, or the
[changelog](https://github.com/RamaAditya49/titen/blob/main/CHANGELOG.md) for
release history.

## Install and run

The server requires [Bun 1.2 or newer](https://bun.sh/). Bootstrap the first
organization from the npm package:

```bash
bun add --global titen-memory@latest
titen --version
titen version --check
titen bootstrap --org "My Org"
```

`titen version --check` is the only networked version check. It reads the
stable CLI and plugin release manifest from
[`titen.dev`](https://titen.dev/version.json); Titen does not poll in the
background or during server/MCP startup. Re-run the installer documented at
[`titen.dev`](https://titen.dev/docs/install) when a CLI update is available.

`npm install --global titen-memory@latest` and
`pnpm add --global titen-memory@latest` expose the same command when Bun is on
`PATH`. For a one-off run use `bunx --bun titen-memory@latest`; Yarn remains a
supported SDK dependency manager, but its Node-owned `dlx` runner does not run
the Bun TypeScript CLI.

Save the printed API key and dashboard temporary password when they appear.
Titen stores only their hashes and cannot show either again. The default
dashboard username is `owner`; first login requires a new password. Start the
service from the same directory:

```bash
titen serve
```

The default listener is `http://127.0.0.1:8787`. Check it from another shell:

```bash
curl http://127.0.0.1:8787/readyz
```

The default install is FTS-only. A Bun vector deployment must explicitly add
`sqlite-vec@0.1.9`; configured semantic retrieval fails readiness if the native
extension or stored index fingerprint is incompatible.

```bash
bun add titen-memory sqlite-vec@0.1.9

TITEN_EMBED_BASE_URL=http://127.0.0.1:11434/v1 \
TITEN_EMBED_MODEL=embeddinggemma \
TITEN_EMBED_DIMS=768 \
TITEN_EMBED_REVISION=local-pinned \
TITEN_EMBED_PROFILE=embeddinggemma-retrieval-v1 \
TITEN_EMBED_MIN_COSINE="$CALIBRATED_COSINE_FLOOR" \
bunx titen-memory serve
```

Set `CALIBRATED_COSINE_FLOOR` from a locked evaluation of that exact provider,
model revision, and profile. Titen ships no universal threshold: missing or
incompatible policy values fail readiness instead of returning a best bad
neighbor. Use `raw-unit-v1` only for models whose retrieval contract is raw
text; EmbeddingGemma requires the role-aware profile shown above.

The packaged vector path is verified on glibc Linux x64 with Bun 1.3.13.
Other `sqlite-vec` prebuilt platforms need the same local ready/drain/query
smoke before production use.

For a durable host setup, backups, key rotation, and optional vector retrieval,
use the [Bun/VPS deployment guide](https://github.com/RamaAditya49/titen/blob/main/docs/deployment/vps.md).

## Use the SDK

The SDK uses `fetch` and runs on Node 22+, Bun, Deno, and edge runtimes.

```bash
npm install titen-memory
```

```ts
import { TitenClient } from "titen-memory";

const titen = new TitenClient({
  url: process.env.TITEN_URL ?? "http://127.0.0.1:8787",
  key: process.env.TITEN_API_KEY!,
});

const subject = "release-runbook";
const observation = await titen.observe({
  subject_id: subject,
  kind: "imported_source",
  content: "The release runbook requires a rollback smoke test after deployment.",
  source: { type: "runbook", ref: "ops/release.md" },
  trust: "verified",
});

await titen.consolidate(subject, [
  {
    kind: "procedural",
    statement: "Run a rollback smoke test after deployment.",
    sources: [
      { observation_id: observation.observation_id, relation: "supports" },
    ],
  },
]);

const context = await titen.compile({
  subject_id: subject,
  task: "rollback smoke after deployment",
  max_tokens: 900,
});

console.log(context.items);
```

`max_tokens` accepts 128 through 32,000. Every returned memory item includes
`untrusted: true`; the client still owns prompt boundaries and action policy.

Typed methods cover common agent operations. `request()` and `requestRaw()`
cover the remaining authenticated JSON and streaming routes. Mutations accept
an `idempotencyKey` for safe retries.

See the [agent guide](https://github.com/RamaAditya49/titen/blob/main/docs/agent-guide.md)
and [API reference](https://github.com/RamaAditya49/titen/blob/main/docs/reference/api.md)
for request contracts and scope rules.

## Connect an agent

Titen exposes one authenticated Streamable HTTP MCP endpoint at `/mcp`. Set the
full endpoint URL and a distinct revocable key for each agent outside the
repository. For Codex:

```bash
export TITEN_MCP_URL="http://127.0.0.1:8787/mcp"
codex mcp add titen --url "$TITEN_MCP_URL" \
  --bearer-token-env-var TITEN_API_KEY
```

Titen also ships host-specific packages and a portable Agent Skill. The
[integration matrix](https://github.com/RamaAditya49/titen/blob/main/docs/agent-plugins.md)
covers Codex, Claude Code, OpenClaw, Cursor, Hermes, Pi, OpenCode, Windsurf,
TRAE, and ZCode without introducing another memory server.

## Architecture

One Web-Standards TypeScript core serves both runtimes:

| Capability | Bun / VPS | Cloudflare |
| --- | --- | --- |
| HTTP | `Bun.serve` | Worker `fetch` |
| Canonical SQL | `bun:sqlite` | D1 |
| Lexical retrieval | SQLite FTS5 | D1 FTS5 |
| Optional vectors | `sqlite-vec` | Vectorize (verified live in `titen-test-*`) |
| Automatic model enrichment | Implemented, opt-in compatible HTTP | Implemented, opt-in compatible HTTP |
| Background work | Startup and bounded timer | Scheduled handler; trigger provisioning varies |

Automatic model-assisted claim derivation and reflection are implemented as an
opt-in capability with durable jobs, bounded validation, and separate
readiness. They are not production-activated until the locked evaluation and
real-runtime smokes are recorded; callers may continue submitting evidence-
linked claims explicitly.

The base service does not require Docker, Redis, Postgres, a graph database, or
a vector database. Authorization runs before retrieval, and every candidate is
hydrated from canonical SQL before Titen returns it.

Read the [architecture overview](https://github.com/RamaAditya49/titen/blob/main/docs/architecture/overview.md)
for component and failure boundaries. Cloudflare operators should start with
the [Cloudflare deployment guide](https://github.com/RamaAditya49/titen/blob/main/docs/deployment/cloudflare.md).

## Dashboard

The checked-in Astro client at `/dashboard/` is a live operator surface for
Memories, Context, Work, Audit, Governance, and Federation. Each person signs
in with a username/password; the loopback adapter keeps the resulting
short-lived key behind an opaque HttpOnly session and never writes either secret
to browser storage. Bootstrap creates `owner` with a random temporary password,
and Add User follows the same forced-first-change flow. API keys remain for
agents, services, SDKs, and recovery. There is no fixture fallback when the
service is disconnected or denies a request.

The [dashboard guide](https://github.com/RamaAditya49/titen/blob/main/docs/dashboard.md)
covers configuration and verification. Use the
[secure ingress guide](https://github.com/RamaAditya49/titen/blob/main/docs/deployment/secure-ingress.md)
for private Tailscale Serve access or Cloudflare Tunnel protected by Access.

## Documentation

| Read this | For |
| --- | --- |
| [Golden path](https://github.com/RamaAditya49/titen/blob/main/docs/guides/golden-path.md) | A complete small-team example |
| [API reference](https://github.com/RamaAditya49/titen/blob/main/docs/reference/api.md) | REST, MCP, errors, and compatibility |
| [Architecture](https://github.com/RamaAditya49/titen/blob/main/docs/architecture/overview.md) | Core, runtime, storage, and policy boundaries |
| [Agent integrations](https://github.com/RamaAditya49/titen/blob/main/docs/agent-plugins.md) | Host-specific MCP and skill setup |
| [VPS deployment](https://github.com/RamaAditya49/titen/blob/main/docs/deployment/vps.md) | Bun, containers, persistence, and hardening |
| [Cloudflare deployment](https://github.com/RamaAditya49/titen/blob/main/docs/deployment/cloudflare.md) | Worker and D1 setup |
| [Secure dashboard ingress](https://github.com/RamaAditya49/titen/blob/main/docs/deployment/secure-ingress.md) | Tailscale Serve or Cloudflare Tunnel with Access |
| [Roadmap](https://github.com/RamaAditya49/titen/blob/main/docs/ROADMAP.md) | Evidence-based maturity and planned work |
| [Documentation index](https://github.com/RamaAditya49/titen/blob/main/docs/README.md) | Product, engineering, security, and research docs |

## Development

The repository requires Node 22+, Bun 1.2+, and pnpm.

```bash
git clone https://github.com/RamaAditya49/titen.git
cd titen
pnpm install
pnpm test
pnpm check:workflow
```

Changes follow `spec -> plan -> implement -> done`. Read
[CONTRIBUTING.md](https://github.com/RamaAditya49/titen/blob/main/CONTRIBUTING.md)
before changing public behavior, storage, authorization, or runtime contracts.

## Security

Keep Titen bound to `127.0.0.1`. Remote agents should use a private network or
a trusted TLS reverse proxy. When that proxy exposes `/mcp`, set
`TITEN_MCP_ORIGIN` to its exact public origin. Use `TITEN_SECRET_KEYS` as the
external encryption keyring for persisted webhook and federation signing
secrets, and set `TITEN_WEBHOOK_ALLOWED_HOSTNAMES` before enabling outbound
webhooks. The [VPS security guide](https://github.com/RamaAditya49/titen/blob/main/docs/deployment/vps.md#configuration)
defines the formats and rotation procedure.

Do not report vulnerabilities in a public issue. Use
[GitHub Private Vulnerability Reporting](https://github.com/RamaAditya49/titen/security/advisories/new)
and follow [SECURITY.md](https://github.com/RamaAditya49/titen/blob/main/SECURITY.md).
Never include real credentials or private memory content in a report.

## License

Titen is licensed under the
[Apache License 2.0](https://github.com/RamaAditya49/titen/blob/main/LICENSE).
