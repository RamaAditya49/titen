# Source-memory import

`titen import-source` turns a reviewed local memory file or directory into
ordinary Titen evidence and direct claims. It is a bounded snapshot bootstrap,
not a live vendor adapter, delta synchronizer, or production cutover mechanism.

## Command

```text
titen import-source <path> --from <profile> --subject <id>
  [--project <stable-reference>] [--workspace-id <id>]
  [--visibility private|team|organization]
  [--trust unverified|asserted] [--db <path>] [--apply]
```

Preview is the default. It reads only the selected source, prints hashes,
locators, mappings, counts, and limits, and does not open a destination database
or make a network request. It never prints memory content.

Apply needs `TITEN_API_KEY` and exactly one destination:

```bash
# Local database; handler calls stay in process.
TITEN_API_KEY='titen_sk_...' \
  titen import-source ./MEMORY.md --from markdown@1 \
  --subject user:rama --db ~/.titen/service.db --apply

# Served Titen; TITEN_URL must be an exact origin without credentials or a path.
TITEN_URL='https://memory.example.com' TITEN_API_KEY='titen_sk_...' \
  titen import-source ./mem0-export.json --from mem0-json@1 \
  --subject user:rama --project ramaaditya49/product --apply
```

The destination key supplies organization and actor authority. `--subject` is
required. `--project` resolves an existing stable project reference and never
creates it. Team visibility additionally requires `--workspace-id`. Source
metadata, filenames, frontmatter, vendor user IDs, and record fields cannot
select or widen destination scope.

Imports default to `private` and `unverified`; `asserted` is the highest allowed
upgrade. Imported material cannot become `verified` or `policy_approved` through
this command.

## Profiles

All profiles are one data table over four parser families. Titen has no vendor
client, OAuth flow, implicit discovery, or parser class per product.

| Profile | Selected source | Claim mapping |
| --- | --- | --- |
| `mem0-json@1` | One JSON file: a bare array or `results`, `memories`, `data`, or `data.results` envelope | `memory`, `content`, or `text` only; semantic fact |
| `openclaw-memory@1` | Root `USER.md`, `MEMORY.md`, and dated `memory/*.md` notes | semantic fact |
| `hermes-memory@1` | `MEMORY.md` and `USER.md` | semantic fact |
| `claude-code-memory@1` | Markdown inside one selected project auto-memory directory | semantic fact |
| `codex-memory@1` | `MEMORY.md` and `memory_summary.md` | semantic fact |
| `gemini-cli-memory@1` | Applied Markdown in one private-memory directory; excludes inbox, sessions, skills, and `GEMINI.md` | semantic fact |
| `qwen-code-memory@1` | Root atomic Markdown and `pinned/**/*.md`; excludes generated `MEMORY.md` and `QWEN.md` | semantic fact |
| `byterover-context@1` | Curated Markdown; excludes manifests, indexes, abstracts, overviews, and archives | semantic fact |
| `amazon-q-memory@1` | `product.md`, `structure.md`, `tech.md`, and `guidelines.md` | semantic fact except procedural `guidelines.md` |
| `replit-memory@1` | One root `replit.md` | semantic fact |
| `honcho-conclusions@1` | One complete v3 page or a directory containing every contiguous page | `items[].content`; semantic fact |
| `letta-agentfile@1` | One `.af` with exactly one agent and valid selected block references | selected block `value` only; semantic fact |
| `memomind-json@1` | One `memomind-export` JSON with major version 1 | `memories[].text`; semantic fact |
| `agent-rules@1` | Recognized AGENTS, Claude, Gemini, Qwen, Cursor, Windsurf, Copilot, Cline, Kiro, Continue, Junie, Augment, Qodo, Replit, and Amazon Q rule files | procedural, but never activated as Titen policy |
| `basic-memory@1` | Regular Markdown beneath one selected Basic Memory project | semantic fact; frontmatter stripped, wikilinks and relations remain inert text |
| `markdown@1` | One explicitly named `.md` file | generic semantic fact; no branded compatibility claim |

Use Titen's existing versioned JSONL `POST /v1/import` for Titen-to-Titen
portability. The existing `@modelcontextprotocol/server-memory` first-run graph
import remains the native path for that format.

## Normalization and replay

Markdown is normalized to LF, split into heading-aware non-empty blocks, and
then split at a newline or whitespace before 4,000 JavaScript string characters.
Fenced code stays inside its surrounding block. Leading frontmatter is stripped;
`agent-rules@1` retains it as an explicitly inert applicability prefix.

Structured profiles copy only their documented memory text and timestamp.
Honcho observer/session/level values and Letta agent/block labels bind source
identity but do not become claim text or destination identity. Letta messages,
system prompts, tools, tool rules, model settings, arbitrary metadata, and
unreferenced blocks are ignored. Non-null secrets and populated tool execution
environment values reject the complete AgentFile.

Every normalized chunk becomes:

- one `imported_source` observation with source type `import:<profile>`;
- one deterministic source ID, bounded source reference, and import run ID;
- one direct claim citing that observation with relation `supports`;
- ordinary history, audit/event, FTS, and optional destination indexing work.

Repeating the same source and destination mapping replays the same observations
and claims. If an apply stops, rerun the exact command. Changed or removed source
records are add-only: this command does not infer tombstones, revocation,
supersession, or selective rollback.

## Safety and limits

Before destination access, Titen reads the complete selected source and rejects:

- symlinks, non-UTF-8 text, unsafe Unicode controls, empty/unknown shapes, and
  malformed or incomplete structured exports;
- all selected input when any existing credential pattern matches, reporting
  only rule names, locators, and counts;
- AgentFiles with multiple agents, duplicate/dangling block references,
  duplicate selected labels, secrets, or populated environment values;
- more than 64 MiB of selected files or more than 10,000 normalized entries.

The importer never opens archives or databases, follows links/includes/globs or
wikilinks, evaluates MDX/frontmatter, executes skills, fetches URLs, calls a
vendor/model, or reads raw conversations, prompts, reasoning, tool calls, or
session stores.

Take `titen backup` or a provider-native snapshot before a consequential apply.
Restoring that verified snapshot is the rollback path; automatic deletion of a
partially or incorrectly imported batch would be less safe than explicit
restore.

## Replacement boundary

This command supplies only a deterministic bulk snapshot. Replacing a live
memory system still requires an ordered delta or change feed, tombstone and
membership-revocation convergence, independent reconciliation, production-shaped
shadow comparison, and a rehearsed cutover/rollback authority. Until those are
proven, describe the result as imported snapshot data, not drop-in replacement
or cutover readiness.
