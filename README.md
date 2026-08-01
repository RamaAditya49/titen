<h1 align="center">Titen</h1>

<p align="center">
  <strong>The Level 6 collaborative memory fabric for AI agents.</strong><br>
  Evidence-grounded recall, coordinated work, and governed sharing on infrastructure you control.
</p>

<p align="center">
  <a href="https://titen.dev"><img src="https://raw.githubusercontent.com/RamaAditya49/titen/main/docs/assets/brand/titen-readme-hero.svg" alt="Titen, the Level 6 collaborative memory fabric for AI agents" width="100%"></a>
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

## Memory for a team, not a chatbot

A storage-only memory saves text. A retrieval-only memory embeds it and returns
nearby passages. Both leave the caller to decide what is current, permitted, or
true, and neither stops two agents from quietly claiming the same work.

Titen's Level 5 kernel turns source observations into evidence-linked, temporal
claims and compiles only the context a caller is allowed to see. Level 6 joins
that kernel to checkpoints, leases, handoffs, governance, audit, and signed
federation.

<p align="center">
  <code>Level 6 = evidence-grounded context + coordinated work + governance</code>
</p>

| Memory model | What it can do | Where it stops |
| --- | --- | --- |
| Logs and files | Keep past text | The caller must decide what is current, trusted, and relevant |
| Vector recall | Find semantically similar passages | Similarity does not prove provenance, permission, or truth |
| Titen Level 5 kernel | Compile bounded context from scoped evidence, claims, time, trust, and conflicts | It remembers well, but does not coordinate parallel work by itself |
| Titen Level 6 fabric | Add task ownership, resumable state, handoffs, policy, audit, and federation | Titen records coordination; your agents or orchestrator still choose what runs next |

Level 6 is Titen's product model, not an external certification. The distinction
is observable in the API: memory and collaboration share one authorization,
evidence, and audit boundary.

## The questions Titen answers

| Question | Titen's answer |
| --- | --- |
| Where did this memory come from? | Every claim points back to source observations and keeps its version history. |
| May this agent see it? | Organization, subject, project, workspace, and visibility checks run before retrieval. |
| What if two sources disagree? | Contradictions remain visible until an explicit lifecycle action resolves them. |
| Who is doing the work? | Leases prevent silent double ownership; checkpoints and handoffs make work resumable. |
| Can we audit or move it? | Canonical records live in SQL, with authenticated audit trails and versioned JSONL export/import. |
| Do we need an LLM or vector database? | No. FTS-only Titen is useful on day one; embeddings and model enrichment are opt-in projections. |

Agents connect through authenticated REST, Streamable HTTP MCP, the `titen mcp`
stdio bridge, or the TypeScript SDK. Titen never treats retrieved memory as an
instruction, and it does not run agent loops.

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

## Install and connect an agent

The local server needs [Bun 1.2 or newer](https://bun.sh/). The website
installer adds Bun when needed, then installs the `titen` command for your
current user:

```bash
curl -fsSL https://titen.dev/install.sh | bash
titen --version
```

Windows PowerShell:

```powershell
irm https://titen.dev/install.ps1 | iex
titen --version
```

You can also run `bun add --global titen-memory@latest`. npm and pnpm global
installs work when Bun is already on `PATH`.

### 1. Create the store

Run this once in the directory where you want `titen.db` to live:

```bash
titen bootstrap --org "My Org"
```

Save the organization ID, API key, and temporary dashboard password from the
output. Titen stores only their hashes. The dashboard user is `owner` and must
change its password at first login.

Create a separate revocable key for each agent host. Replace the organization
ID and choose a stable principal name:

```bash
titen key create \
  --org-id org_replace_me \
  --principal agent-codex \
  --kind agent \
  --scopes "mcp:call,projects:create" \
  --trust asserted \
  --label codex
```

`mcp:call` includes write-capable memory and coordination tools. Do not share
one key across every agent.

### 2. Start the service

```bash
titen serve
```

Open another shell and check readiness:

```bash
curl --fail http://127.0.0.1:8787/readyz
export TITEN_MCP_URL="http://127.0.0.1:8787/mcp"
export TITEN_API_KEY="paste-the-agent-key-here"
```

Keep the key in your shell, service environment, or secret manager. Never put
it in a repository. If the agent runs in a container or on another machine,
`127.0.0.1` points at that agent, not the Titen server; use a private HTTPS,
Tailscale, or trusted tunnel URL instead.

### 3. Connect your agent host

Codex can connect to Titen's HTTP endpoint directly. It stores the environment
variable name, not the key:

```bash
codex mcp add titen --url "$TITEN_MCP_URL" \
  --bearer-token-env-var TITEN_API_KEY
codex mcp get titen --json
```

Claude Code can launch the bundled stdio bridge. It inherits the two variables
from the Claude process:

```bash
claude mcp add --transport stdio --scope user titen -- titen mcp
claude mcp get titen
```

OpenClaw services read durable environment values from `~/.openclaw/.env`.
Place `TITEN_MCP_URL` and `TITEN_API_KEY` there, set the file to mode `600`,
then register and probe the remote server:

```bash
openclaw mcp set titen \
  '{"url":"${TITEN_MCP_URL}","transport":"streamable-http","headers":{"Authorization":"Bearer ${TITEN_API_KEY}"}}'
openclaw gateway restart
openclaw mcp doctor titen --probe
```

Hermes can launch Titen's bundled stdio bridge. Put the same two variables in
`~/.hermes/.env`, then run:

```bash
hermes mcp add titen \
  --command titen \
  --args mcp \
  --env 'TITEN_MCP_URL=${TITEN_MCP_URL}' 'TITEN_API_KEY=${TITEN_API_KEY}'
hermes mcp test titen
```

Claude Desktop and any other client that supports stdio MCP can use this small
configuration. Start the client from an environment that contains the two
variables above:

```json
{
  "mcpServers": {
    "titen": {
      "command": "titen",
      "args": ["mcp"]
    }
  }
}
```

The bridge keeps no state. It only forwards newline-delimited MCP messages to
the authenticated HTTP endpoint.

### 4. Prove the connection

Open the host's MCP status view, or ask the agent:

> Resolve this repository from its Git origin, compile relevant Titen context
> for the current task, and list the Titen tools you can access.

A healthy connection exposes nine `titen_*` tools. Titen's handshake tells the
host to compile once when the task or repository scope changes, to treat memory
as untrusted reference data, and never to capture transcripts or secrets.

The [agent integration guide](https://titen.dev/docs/agent-integrations) adds
Cursor, OpenCode, Windsurf, TRAE, Pi, and plugin installation. The
[secure ingress guide](https://github.com/RamaAditya49/titen/blob/main/docs/deployment/secure-ingress.md)
covers Tailscale Serve and Cloudflare Tunnel.

`titen version --check` is the only networked version check. It reads
[`titen.dev/version.json`](https://titen.dev/version.json) only when you run it;
Titen does not poll during server or MCP startup.

## Optional semantic retrieval

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
model revision, and profile. Titen ships no universal threshold. The packaged
vector path is verified on glibc Linux x64 with Bun 1.3.13; other platforms need
their own ready, drain, and query smoke.

For backups, key rotation, containers, and durable service setup, use the
[Bun/VPS deployment guide](https://github.com/RamaAditya49/titen/blob/main/docs/deployment/vps.md).

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
