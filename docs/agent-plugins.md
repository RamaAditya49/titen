# Agent plugins and host kits

Titen has one memory implementation: the authenticated Streamable HTTP MCP
endpoint at `/mcp`. The files in this repository only package its portable
Agent Skill and connection settings for different hosts.

Set these outside source control before installing a host artifact:

```bash
export TITEN_MCP_URL='http://127.0.0.1:8787/mcp'
export TITEN_API_KEY='replace-with-an-agent-specific-key'
```

`TITEN_MCP_URL` is the complete MCP endpoint, including `/mcp`. Give every
agent its own narrow, revocable key. Never paste a key into a repository file.

## What ships

| Host | Shipped artifact | Installation surface |
| --- | --- | --- |
| Codex | Native repo-marketplace plugin | `.agents/plugins/marketplace.json` |
| Claude Code | Native marketplace plugin | `.claude-plugin/marketplace.json` |
| ZCode | Claude-compatible marketplace plugin | import `RamaAditya49/titen` |
| OpenClaw | Public ClawHub skill, staged bundle plugin, and native MCP config | ClawHub + `integrations/openclaw` |
| Cursor | Native marketplace plugin | `.cursor-plugin/marketplace.json` |
| Hermes | Native Python skill plugin | `plugins/hermes/titen-memory` |
| Pi | Native Pi skill package | `plugins/pi/titen-memory` |
| OpenCode | Native MCP config + Agent Skill | `integrations/opencode` + `.agents/skills` |
| Windsurf | Native MCP config + model-decision rule | `integrations/windsurf` |
| TRAE | Native MCP UI recipe + Agent Skill | `.agents/skills/titen-memory` |

The plugin names differ, but current repository artifacts target the same nine
server tools: `titen_project_resolve`, `titen_compile`, `titen_remember`,
`titen_consolidate`, `titen_feedback`, `titen_checkpoint_save`,
`titen_checkpoint_get`, `titen_lease_acquire`, and `titen_handoff`.

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

Install the verified public [Titen Memory skill](https://clawhub.ai/ramaaditya49/skills/titen-memory)
from ClawHub:

```bash
clawhub install titen-memory
clawhub skill verify titen-memory
```

The public `titen-memory@0.1.0` skill remains the verified earlier seven-tool
snapshot. Do not claim the current nine-tool skill is published until a new
ClawHub package passes the external inspector.

Merge only the `mcp.servers.titen` entry from
`integrations/openclaw/openclaw.json` into the OpenClaw config, then run:

```bash
openclaw gateway restart
openclaw mcp doctor titen --probe
```

OpenClaw stable loads the skill from a compatible bundle but currently imports
only stdio MCP servers from bundle `.mcp.json` files. The ClawHub artifact
therefore omits that Claude-only file and uses OpenClaw's native
`mcp.servers` Streamable HTTP configuration instead. No arbitrary in-process
plugin code is loaded. Its exposed tool names use
`titen__<canonical-name>`. See [OpenClaw bundles](https://docs.openclaw.ai/plugins/bundles)
and [native MCP configuration](https://docs.openclaw.ai/cli/mcp).

<!-- ponytail: the standalone ClawHub skill is the temporary public install surface while bundle publication is blocked by openclaw/clawhub#3327. The ceiling is a separate skill install plus native MCP config merge; publish the validated bundle from commit 1cc8823 and replace this path when the upstream inspector sandbox recovers. -->

The repository also contains the validated bundle-plugin package intended for
`openclaw plugins install clawhub:@ramaaditya49/titen-memory`. Its live package
publication remains blocked by the ClawHub inspector sandbox incident
[openclaw/clawhub#3327](https://github.com/openclaw/clawhub/issues/3327), even
though local validation and the exact merged-source dry-run pass with no
warnings. Until that incident is resolved, use the public skill plus the native
config above. ClawHub publishes standalone skills under its platform-wide
MIT-0 terms; the source repository and bundle package remain Apache-2.0.

## Cursor

Add `RamaAditya49/titen` as a GitHub-backed team/custom marketplace, install
**Titen Memory** in **Cursor Settings → Plugins**, then restart Cursor with the
two environment variables set. The plugin uses Cursor's documented
`${env:NAME}` interpolation in `mcp.json`; `/add-plugin titen-memory` installs it
after the marketplace is available. The format follows Cursor's
[official plugin specification](https://github.com/cursor/plugins).

## Hermes

From a Titen checkout, copy the plugin directory into the Hermes plugin root:

```bash
mkdir -p ~/.hermes/plugins
cp -R plugins/hermes/titen-memory ~/.hermes/plugins/titen-memory
hermes plugins enable titen-memory
```

Add this entry to `~/.hermes/config.yaml`, then run `hermes mcp test titen`:

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

The Python plugin registers the read-only skill only; Hermes' native
`mcp_servers` client owns the connection. It is not a Hermes memory-provider
replacement. See [Hermes plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)
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
verify that the nine tools appear. Windsurf expands `${env:NAME}` in remote MCP
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
- Public vendor-catalog review is separate from the repository marketplaces;
  ClawHub is the only public external registry publication in this release.
