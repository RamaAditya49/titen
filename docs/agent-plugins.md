# Agent plugins and host kits

Titen has two memory entry points, and the files in this repository package
its portable Agent Skill and connection settings for both across hosts.

- **Local stdio.** `titen mcp` with neither `TITEN_MCP_URL` nor
  `TITEN_API_KEY` set opens or creates `~/.titen/memory.db`, provisions its own
  org, workspace, project, and owner as real rows, and serves MCP over stdio
  in-process: no HTTP hop, no key, no outbound call, lexical FTS retrieval only.
- **Served HTTP.** The authenticated Streamable HTTP MCP endpoint at `/mcp`, for
  one instance that several agents and people share.

`titen` is a Bun program. Without Bun on `PATH` it exits with
`titen: error: bun was not found on PATH.`;
`curl -fsSL https://titen.dev/install.sh | bash` installs Bun when it is
missing.

Every host artifact below registers the same command:

```json
{
  "command": "titen",
  "args": ["mcp"]
}
```

Which entry point that command uses is decided entirely by the environment it
inherits.

## Connecting to a served instance

Set these outside source control before installing a host artifact:

```bash
export TITEN_MCP_URL='http://127.0.0.1:8787/mcp'
export TITEN_API_KEY='replace-with-an-agent-specific-key'
```

Set **both or neither**. With exactly one of the two set, `titen mcp` throws
rather than guessing which store you meant.

`TITEN_MCP_URL` is the complete MCP endpoint, including `/mcp`. Give every
agent its own narrow, revocable key. Never paste a key into a repository file.

Hosts with native Streamable HTTP support should connect to that URL directly.
For a host that can launch only a local stdio MCP server, install the CLI and
register the inherited-environment command above instead.

The bridge stores no state, opens no local socket, and writes only MCP messages
to stdout. Keep both environment variables in the host's secret-aware process
environment; do not copy their values into the command arguments or project
configuration.

## Fast path

Install the CLI first. For local stdio there is nothing else to start; for a
served instance, start it and export both variables before connecting. Native
HTTP avoids an extra process; `titen mcp` is both the local entry point and the
fallback for hosts that only launch stdio servers.

| Host | Connection | Check |
| --- | --- | --- |
| Codex | `codex mcp add titen --url "$TITEN_MCP_URL" --bearer-token-env-var TITEN_API_KEY` | `codex mcp get titen --json` |
| Claude Code | `claude mcp add --transport stdio --scope user titen -- titen mcp` | `claude mcp get titen` and `/mcp` |
| OpenClaw | merge `integrations/openclaw/openclaw.json` or install the ClawHub bundle | `openclaw mcp doctor titen --probe` |
| Hermes | stdio bridge with explicit environment-name mapping below | `hermes mcp test titen` |
| Generic stdio host | command `titen`, args `mcp` | confirm all eighteen tools appear |

After connecting, ask the host to resolve the current Git origin and compile
Titen context for one concrete task. A correct connection lists eighteen tools —
the nine `titen_*` tools plus the nine `@modelcontextprotocol/server-memory`
compatibility names — and uses `titen_project_resolve` before the first
project-scoped compile.

## What ships

| Host | Shipped artifact | Installation surface |
| --- | --- | --- |
| Codex | Native repo-marketplace plugin | `.agents/plugins/marketplace.json` |
| Claude Code | Native marketplace plugin | `.claude-plugin/marketplace.json` |
| ZCode | Claude-compatible marketplace plugin | import `RamaAditya49/titen` |
| OpenClaw | Public ClawHub bundle and native MCP config | ClawHub + `integrations/openclaw` |
| Cursor | Native marketplace plugin; upstream submission pending review | `.cursor-plugin/marketplace.json` |
| Hermes | Native Python skill plugin | `plugins/hermes/titen-memory` |
| Pi | Native Pi skill package | `plugins/pi/titen-memory` |
| OpenCode | Native MCP config + Agent Skill | `integrations/opencode` + `.agents/skills` |
| Windsurf | Native MCP config + model-decision rule | `integrations/windsurf` |
| TRAE | Native MCP UI recipe + Agent Skill | `.agents/skills/titen-memory` |

The plugin names differ, but current repository artifacts target the same nine
`titen_*` server tools: `titen_project_resolve`, `titen_compile`,
`titen_remember`, `titen_consolidate`, `titen_feedback`,
`titen_checkpoint_save`, `titen_checkpoint_get`, `titen_lease_acquire`, and
`titen_handoff`. The server also answers the nine
`@modelcontextprotocol/server-memory` compatibility names, so a host that lists
tools sees eighteen.

## Check and update

Run `titen version --check` to compare the installed CLI with the current
stable-channel CLI release and see the independently versioned stable-channel
plugin release. "Stable" is the release channel — a deliberate release rather
than a prerelease on `next` — and says nothing about API stability; Titen is
pre-1.0. This is an explicit request to `https://titen.dev/version.json`;
neither the CLI nor MCP checks in the background.

Plugin updates remain owned by the host that installed them:

| Host | Refresh path |
| --- | --- |
| Codex | `codex plugin marketplace upgrade titen`, then restart Codex |
| Claude Code | `claude plugin update titen-memory@titen`, then restart Claude Code |
| Cursor or ZCode | Use the plugin manager's update control, then restart the host |
| OpenClaw/ClawHub | Update the installed `titen-memory` skill through ClawHub |
| Hermes | `hermes plugins update titen-memory`, then restart Hermes |
| Pi, OpenCode, Windsurf, or TRAE | Re-copy or reinstall the repository artifact using the installation path below |

The CLI/server package and host plugins are separate artifacts and do not need
matching version numbers. The MCP handshake reports the server package version;
the deployment revision remains available through `/healthz` and `/readyz`.

## Codex

```bash
codex plugin marketplace add RamaAditya49/titen --ref main \
  --sparse .agents/plugins --sparse plugins/titen-memory
codex plugin add titen-memory@titen
codex mcp add titen --url "$TITEN_MCP_URL" \
  --bearer-token-env-var TITEN_API_KEY
```

The Codex plugin stays skills-only because the operator-selected endpoint lives
in user configuration, not in the plugin. See the [Codex MCP details](./agent-guide.md#mcp-integration).

## Claude Code

The shortest connection path uses Claude Code's user-scoped stdio MCP config.
With no Titen environment variables set this is the local store; to bridge to a
served instance, start Claude from a process that has both of them:

```bash
claude mcp add --transport stdio --scope user titen -- titen mcp
claude mcp get titen
```

The optional plugin adds Titen's usage skill beside the same MCP connection:

```bash
claude plugin marketplace add RamaAditya49/titen
claude plugin install titen-memory@titen
```

Restart Claude Code after exporting both environment variables. Claude expands
them in the plugin's HTTP MCP URL and headers. Validate a checkout with:

```bash
claude plugin validate . --strict
```

The bundle follows Claude's [plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
and [MCP](https://code.claude.com/docs/en/mcp) formats.

## ZCode

In **Settings → Plugins → Marketplace**, click **+**, add
`RamaAditya49/titen`, then install **Titen Memory**. ZCode loads the same
Claude-compatible skills and MCP declaration; restart ZCode after setting the
two environment variables at the OS/session level. ZCode's plugin management is
currently beta and its UI does not yet accept sensitive plugin configuration,
so the key stays in the environment. See [ZCode plugins](https://zcode.z.ai/en/docs/plugin).

## OpenClaw and ClawHub

Install the public [Titen Memory bundle 0.2.0](https://clawhub.ai/packages/@ramaaditya49/titen-memory)
from ClawHub:

```bash
openclaw plugins install clawhub:@ramaaditya49/titen-memory
openclaw gateway restart
openclaw mcp doctor titen --probe
```

The public bundle exposes the current nine-tool skill and remote Streamable HTTP
MCP declaration. Version 0.2.0 passed the current ClawHub scan and is available
for download. The older standalone
[skill 0.1.0](https://clawhub.ai/ramaaditya49/skills/titen-memory) remains a
seven-tool compatibility snapshot.

For a repository-only install instead of ClawHub, merge only the
`mcp.servers.titen` entry from `integrations/openclaw/openclaw.json` into the
OpenClaw config, then run:

```bash
openclaw gateway restart
openclaw mcp doctor titen --probe
```

OpenClaw loads the bundle's skill and remote HTTP MCP server
without arbitrary in-process plugin code. Its exposed tool names use
`titen__<canonical-name>`. See [OpenClaw bundles](https://docs.openclaw.ai/plugins/bundles)
and [native MCP configuration](https://docs.openclaw.ai/cli/mcp).

New installs should use the bundle so the skill and MCP declaration arrive
together. The source repository and bundle package remain Apache-2.0.

## Cursor

Add `RamaAditya49/titen` as a GitHub-backed team/custom marketplace, install
**Titen Memory** in **Cursor Settings → Plugins**, then restart Cursor with the
two environment variables set. The plugin uses Cursor's documented
`${env:NAME}` interpolation in `mcp.json`; `/add-plugin titen-memory` installs it
after the marketplace is available. The format follows Cursor's
[official plugin specification](https://github.com/cursor/plugins).

The same validated package is under public vendor review in
[cursor/plugins#184](https://github.com/cursor/plugins/pull/184). Until Cursor
merges it, the repository marketplace above remains the install path.

## Hermes

The shortest path uses the CLI's stdio registry and the bridge installed with
`titen-memory`:

```bash
hermes mcp add titen \
  --command titen \
  --args mcp \
  --env 'TITEN_MCP_URL=${TITEN_MCP_URL}' 'TITEN_API_KEY=${TITEN_API_KEY}'
hermes mcp test titen
```

Put `TITEN_MCP_URL` and `TITEN_API_KEY` in `~/.hermes/.env` so Hermes and the
spawned bridge receive them. The `--env` entries store the variable names as
placeholders, not the secret values.

For direct HTTP instead, add this entry to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  titen:
    url: "${TITEN_MCP_URL}"
    headers:
      Authorization: "Bearer ${TITEN_API_KEY}"
    tools:
      include:
        - titen_project_resolve
        - titen_compile
        - titen_remember
        - titen_consolidate
        - titen_feedback
        - titen_checkpoint_save
        - titen_checkpoint_get
        - titen_lease_acquire
        - titen_handoff
```

The optional `plugins/hermes/titen-memory` package adds usage guidance only.
Hermes' native `mcp_servers` client owns the connection; Titen does not replace
Hermes' built-in memory provider. See
[Hermes plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)
and [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp).

## Pi

Pi has no built-in MCP client. Install the native Pi package for the skill:

```bash
pi install ./plugins/pi/titen-memory
```

Then expose the existing Titen HTTP MCP server through the MCP adapter selected
by the operator. The package deliberately contains no extension code, so it
cannot capture a transcript or run with ambient process authority. Pi discovers
the skill as `/skill:titen-memory`. See [Pi packages](https://pi.dev/docs/latest/packages)
and [Pi skills](https://pi.dev/docs/latest/skills).

## OpenCode

Merge `integrations/opencode/opencode.json` into the applicable OpenCode config
and copy `.agents/skills/titen-memory` into the target project or global
`~/.agents/skills/` directory. Do not replace an existing config wholesale.
Then run:

```bash
opencode mcp list
```

The config disables OAuth discovery because Titen uses a bearer key and follows
OpenCode's [remote MCP](https://opencode.ai/docs/mcp-servers) and
[Agent Skills](https://opencode.ai/docs/skills) formats.

## Windsurf

Merge the `titen` entry from `integrations/windsurf/mcp_config.json` into
`~/.codeium/windsurf/mcp_config.json`, then copy
`integrations/windsurf/titen-memory.md` to
`.windsurf/rules/titen-memory.md` in the target workspace. Restart Cascade and
verify that the eighteen tools appear. Windsurf expands `${env:NAME}` in remote MCP
URLs and headers; see [Cascade MCP](https://docs.windsurf.com/windsurf/cascade/mcp)
and [Rules](https://docs.windsurf.com/windsurf/cascade/memories).

## TRAE

Copy `.agents/skills/titen-memory` into the target workspace. TRAE discovers
Agent Skills from `.agents/skills`. In **AI Management → MCP**, add an HTTP MCP
server named `titen`, set the URL to the value of `TITEN_MCP_URL`, and set the
Authorization header through TRAE's secret-aware UI. Do not commit an exported
config containing the key. TRAE's share/import flow scans Agent and MCP
configuration for credentials; see the [TRAE changelog](https://www.trae.ai/changelog)
and [Agent sharing security](https://www.trae.ai/blog/product_thought_0526).

## Deliberate limits

- No package adds automatic recall, transcript capture, end-of-session flush,
  or autonomous loops.
- No package embeds an endpoint or credential.
- No package reimplements Titen's server, authorization, or memory policy.
- Public vendor-catalog review is separate from repository marketplaces.
  ClawHub 0.2.0 is published; the Cursor catalog submission is pending vendor
  review.
