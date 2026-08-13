---
work_id: source-memory-imports
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-13
updated: 2026-08-13
review_after: 2026-08-27
owner: ramaaditya
---

# Import curated memory and close release usability gaps

## Decision

Build one offline, file-based importer for curated memory and persistent agent
context. Source profiles are data descriptors that select files, choose one of
four small parser families, and normalize records; they are not separate vendor
adapters. Every accepted entry then uses Titen's existing observation and
deterministic consolidation paths. SQL, FTS, optional index work, scope checks,
history, audit, and idempotency remain owned by the current kernel.

Ship the importer together with the three release-blocking usability fixes
reported in issues #297, #298, and #299. Context compilation remains claim-only
and therefore preserves the evidence-before-inference boundary, but reports the
authorized observation count that is still unconsolidated. The served Bun CLI
uses one stable per-user database path when `--db` is omitted, refuses to serve a
missing database, and prints the resolved absolute path. The Unix installer
fails when the installed command is not callable by name and offers
`--print-path` for automation that intentionally invokes the absolute binary.

This is worth shipping because it removes a real adoption and one-time migration
barrier without making Titen emulate every vendor API. Importing raw conversation
history from every agent is not part of the first slice: transcripts contain
prompts, tool results, local paths, credentials, and short-lived work that are not
automatically durable memory.

The command surface is:

```text
titen import-source <path> --from <profile> --subject <id>
  [--project <stable-reference>] [--workspace-id <id>]
  [--visibility private|team|organization]
  [--trust unverified|asserted] [--db <path>] [--apply]
```

Without `--apply`, the command is a local-only preview: it reads no target,
makes no network request, and writes nothing. Applying requires either one
explicit local `--db` target or both `TITEN_URL` and `TITEN_API_KEY` for a served
target. Credentials are never accepted as flags.

## What remains after drop-in checks 1 through 5

Passing the five previously discussed call-contract checks can prove that an
application connects and receives compatible results. It does not prove a safe
production replacement. A replacement still needs these gates:

6. **Bulk snapshot:** every eligible record, scope, timestamp, provenance field,
   conflict, and lifecycle state has a deterministic source-to-destination map.
7. **Ordered delta:** a high-water mark or real change feed carries creates,
   updates, tombstones, and membership revocations after the snapshot.
8. **Reconciliation:** independent counts and hashes detect missing, duplicated,
   changed, or unauthorized rows after replay and restart.
9. **Shadow operation:** production-shaped reads and writes run long enough to
   compare recall quality, latency, resource use, failure recovery, and semantic
   drift under the same workload.
10. **Cutover and reversal:** a frozen write boundary or verified dual-write
    sequence, backup, rollback point, RPO/RTO, and explicit authority switch are
    rehearsed while the old service remains recoverable.

This work supplies a bounded snapshot bootstrap. It deliberately does not claim
ordered delta synchronization, deletion convergence, shadow-soak evidence, or
cutover readiness.

## Problem

Titen already has versioned v1-v4 canonical JSONL import for Titen-to-Titen
portability and a local first-run adapter for
`@modelcontextprotocol/server-memory`. Neither is a safe parser for another
product's files. Mem0 exposes JSON-shaped memories, while coding agents mostly
keep curated Markdown alongside separate session stores. Treating all of those
as one guessed JSON schema would lose provenance and eventually ingest secrets
or executable instructions as trusted facts.

The importer needs one explicit destination subject, conservative trust,
deterministic replay, a preview before mutation, and an honest support boundary.
It must not derive organization, subject, project, workspace, visibility, or
authority from untrusted source content.

This work extends FR-8 and POR-001. It does not change Titen's canonical
[portability contract](../../reference/api.md) or the existing
`POST /v1/import` format.

## Research findings and source support

Support levels below are Titen design decisions, not compatibility claims made
by upstream projects:

- **native** means Titen already has a maintained import path, so this work does
  not duplicate it;
- **ship** means a documented portable shape or location is precise enough for a
  synthetic fixture and fail-closed parser;
- **fixture-gated** means an export exists but its public contract is not precise
  enough to advertise before a sanitized real shape is inspected; and
- **excluded** means the source is a transcript, internal database, live backend,
  or other surface that is not curated portable memory.

### Native paths retained

| Source | Existing Titen path | Decision |
| ------ | ------------------- | -------- |
| Titen | Versioned v1-v4 canonical JSONL through `POST /v1/import` | Keep it canonical and unchanged; `import-source` is not a second Titen importer. |
| `@modelcontextprotocol/server-memory` | `parseReferenceGraph` plus the current first-run compatibility import preserves entities, observations, and relations | Keep the existing path. Do not flatten its graph into generic source chunks or create a duplicate profile. |

### Profiles shipped in one implementation batch

| Profile | Primary-source finding | Exact Titen projection |
| ------- | ---------------------- | ---------------------- |
| `mem0-json@1` | [Platform export](https://docs.mem0.ai/api-reference/memory/create-memory-export) is asynchronous with a caller-selected schema; [OSS REST](https://docs.mem0.ai/open-source/features/rest-api) is a different surface. | Read one operator-created JSON file using the fixed envelope and text-field contract below. Never call a Mem0 API. |
| `openclaw-memory@1` | [OpenClaw memory](https://docs.openclaw.ai/concepts/memory) separates `USER.md`, `MEMORY.md`, and dated notes from sessions. | Import only the curated Markdown allowlist; exclude dreams, generated imports, and sessions. |
| `hermes-memory@1` | [Hermes persistent memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/) is the bounded `MEMORY.md`/`USER.md` pair, while external providers remain additive. | Import the pair only; do not read `state.db`, provider databases, or session exports. |
| `claude-code-memory@1` | [Claude Code auto memory](https://code.claude.com/docs/en/memory) is project-scoped Markdown; [session JSONL](https://code.claude.com/docs/en/sessions) is an internal changing format. | Import one explicitly selected auto-memory directory and never parse sessions. |
| `codex-memory@1` | [Codex memory](https://learn.chatgpt.com/docs/customization/memories) is distinct from ChatGPT web memory and uses generated files under `CODEX_HOME`. | Import only the two curated summary files; exclude rollouts, supporting evidence, and session state. |
| `gemini-cli-memory@1` | [Gemini CLI memory](https://geminicli.com/docs/tools/memory/) edits Markdown for durable facts; [Auto Memory](https://geminicli.com/docs/cli/auto-memory/) mines transcripts into review-only patches and skills before approval. | Import applied private-memory Markdown only. Exclude transcripts, inbox patches, and skill drafts; route `GEMINI.md` through `agent-rules@1`. |
| `qwen-code-memory@1` | [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/) stores auto-memory and team memory as plain Markdown, including `pinned/`, while `MEMORY.md` is a generated index. | Import atomic/pinned Markdown from one selected memory root, skip the generated index, and route `QWEN.md` through `agent-rules@1`. |
| `byterover-context@1` | [ByteRover's local context tree](https://docs.byterover.dev/context-tree/local-space-structure) is curated Markdown under `.brv/context-tree/` plus generated indexes, abstracts, overviews, archives, and a manifest. | Import regular knowledge files only and exclude every documented generated derivative. |
| `amazon-q-memory@1` | [Amazon Q memory bank](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/context-memory-bank.html) creates four named Markdown files under `.amazonq/rules/memory-bank/`. | Import exactly those four files; map `guidelines.md` to procedural and the other three to semantic facts. |
| `replit-memory@1` | [Replit documents `replit.md`](https://docs.replit.com/teams/custom-templates) as mutable ongoing project memory, distinct from company instructions and skills. | Import root `replit.md`; route `custom_instruction/instructions.md` through `agent-rules@1` and exclude skills/checkpoints. |
| `honcho-conclusions@1` | [Honcho v3 conclusions](https://honcho.dev/docs/v3/api-reference/endpoint/conclusions/list-conclusions) have a documented paginated JSON response with `id`, `content`, observer/observed IDs, timestamp, session, and inference level. | Assemble a complete set of operator-saved page envelopes, import `content`, and retain IDs/level only as provenance. Never call Honcho. |
| `letta-agentfile@1` | [Letta Agent File](https://github.com/letta-ai/agent-file) is an open `.af` JSON format containing memory blocks, messages, system prompts, tools, and environment variables; archival passages are not included. The [current official example](https://github.com/letta-ai/agent-file/blob/main/agents/%40letta-ai/loop/loop.af) selects root `blocks[]` through one agent's `block_ids`. | Extract only the selected blocks' `value`, with agent/block ID and label/description bound into provenance. Reject populated environment or secret values and ignore messages, system, tools, and tool rules. |
| `memomind-json@1` | [MemoMind documents](https://github.com/24kchengYe/MemoMind) a `memomind-export` JSON v1.0 with `memories[].text`, dates, tags, entities, history, and graph data. | Import only non-empty memory text and a valid date; keep the rest out of claim content. Unknown versions fail. |
| `agent-rules@1` | Major agents converge on explicit Markdown/text rule files, but their activation semantics differ. The supported families are listed below. | Import recognized files as private, unverified procedural claims for review. Preserve applicability metadata as inert text; never activate it as Titen policy. |
| `basic-memory@1` | [Basic Memory](https://github.com/basicmachines-co/basic-memory) makes the selected project's Markdown files the source of truth and documents frontmatter, observations, relations, and wikilinks as its portable grammar. Its SQLite/Postgres data is an index, not the authority. | Import regular project Markdown through the shared text parser. Strip frontmatter, retain observations/relations/wikilinks as inert text, and never read its index database or cloud API. |
| `markdown@1` | Plain Markdown is the smallest common portable surface. | Import one explicitly named file. This is generic text support, not branded compatibility for an unknown product. |

### Rule families recognized by `agent-rules@1`

One table-driven profile covers these file conventions; it does not create one
class, command, or parser per vendor.

| Family | Documented files accepted from an explicit root |
| ------ | ------------------------------------------------ |
| AGENTS/cross-tool | `AGENTS.md` and nested `AGENTS.md`; `CLAUDE.md`, `.claude/CLAUDE.md`, `GEMINI.md`, `QWEN.md`, and `.qwen/QWEN.local.md`. Cross-tool discovery is documented by [Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions), [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/), and [Junie](https://junie.jetbrains.com/docs/guidelines-and-memory.html). |
| Google Antigravity | Root `GEMINI.md` and `.agents/rules/**/*.md`, as documented by the [Antigravity codelab](https://codelabs.developers.google.com/getting-started-agy-ide); workflows and conversations are excluded. |
| Cursor and Windsurf | `.cursor/rules/**/*.mdc`, `.cursorrules`, `.windsurf/rules/**/*.md`, and `.windsurfrules`; [Cursor rules](https://docs.cursor.com/context/rules) and [Windsurf memories/rules](https://docs.windsurf.com/windsurf/cascade/memories) keep rules separate from product-managed memories. |
| GitHub Copilot | `$HOME/.copilot/copilot-instructions.md`, `$HOME/.copilot/instructions/**/*.instructions.md`, `.github/copilot-instructions.md`, and `.github/instructions/**/*.instructions.md`, following the [official locations and `applyTo` contract](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions). |
| Cline | `.clinerules/**/*.{md,txt}`; [Cline rules](https://docs.cline.bot/customization/cline-rules) also consume AGENTS, Cursor, and Windsurf conventions already covered above. |
| Kiro | `.kiro/steering/**/*.md` or an explicitly selected global steering directory; [Kiro steering](https://kiro.dev/docs/steering/) defines always, `fileMatch`, manual, and auto inclusion metadata. |
| Continue | `.continue/rules/**/*.md`, following [Continue local rules](https://docs.continue.dev/customize/rules). YAML configuration is not parsed. |
| Junie | `.junie/AGENTS.md`, `.junie/guidelines.md`, `.junie/guidelines/**/*.md`, or explicitly selected global `~/.junie/AGENTS.md`, following [Junie discovery](https://junie.jetbrains.com/docs/guidelines-and-memory.html). |
| Augment and Qodo | `~/.augment/user-guidelines.md`, `.augment/rules/**/*.{md,mdx}`, `.augment-guidelines`, and root `qodo.md`/`agents.md`/`claude.md`, based on [Augment guidelines](https://docs.augmentcode.com/setup-augment/guidelines) and [Qodo context files](https://docs.qodo.ai/v1/configuration/configuration-file/additional-context). |
| Replit and Amazon Q | `custom_instruction/instructions.md` and `.amazonq/rules/**/*.md` outside `memory-bank/`; their memory files remain owned by their named profiles. |

References such as `@file.md` or Kiro's `#[[file:...]]` remain literal text. The
importer never follows them, expands globs, fetches URLs, executes MDX/skills, or
turns vendor inclusion metadata into destination authority.

### Fixture-gated or deferred sources

| Source | Why it is not advertised in this batch | Promotion gate |
| ------ | -------------------------------------- | -------------- |
| ChatGPT web and consumer Claude/Gemini exports | The reviewed first-party documentation does not freeze a memory-only third-party schema; broad account exports also include conversations and personal data. | A sanitized first-party export fixture, version/shape discriminator, and field-level privacy review. Until then use a user-reviewed `markdown@1` summary. |
| Supermemory | [Settings can export JSON](https://supermemory.ai/changelog/api/) for up to 25,000 documents and memories, but the public changelog does not specify the file schema. | One sanitized Settings export plus a primary schema/version contract. Do not guess from search API results or third-party importers. |
| Cursor and Windsurf managed memories | Cursor manages memories through product UI, and Windsurf documents a local workspace-scoped location without a stable portable record schema. | Versioned export or sanitized fixture with a documented file discriminator. Their rule files are already supported. |
| Graphiti/Zep and LangMem/LangGraph | [Graphiti episodes](https://help.getzep.com/graphiti/core-concepts/adding-episodes) are source events and [LangMem stores](https://langchain-ai.github.io/langmem/guides/memory_tools/) are application-defined namespaces/schemas, not one portable memory dump. | An operator-owned versioned export contract that distinguishes derived memory from raw episodes. |
| OpenViking and Hindsight | Hermes documents them as live/self-hosted backends with hierarchy or PostgreSQL-backed graph memory, not portable snapshot files. Hindsight may retain full conversation turns. | Upstream portable export with lifecycle/tombstone semantics; do not parse service storage. |
| Hermes Holographic, RetainDB, Memori, and Supermemory provider state | [Hermes provider docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers/) identify an internal SQLite store or cloud/plugin backends, not stable interchange files. | Provider-owned JSON/JSONL export plus fixture and provenance map. Never read `memory_store.db` directly. |
| JSON-exporting OSS stores | [Cortex](https://github.com/gambletan/cortex), [agent-memory-mcp](https://github.com/ipiton/agent-memory-mcp), [Memory Graph](https://github.com/memory-graph/memory-graph), [Codemem](https://github.com/kunickiaj/codemem), and similar projects document JSON export/import commands, but their user-facing docs do not freeze exact record schemas and version behavior. | A generated, sanitized export fixture plus a primary shape/version contract for each branded profile. Do not infer compatibility from the presence of an `export` command. |
| Live/database-backed OSS stores | [memU](https://github.com/NevaMind-AI/MemU), [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service), Recall MCP, SuperLocalMemory, Lore, Agent-Memory, OpenLore, MemOS, Cognee, Memobase, and similar stores primarily expose a live service, SQLite/Postgres/vector/graph storage, or an underspecified backup. | A provider-owned portable JSON/JSONL contract and synthetic fixture. Never parse an internal database or scrape a live API under a file-import compatibility claim. |
| Raw sessions, trajectories, and support bundles | OpenClaw trajectories, Claude/Codex/Gemini sessions, Letta messages, and Hermes session exports can contain prompts, tools, results, local paths, and credentials. | A separate transcript-archive/privacy spec. They never silently fall back to durable memory import. |

### Profile maturity rule

A profile is eligible for the shipped list only when it has a primary-source
format or location, synthetic fixtures, a versioned Titen adapter ID, and a
fail-closed unknown-shape test. An undocumented vendor dump may be tested behind
an experimental fixture, but it is not advertised as supported and never falls
back to the generic profile automatically.

`markdown@1` is the deliberate path for a user-controlled single memory file
whose branded adapter would only be an alias. That covers projects such as
[xAI Grok Shell](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/README.md),
[ClawMem](https://github.com/yoloshii/ClawMem), and similar `MEMORY.md`-based
tools without pretending to preserve undocumented runtime semantics. Add a
named profile only when it contributes a real multi-file allowlist, structured
shape, or safer exclusion boundary.

### Profile file allowlists

- `mem0-json@1` accepts one explicitly named UTF-8 JSON file.
- `openclaw-memory@1` accepts root `USER.md`, root `MEMORY.md`, and
  `memory/YYYY-MM-DD.md` or `memory/YYYY-MM-DD-<slug>.md`; it does not recurse
  into `memory/imports/` or `.dreams/`.
- `hermes-memory@1` accepts only `MEMORY.md` and `USER.md` from one explicitly
  selected Hermes memory directory.
- `claude-code-memory@1` accepts `.md` files under one explicitly selected
  project's auto-memory directory; it does not walk sibling projects.
- `codex-memory@1` accepts only `MEMORY.md` and `memory_summary.md` from one
  explicitly selected Codex memory directory.
- `gemini-cli-memory@1` accepts `.md` files from one explicitly selected active
  private-memory directory. It excludes every `SKILL.md`, inbox directory,
  `.patch`, settings file, lock/state file, and sibling chat/session directory.
- `qwen-code-memory@1` accepts atomic `.md` files and top-level `pinned/**/*.md`
  from one selected managed-memory or `.qwen/team-memory/` root. It skips the
  generated `MEMORY.md` index plus settings, locks, cursors, and chat state.
- `byterover-context@1` accepts regular curated `.md` knowledge files from one
  selected context-tree root. It excludes `_manifest.json`, `_index.md`, every
  generated `context.md`, `*.abstract.md`, `*.overview.md`, and `_archived/`.
- `amazon-q-memory@1` accepts only `product.md`, `structure.md`, `tech.md`, and
  `guidelines.md` from one selected `.amazonq/rules/memory-bank/` directory.
- `replit-memory@1` accepts one explicitly named root `replit.md` file.
- `honcho-conclusions@1` accepts one JSON page envelope when `pages` is one, or
  a selected directory of JSON page envelopes whose pages are exactly the
  contiguous set `1..pages` with equal `total`, `size`, and `pages` metadata.
- `letta-agentfile@1` accepts one explicitly named UTF-8 JSON `.af` file.
- `memomind-json@1` accepts one explicitly named UTF-8 JSON export with exact
  `format: "memomind-export"` and supported major version `1`.
- `agent-rules@1` accepts only the documented file patterns in the rule-family
  table from one explicitly selected file or root. It excludes skills,
  workflows, prompts, commands, chats, and `amazon-q-memory@1`'s memory bank.
- `basic-memory@1` accepts regular `**/*.md` notes beneath one explicitly
  selected Basic Memory project root. It skips every hidden path component,
  non-Markdown attachment, app database, configuration file, and cloud surface.
- `markdown@1` accepts one explicitly named `.md` file and never scans a directory.

Every directory profile sorts relative paths, reports skipped unknown files,
deduplicates identical selected paths, rejects symlinks at every path component,
and fails when its selected root contains no allowlisted memory.

## In scope

- Add the explicit `import-source` CLI command and the 16 profiles listed as
  shipped above. Represent profile selection, allowlists, claim kind, and parser
  family in one data table rather than one interface/class per vendor.
- Use four parser families only: deterministic Markdown/text blocks; bounded
  flat JSON record envelopes reusing the Mem0 logic in `titen audit`; complete
  Honcho page assembly; and the field-allowlisted Letta AgentFile projection.
- Normalize each accepted source block to one `imported_source` observation and
  one evidence-linked direct claim so FTS-only recall works without an LLM or
  embedding provider.
- Use existing `GET /v1/principal`, project resolution, `POST /v1/observations`,
  and `POST /v1/consolidations` behavior for served targets; use the same app
  handlers in process for an explicit local database.
- Preserve a versioned source type, a root-relative source locator or its hash,
  an upstream record ID when present, a deterministic source ID, source time
  when valid, and a deterministic import run ID.
- Default every import to `private` and `unverified`. Permit only the explicit
  `asserted` upgrade; imported evidence can never enter as `verified` or
  `policy_approved`.
- Reject secret-pattern hits, unsafe Unicode, unsupported files, symlinks,
  malformed JSON, unknown envelopes, empty records, and over-limit input before
  opening the destination.
- Bound the first implementation to regular local files/directories, 64 MiB of
  selected input, 10,000 normalized entries, and Titen's existing 4,000-character
  claim limit.
- Keep `POST /v1/context/compile` claim-only, add an authorized
  `unconsolidated_observations` diagnostic to its budget, and document that an
  accepted observation becomes recallable only after a claim cites it.
- Default Bun service database commands to the absolute
  `~/.titen/service.db` path, retain explicit `--db`, refuse `serve` when its
  resolved store does not exist, and fail with an explicit migration hint when
  a legacy working-directory `titen.db` would otherwise be silently bypassed.
- Update `titen.dev/install.sh` so the normal path exits non-zero when `titen`
  does not resolve to the installed binary, while `--print-path` installs,
  verifies, and prints only the absolute executable path on stdout.
- Release the completed package as the next minor stable version, publish the
  corresponding annotated tag and GitHub Release, synchronize `titen-web`,
  deploy it manually, and verify npm plus both public hostnames. No automated
  deployment workflow is introduced.

## Normalization contract

### Destination authority

`--subject` is mandatory. `--project` is a stable reference resolved against
the destination and never created implicitly. Team visibility requires an
explicit `--workspace-id`; all wider visibility remains subject to the
destination principal's existing role, scope, workspace, and trust ceilings.

Mem0 `user_id`, `agent_id`, `app_id`, and `run_id`; filenames; Markdown
frontmatter; transcript roles; and any JSON authority-like field are source
provenance only. None may select or widen the destination.

### Markdown blocks

The parser normalizes CRLF to LF, follows UTF-8 text only, and processes files
in sorted root-relative path order. ATX headings update the current heading
path. Non-empty blocks separated by blank lines become entries with that heading
path prepended. A block over 4,000 JavaScript string characters splits at the
last newline or whitespace before the limit, with a hard split only when no
boundary exists. Fenced code remains in its surrounding block unless the size
limit forces a split. Leading YAML frontmatter is stripped without
interpretation for memory profiles. `agent-rules@1` instead retains it as a
bounded, inert `Source applicability metadata` prefix so source globs/triggers
are not silently lost; Titen neither parses nor enforces those conditions.
Empty headings and frontmatter alone do not become entries. MDX is handled only
as UTF-8 text and is never evaluated.

The importer never resolves Markdown links, `@file` imports, glob references,
Kiro `#[[file:...]]` references, includes, or nested instruction files. A file
must itself be selected by the profile allowlist to enter the preview.

### Mem0 records

`mem0-json@1` accepts a bare array or the `results`, `memories`, `data`, or
`data.results` envelope. A record needs exactly one non-empty text value from
`memory`, `content`, or `text`; it may carry `id` and a valid `created_at` or
`createdAt`. Unknown extra metadata is not copied into memory content. A JSON
document that matches no supported envelope fails instead of importing zero.

### Honcho conclusion pages

Every selected JSON document must match the documented v3 page envelope. The
page set must agree on `total`, `size`, and `pages`, contain every page exactly
once, and contain exactly `total` conclusion objects after concatenation. Every
conclusion needs non-empty string `id` and `content`, valid string
`observer_id`/`observed_id`, a valid `created_at`, and a documented string
`level`; `session_id` may be null or a string. Duplicate IDs or an incomplete,
overlapping, or internally inconsistent page set fail before target access.

Only `content` becomes claim text. IDs, peer/session identifiers, and inference
level are bounded provenance and cannot choose destination scope or trust.

### Letta AgentFile projection

Adapter `letta-agentfile@1` pins the current documented structural shape rather
than inventing an upstream schema version. The root must contain `agents` and
`blocks` arrays and exactly one agent. That agent needs a non-empty string `id`
and a unique string `block_ids` array. Every referenced block ID must resolve
exactly once in root `blocks`; unreferenced blocks are ignored and counted.
Each selected block needs matching non-empty string `id`, `label`, and `value`,
an optional null/string `description`, and valid optional
`created_at`/`updated_at`. `updated_at`, then `created_at`, supplies occurrence
time when present. Duplicate agent/block IDs, block labels, dangling references,
or another critical root shape fail closed.

The importer rejects any non-null secret payload and any non-null, non-empty
value under `tool_exec_environment_variables`, even when it misses a generic
secret pattern. Only selected block values become claim text. Agent/block ID,
label, description, and timestamps bind provenance. The parser counts but never
copies or transmits `messages`, `system`, `tools`, `tool_rules`,
model/embedding configuration, tags, arbitrary metadata, or environment
variable keys/values. AgentFile archival passages are not present in the
documented format and are not claimed as imported.

### MemoMind records

`memomind-json@1` requires exact `format: "memomind-export"`, a version whose
major component is `1`, and a `memories` array. Each memory needs one non-empty
string `text` and may carry a valid `date`; unknown extra fields, history,
entities, tags, source-memory IDs, and graph nodes/edges are not copied into
claim content. A duplicate full record is reported in preview and replayed by
deterministic identity; a duplicate or missing upstream ID is not guessed
because the published example does not require one.

### Titen records

Source identity is profile-specific and deterministic: Markdown uses the sorted
root-relative locator plus block/chunk ordinal; Mem0 uses upstream ID or record
ordinal; Honcho uses conclusion ID; AgentFile uses agent ID plus block ID; and
MemoMind uses record ordinal. Ordinals are zero-based after deterministic file
and record ordering. Equal content at distinct identities remains distinct;
repeating the same file produces the same identities.

Each normalized entry is written with:

- observation kind `imported_source`;
- source type `import:<profile>` where the profile already includes its version;
- a bounded source reference built from the root-relative locator and source
  record/chunk identity. The readable upstream ID is retained when it fits;
  overflow becomes a `sha256:` reference, while the deterministic source ID
  binds the complete allowlisted provenance tuple;
- a deterministic `source.id` and import `run_id` derived with SHA-256 from the
  adapter version, source identity, content, and explicit destination mapping;
- source occurrence time when the source supplies one, otherwise `null`;
- the selected trust and visibility, never higher or wider than destination
  authority permits;
- one direct claim citing that observation with `supports`, using `procedural`
  for `agent-rules@1` and Amazon Q `guidelines.md`, and `semantic_fact` for every
  other shipped source entry.

Source profile classification is descriptive, never an authority grant. In
particular, an imported procedural claim remains private/unverified by default,
is not an active policy, does not reproduce vendor file-match activation, and
cannot become policy-approved through import.

The importer performs no model extraction, summary, conflict resolution,
automatic supersession, or trust inference. It makes no synchronous or
importer-owned model call. Existing destination indexing and opt-in background
enrichment may run after the canonical write exactly as they do for an ordinary
observation.

## Preview, apply, and recovery

Preview parses and validates the complete selected source before opening a
database or creating a request. It reports only profile/version, selected file
and entry counts, bytes, chunk count, duplicate-content count, source timestamp
coverage, secret-rule names/counts, destination arguments, and the target mode
that `--apply` would require. Structured profiles also report only bounded
non-content completeness data: Honcho page/total coverage, AgentFile selected
block and ignored message/tool counts, and MemoMind version/record count.
`agent-rules@1` reports the recognized rule family per file. Preview prints no
memory text, frontmatter value, credential fragment, environment-variable name,
or absolute path.

Apply repeats the same full preflight, authenticates the destination, resolves
the project, validates destination authority, then appends entries in the exact
preview order. Observation source IDs and deterministic consolidation
idempotency keys make an exact rerun a replay. If a later request fails, earlier
canonical writes remain valid and the command reports the completed count and a
non-content source locator; rerunning the exact command resumes without duplicate
observations or claims.

Changing source content is intentionally ADD-only and can create new evidence.
This command does not infer that an absent or edited source record should revoke
old evidence. Source-to-destination delta convergence requires the separate
replacement gates above.

## Out of scope

- Live vendor credentials, API calls, OAuth, background synchronization, or
  auto-detection of an installed vendor.
- ZIP/tar archives, URLs, database files, browser automation, or recursive home
  directory discovery.
- Raw ChatGPT, Claude, Codex, Gemini, Qwen, OpenClaw, Hermes, Replit, Letta, or
  Antigravity conversations, reasoning, prompts, tool calls/results, settings,
  skills, plugins, support traces, and credentials.
- Automatic activation of imported rules, evaluation of vendor frontmatter,
  reproduction of file-glob/manual/auto inclusion semantics, dereferencing of
  source files, or conversion of rules into Titen governance policy.
- A UI uploader, hosted conversion service, provider/plugin marketplace, or one
  parser interface per vendor.
- Automatic deletion, supersession, trust promotion, LLM extraction, or
  reconciliation of a changed source.
- Full Mem0 API compatibility, application drop-in compatibility, production
  cutover, or a claim that an imported snapshot replaces a live source service.
- Branded support for any fixture-gated source in the research table unless its
  promotion gate is satisfied before implementation scope is frozen.
- Automatic migration, deletion, or relocation of an existing working-directory
  `titen.db`; the CLI names the exact explicit command needed to keep using it.
- A JSON installer protocol, hosted conversion service, or installer-managed
  shell-profile edit. `--print-path` is the complete machine-readable contract.

## Constraints and risks

- Imported text is untrusted context. It can contain instructions even when it
  is not a secret-pattern hit; Titen must not execute it or treat it as policy.
- Rule frontmatter is retained only to avoid losing applicability evidence.
  Titen does not reproduce the source agent's activation engine, so imported
  rules are an archival bootstrap for review rather than behavior parity.
- Secret detection is a fail-closed high-signal boundary, not proof that a file
  is secret-free. Operators still review exports before applying them.
- File-only parsing avoids sending source data to a vendor or model, but applying
  to a served Titen instance necessarily transmits accepted entries to that
  configured destination.
- There is no automatic selective rollback. Operators take the existing
  provider-native snapshot or `titen backup` before apply when reversal matters.
  Restoring that backup is the rollback authority for an unwanted bulk import.
- The 64 MiB/10,000-entry ceiling deliberately avoids a streaming JSON parser or
  archive dependency. Split a larger export; add streaming only after a measured
  adopter cannot do so.

## EARS acceptance criteria

- **AC-SMI-001 — Event-driven:** When `titen import-source` receives one shipped
  profile, explicit source path, and destination subject, Titen shall produce a
  deterministic complete preview using only that profile's allowlisted files
  and mappings.
- **AC-SMI-002 — State-driven:** While `--apply` is absent, Titen shall make no
  network request, open or create no destination database, mutate no source, and
  persist no import artifact.
- **AC-SMI-003 — Event-driven:** When an authorized operator applies a valid
  preview, Titen shall create one `imported_source` observation and one
  evidence-linked direct claim per normalized chunk through the existing kernel
  paths, without a synchronous or importer-owned model call or new canonical
  storage path.
- **AC-SMI-004 — Ubiquitous:** Titen shall derive organization and actor from the
  destination credential and shall take subject, project, workspace, visibility,
  and trust only from explicit destination arguments subject to current policy.
- **AC-SMI-005 — Ubiquitous:** Imported observations and claims shall default to
  private unverified data, shall accept at most asserted trust, and shall never
  become verified or policy-approved through source fields or profile choice.
- **AC-SMI-006 — Event-driven:** When the exact source and destination mapping are
  applied again, Titen shall replay deterministic source and consolidation keys
  and create zero duplicate observations or claims.
- **AC-SMI-007 — Event-driven:** When an imported fixture is recalled with vectors
  disabled, both Bun/SQLite and workerd/D1 shall return its claim through the
  ordinary authorized context compiler with its imported observation as
  evidence.
- **AC-SMI-008 — Unwanted behavior:** If a source is malformed, unsupported,
  empty, symlinked, unsafe-Unicode, or above a declared bound, then Titen shall
  fail before destination access and shall create no canonical record.
- **AC-SMI-009 — Unwanted behavior:** If any selected entry matches an existing
  secret rule, then Titen shall reject the complete import and report only the
  source locator, rule name, and count without printing matched content.
- **AC-SMI-010 — Unwanted behavior:** If destination authentication, project
  resolution, scope, trust, or visibility validation fails, then Titen shall
  expose a bounded non-content error and shall not widen or guess a destination
  mapping.
- **AC-SMI-011 — Event-driven:** When apply stops after one or more successful
  writes, Titen shall report the completed entry count and an exact rerun shall
  resume to completion without duplicating earlier observations or claims.
- **AC-SMI-012 — Ubiquitous:** Titen shall implement source import with built-in
  Bun/Web APIs and existing kernel handlers, adding no dependency, SQL migration,
  vendor network client, storage format, or REST/MCP route.
- **AC-SMI-013 — Ubiquitous:** Titen documentation shall publish the exact source
  profile matrix, mappings, limits, security boundary, and unsupported transcript
  formats without describing generic Markdown or an experimental fixture as
  branded compatibility.
- **AC-SMI-014 — State-driven:** While ordered delta, tombstone, reconciliation,
  shadow-soak, and rollback gates remain unproven, Titen shall describe source
  import only as snapshot bootstrap and shall not claim production drop-in or
  replacement readiness from it.
- **AC-SMI-015 — Ubiquitous:** Titen shall implement all 16 shipped profiles as
  one data-driven allowlist/classification table over four parser families,
  shall map only `agent-rules@1` and Amazon Q `guidelines.md` to procedural, and
  shall add no per-vendor client, interface, command, or implicit detection.
- **AC-SMI-016 — Unwanted behavior:** If Honcho pages are incomplete or
  inconsistent, an AgentFile has multiple agents, dangling/duplicate block
  references, a populated environment/secret value, or another unsupported
  structural shape, or a MemoMind export has an unsupported
  format/version/record, then Titen shall fail the complete preview before target
  access and shall not copy any ignored structured field into claim content.
- **AC-SMI-017 — Ubiquitous:** Titen shall not follow source references, expand
  globs, traverse Basic Memory wikilinks, evaluate MDX/frontmatter, execute
  skills, or activate imported rules as policy; retained applicability metadata
  shall remain inert evidence text.
- **AC-SMI-018 — Ubiquitous:** Existing Titen v1-v4 canonical import and
  `@modelcontextprotocol/server-memory` first-run graph import shall retain their
  current schemas, relation behavior, idempotency, and tests unchanged.
- **AC-SMI-019 — Event-driven:** When an authorized compile scope contains
  observations that cite no claim and no eligible claim is selected, Titen shall
  keep `items` claim-only and report the exact authorized
  `unconsolidated_observations` count without exposing content or hidden-scope
  counts; API documentation shall state the observation-to-claim requirement.
- **AC-SMI-020 — Event-driven:** When a Bun service command omits `--db`, Titen
  shall resolve the same absolute `~/.titen/service.db` path from every working
  directory; `bootstrap` shall create its parent securely, `serve` shall refuse
  a missing store, and both shall identify the resolved path without printing
  credentials beyond bootstrap's existing one-time output.
- **AC-SMI-021 — Unwanted behavior:** If an unflagged Bun command would silently
  bypass an existing working-directory `titen.db`, then Titen shall stop before
  mutation and name the legacy path plus the exact `--db` compatibility action.
- **AC-SMI-022 — Event-driven:** When the Unix installer verifies the package by
  absolute path but `titen` does not resolve to that same binary, its default
  mode shall print a predictable `TITEN_BIN=<absolute path>` line and exit
  non-zero; `--print-path` shall print only that absolute path and exit zero.
- **AC-SMI-023 — Event-driven:** When the release gates pass, npm `latest`, the
  annotated Git tag, the non-draft GitHub Release, the Titen package version,
  and the `titen-web` stable manifest/release page shall agree on the next minor
  version, and a clean registry install shall pass importer and CLI smoke.
- **AC-SMI-024 — Event-driven:** When `titen-web` is deployed manually, both
  canonical hostnames shall serve the new stable manifest, release page,
  importer documentation, and installer bytes; the default installer failure
  and `--print-path` success paths shall be verified without GitHub Actions or
  another automated release gate.

## Done conditions

Every criterion has reproducible evidence in the paired plan. Synthetic fixtures
cover every shipped profile and every fail-closed class; no private export or
credential enters the repository. Focused CLI/integration tests, dual-runtime
contract tests, FTS-only recall, package verification, Worker dry-build, workflow
checks, route-document checks, clean npm installation, installer checks, and
public website smoke pass manually. No schema, dependency, REST/MCP route, vendor
connection, or CI/CD workflow is added. Titen and `titen-web` are committed and
pushed, the stable npm package/tag/GitHub Release and website deployment are
verified, issues #297 through #299 are closed with release evidence, and the spec
and plan move together to `done/` only after all evidence is recorded.
