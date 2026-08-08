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

## You author the claims

**Titen's default memory model is caller-authored claims.** `consolidate()`
takes statements you wrote, each explicitly linked to a source observation you
already recorded. Titen does not read a transcript and decide on its own what is
worth remembering.

That is deliberate. Every claim has an author, a source, and a scope, which is
what makes provenance, permission, conflict, and audit answerable at all. It is
also a real cost, and it is the honest comparison point: systems that derive
memory from raw dialogue do work Titen hands back to you.

Model-assisted derivation and reflection are implemented and ship in the
package, but they are activation-gated and **no candidate model has passed the
gate** — the best result on record is 65.56% against a 90% contract threshold.
Treat them as unfinished work with a public gate, not as a feature you can
simply switch on. The [roadmap](https://github.com/RamaAditya49/titen/blob/main/docs/ROADMAP.md#maturity-matrix)
carries the current evidence.

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

## Measured against the field

On [LongMemEval-S](https://github.com/xiaowu0162/LongMemEval) (MIT, externally
authored, 500 instances), our own scorer, failures kept in the denominator,
protocol pre-registered before each run. Full table and method at
[titen.dev/benchmark](https://titen.dev/benchmark).

| Lane, n=500 | recall@1 | LLM calls | embedding calls |
| --- | ---: | ---: | ---: |
| Titen 0.6.0, FTS + vector | **0.900** | 0 | 4,989 |
| Titen 0.6.0, FTS-only | 0.880 | **0** | **0** |
| verbatim-RAG control (~100 lines of cosine) | 0.854 | 0 | 877 |
| MemPalace 3.6.0 | 0.804 | 0 | — |

The FTS+vector lane beats the dense control on a paired sign test — 35 wins, 12
losses, 453 ties, **p = 0.0011**. Three things we will not let that number imply:

- **FTS-only is at parity**, not ahead (44/31/425, p = 0.165), and the vector arm
  is not proven to be the cause of the win (27/17/456, p = 0.174).
- **Answer accuracy is a flat null.** With one reader pinned across every lane,
  eight pre-registered comparisons produce nothing significant (best p = 0.41).
  Retrieval significance does not transfer to answers.
- **We do not beat Mem0's LLM-free mode.** Mem0 `infer=False` scores 0.8667
  against our 0.8833 on the shared subsample — 3/4/53, **p = 1.0**. Its default
  `infer=True` mode spends 2,981 LLM calls to score *lower* (0.8333), so Mem0's
  own extraction bought nothing measurable here. Any cost claim must name the
  configuration it measured.

What survives every configuration argument is the dependency floor: **Titen's
FTS-only lane made zero LLM calls and zero embedding calls.** Mem0 without an LLM
still needs an embedding provider. `dependencies: {}`, zero external imports in
`src/core/`, and exactly two outbound calls in the whole codebase, both opt-in.

Where Titen loses is published too: FTS-only recall@1 falls from 1.00 to 0.49
between 10³ and 10⁵ claims on a synthetic corpus, one process saturates one core
at 10k claims, there is no reranking stage, and no external suite scores the
governance and collaboration primitives at all.

## Audit any agent memory store

Every published memory benchmark measures retrieval on a corpus somebody
curated. The failure people actually report is on the write side: a store fills
with copies of its own output. The one public audit of a production store found
97.8% of 10,134 entries were junk after 32 days. Nothing measures that.

```sh
npx titen-memory audit ~/.titen/memory.db        # a Titen store
npx titen-memory audit ./memory.jsonl            # @modelcontextprotocol/server-memory
npx titen-memory audit ./mem0-export.json --json # a Mem0 export
```

Five counts — exact duplicate, near duplicate, recall loop, secret pattern,
stale — each with per-item evidence you can check by hand. **No network, no
model, no upload:** it opens the path read-only and prints a report; sharing it
is your decision. A store that lacks the signal a metric needs is reported as
*not measurable from this export*, never as a failure. There is no composite
score and there is no leaderboard.

The detection rules are published in
[audit rules](https://github.com/RamaAditya49/titen/blob/main/docs/reference/audit.md).
Titen's own numbers — including 17.9% duplicates and 96.7% stale in its own
store, and a compatibility-surface defect the tool found in Titen itself — are in
[the self-report](https://github.com/RamaAditya49/titen/blob/main/docs/testing/2026-08-07-titen-audit-self-report.md).

## Project status

**Titen is pre-1.0.** Per [SemVer clause 4](https://semver.org/spec/v2.0.0.html#spec-item-4),
the public API is not yet stable. Below `1.0.0` the **minor** slot is the only
breaking-change signal consumers get: `0.5.7` to `0.6.0` may break you, and
`^0.5.0` does not match `0.6.0`. Pin an exact version and read the
[changelog](https://github.com/RamaAditya49/titen/blob/main/CHANGELOG.md) before
upgrading.

Where the word *stable* appears around Titen — the npm `latest` dist-tag,
`"channel": "stable"` in [`titen.dev/version.json`](https://titen.dev/version.json),
and `titen version --check` — it names the **release channel**: a deliberate
release rather than a prerelease on `next`. It never describes API stability,
and it is not a maturity badge. See
[versioning and channels](https://github.com/RamaAditya49/titen/blob/main/docs/engineering/release.md#versioning-and-channels).

The current release includes the memory kernel, REST API, MCP server,
TypeScript SDK, collaboration tools, enterprise governance, signed federation,
and the operator dashboard.

You can run Titen on Bun with SQLite or on Cloudflare Workers with D1. Semantic
retrieval is optional: use `sqlite-vec` on Bun, or Vectorize and Workers AI on
Cloudflare — verified live only on the maintainer's isolated `titen-test-*`
stack, which is test production and not general availability
([scope note](#architecture)). Titen runs in your own infrastructure.

**Clients.** Titen ships a TypeScript/JavaScript SDK, the `titen` CLI, and a
minimal Python client in
[`clients/python/`](https://github.com/RamaAditya49/titen/tree/main/clients/python).
The Python client is one standard-library-only file covering
`observe → consolidate → compile → evidence`, with a generic `request` for every
other route. **It is not published to PyPI**: install it from a checkout with
`pip install ./clients/python`, or vendor `titen.py`. There is no client for any
other language — those callers use the authenticated REST API directly, and
every route, scope, and error shape is in the
[API reference](https://github.com/RamaAditya49/titen/blob/main/docs/reference/api.md).

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

Titen is listed in the official MCP registry as
`io.github.RamaAditya49/titen-memory`, so a client that reads that directory can
offer it; configuring it by hand as above works everywhere else. The manifest and
the manual publishing procedure are in
[MCP registry listing](https://github.com/RamaAditya49/titen/blob/main/docs/deployment/mcp-registry.md).

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

The default install is FTS-only and stays ready with no embedding configuration
at all. Semantic retrieval is **all-or-nothing**: set one `TITEN_EMBED_*`
variable and you have opted in, so every variable below must then be valid or
the service fails closed — `/readyz` returns `503` with
`checks.semantic_index: "embedding_configuration_invalid"` and no vector query
runs. A Bun vector deployment must also add `sqlite-vec@0.1.9`.

| Variable | Required | Shipped default | Absent or invalid |
| --- | --- | --- | --- |
| `TITEN_EMBED_BASE_URL` | yes | none | `configured_error`; must be `http:`/`https:` with no credentials, query, or fragment |
| `TITEN_EMBED_MODEL` | yes | none on Bun; `@cf/baai/bge-base-en-v1.5` on Workers | `configured_error` |
| `TITEN_EMBED_DIMS` | yes | none on Bun; `768` on Workers | `configured_error`; integer 1–65,536, must equal the index dimension |
| `TITEN_EMBED_REVISION` | yes | **none** | `configured_error` |
| `TITEN_EMBED_PROFILE` | yes | **none** | `configured_error`; exactly one value is accepted per model family |
| `TITEN_EMBED_MIN_COSINE` | yes | **none** | `configured_error`; every operator calibrates this alone |
| `TITEN_EMBED_API_KEY` | only if the provider needs a bearer token | none | supplying it *without* the rest still opts in, and then fails closed |

Three of these have no default anywhere and no value can be guessed safely:

- **`TITEN_EMBED_REVISION`** is an opaque immutable identifier for the exact
  weights behind the endpoint, ≤200 characters. It is not validated for shape —
  it is recorded in the stored index fingerprint, so changing it invalidates the
  index and forces a rebuild. That is the point: it is how you promise Titen the
  vectors already in the store came from the same weights as the next query. A
  provider that cannot name an immutable revision should stay FTS-only.
- **`TITEN_EMBED_PROFILE`** selects the query/document input transform, and the
  accepted value is *forced by the model id*. Any model id containing
  `embeddinggemma` (case- and punctuation-insensitive) accepts **only**
  `embeddinggemma-retrieval-v1`; every other model accepts **only**
  `raw-unit-v1`. There is no way to run an EmbeddingGemma model on raw
  untransformed input, and no way to apply the EmbeddingGemma prompts to another
  model. A mismatch is `configured_error`, not a warning.
- **`TITEN_EMBED_MIN_COSINE`** has **no shipped default**. An unset variable
  reads as the empty string, which is rejected, so semantic retrieval fails
  closed rather than silently accepting weak matches. Titen ships no universal
  or pre-inspected threshold: derive it from a locked evaluation of that exact
  provider, model, revision, and profile. `0` is a valid, deliberate value
  meaning "accept every candidate the index returns and let ranking decide".

Worked EmbeddingGemma example — an OpenAI-compatible endpoint serving
`embeddinggemma` at 768 dimensions:

```bash
bun add titen-memory sqlite-vec@0.1.9

TITEN_EMBED_BASE_URL=http://127.0.0.1:11434/v1 \
TITEN_EMBED_MODEL=embeddinggemma \
TITEN_EMBED_DIMS=768 \
TITEN_EMBED_REVISION=embeddinggemma-q4-2026-07-31 \
TITEN_EMBED_PROFILE=embeddinggemma-retrieval-v1 \
TITEN_EMBED_MIN_COSINE=0.32 \
bunx titen-memory serve
```

`embeddinggemma-retrieval-v1` is the only profile that model id will accept.
`embeddinggemma-q4-2026-07-31` is a placeholder: substitute the immutable
revision your provider reports, and treat any change to it as an index rebuild.
`0.32` is a placeholder too — replace it with your own calibrated floor and
record how you measured it. Verify with `curl --fail http://127.0.0.1:8787/readyz`;
a healthy vector deployment reports `capabilities.vector: "enabled"`.

The packaged vector path is verified on glibc Linux x64 with Bun 1.3.13; other
platforms need their own ready, drain, and query smoke.

For backups, key rotation, containers, and durable service setup, use the
[Bun/VPS deployment guide](https://github.com/RamaAditya49/titen/blob/main/docs/deployment/vps.md).

## Use the SDK

The SDK uses `fetch` and runs on Node 22+, Bun, Deno, and edge runtimes.

`titen-memory` is **ESM-only** — it has no CommonJS entry — so the consuming
project must be ESM too. `npm init -y` writes `"type": "commonjs"`, which is why
the second line below is not optional: without it Node fails with
`SyntaxError: Cannot use import statement outside a module` before it reaches
any Titen code.

```bash
npm install titen-memory
npm pkg set type=module
```

Save this as `titen-example.js` and run `node titen-example.js`:

```js
import { TitenClient } from "titen-memory";

const titen = new TitenClient({
  url: process.env.TITEN_URL ?? "http://127.0.0.1:8787",
  key: process.env.TITEN_API_KEY,
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

The script needs a running service and a key: start one with
`titen bootstrap --org "My Org"` and `titen serve`, then export
`TITEN_API_KEY`. In TypeScript the same file works unchanged as
`titen-example.ts` on Node 22.18+ or Bun; write `process.env.TITEN_API_KEY!`
there to satisfy strict null checks. Skipping `npm pkg set type=module` and
naming the file `.mjs`/`.mts` also works — those extensions are ESM regardless
of `package.json`.

`max_tokens` accepts 128 through 32,000. Every returned memory item includes
`untrusted: true`; the client still owns prompt boundaries and action policy.

Python callers use
[`clients/python/`](https://github.com/RamaAditya49/titen/tree/main/clients/python),
which is not on PyPI and installs from a checkout. Any other language calls the
REST API in the
[API reference](https://github.com/RamaAditya49/titen/blob/main/docs/reference/api.md)
directly.

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
| Optional vectors | `sqlite-vec` | Vectorize (see the scope note below) |
| Automatic model enrichment | Implemented, opt-in compatible HTTP | Implemented, opt-in compatible HTTP |
| Background work | Startup and bounded timer | Scheduled handler; trigger provisioning varies |

**Vectorize scope.** Vectorize and Workers AI are implemented and verified live
on `titen-test-*`, an isolated stack on the maintainer's own Cloudflare account,
with scoped BGE-M3 retrieval, bounded repair, Cron, persistence, and rollback.
That is test production and **not a general-availability claim**: no customer
deployment runs it, and your account needs its own ready, drain, and query
smoke before you rely on it. Without an AI/Vectorize binding a Worker stays
ready and retrieval is lexical D1 FTS5. The
[maturity matrix](https://github.com/RamaAditya49/titen/blob/main/docs/ROADMAP.md#maturity-matrix)
holds the exact evidence.

Automatic model-assisted claim derivation and reflection are implemented as an
opt-in capability with durable jobs, bounded validation, and separate
readiness. They are not production-activated: no candidate model has passed the
frozen activation gate, and the locked evaluation and real-runtime smokes are
not recorded. Callers author evidence-linked claims explicitly, as described in
[You author the claims](#you-author-the-claims).

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
| [MCP registry listing](https://github.com/RamaAditya49/titen/blob/main/docs/deployment/mcp-registry.md) | Publishing `server.json` to the official MCP registry |
| [Audit rules](https://github.com/RamaAditya49/titen/blob/main/docs/reference/audit.md) | How `titen audit` counts duplicates, recall loops, secrets, and staleness |
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
