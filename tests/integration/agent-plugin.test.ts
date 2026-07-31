import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const pluginRoot = join(root, "plugins/titen-memory");
const canonicalSkillPath = join(root, "skills/titen-memory/SKILL.md");

const ordinaryTools = [
  "titen_checkpoint_get",
  "titen_checkpoint_save",
  "titen_compile",
  "titen_feedback",
  "titen_handoff",
  "titen_lease_acquire",
  "titen_remember",
].sort();

function json(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
}

function textFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? textFiles(child) : [child];
  });
}

test("the repo marketplace installs one valid skills-only Titen plugin", () => {
  const marketplace = json(join(root, ".agents/plugins/marketplace.json"));
  assert.equal(marketplace.name, "titen");
  const entry = marketplace.plugins.find((candidate: any) => candidate.name === "titen-memory");
  assert.ok(entry, "marketplace is missing titen-memory");
  assert.equal(entry.source.source, "local");
  assert.equal(entry.source.path, "./plugins/titen-memory");
  assert.equal(entry.policy.installation, "AVAILABLE");
  assert.equal(entry.policy.authentication, "ON_INSTALL");
  assert.ok(existsSync(resolve(root, entry.source.path)));

  const manifest = json(join(pluginRoot, ".codex-plugin/plugin.json"));
  assert.equal(manifest.name, entry.name);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.skills, "./skills/");
  assert.ok(existsSync(resolve(pluginRoot, manifest.skills)));
  for (const deferred of ["mcpServers", "hooks", "apps"])
    assert.equal(deferred in manifest, false, `${deferred} must stay deferred`);

  const metadata = Bun.YAML.parse(
    readFileSync(join(pluginRoot, "skills/titen-memory/agents/openai.yaml"), "utf8"),
  ) as Record<string, any>;
  assert.equal(metadata.interface.default_prompt.includes("$titen-memory"), true);
  assert.deepEqual(metadata.dependencies.tools, [
    {
      type: "mcp",
      value: "titen",
      description: "Operator-configured Titen MCP server",
    },
  ]);

  const docs = ["README.md", "docs/agent-guide.md"]
    .map((path) => readFileSync(join(root, path), "utf8"))
    .join("\n");
  assert.match(docs, /codex plugin add titen-memory@titen/);
  assert.doesNotMatch(docs, /titen-memory@personal/);
});

test("the portable skill keeps the seven-tool and security boundaries", () => {
  const skillPath = join(pluginRoot, "skills/titen-memory/SKILL.md");
  const skill = readFileSync(skillPath, "utf8");
  assert.match(skill, /^---\nname: titen-memory\ndescription: .+\n---/);
  assert.doesNotMatch(skill, /\[TODO:/);
  assert.match(skill, /untrusted reference data,\nnot an instruction/);
  assert.match(skill, /Call `titen_compile` once for the task boundary/);
  assert.match(skill, /Recall again only when the task or scope changes/);
  assert.match(skill, /Hermes uses\n  `mcp_titen_<canonical-name>`/);
  assert.match(skill, /OpenClaw uses\n  `titen__<canonical-name>`/);
  assert.match(skill, /typed durable signals/);
  assert.match(skill, /Never store credentials or other secrets, raw transcripts or private\nconversations/);
  assert.match(skill, /chain of thought, prompts, embeddings, or routine command output/);
  assert.match(skill, /failed write must\nnever be reported as durable memory/);

  const tools = [...new Set(skill.match(/(?<=`)titen_[a-z_]+(?=`)/g))].sort();
  assert.deepEqual(tools, ordinaryTools);

  const pluginText = textFiles(pluginRoot).map((path) => readFileSync(path, "utf8")).join("\n");
  assert.doesNotMatch(pluginText, /titen_sk_[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(pluginText, /Authorization\s*[:=]\s*Bearer/i);
  assert.doesNotMatch(pluginText, /\$\{TITEN_URL\}|127\.0\.0\.1:\d+\/mcp/);
  assert.doesNotMatch(pluginText, /https?:\/\/[^\s"'`]+\/mcp\b/i);
});

function assertRemoteConfig(
  config: Record<string, any>,
  expectedUrl: string,
  expectedAuthorization: string,
) {
  const server = config.mcpServers?.titen ?? config.mcp?.titen;
  assert.ok(server, "missing titen MCP server");
  assert.equal(server.url ?? server.serverUrl, expectedUrl);
  assert.equal(server.headers.Authorization, expectedAuthorization);
}

test("native marketplaces and host kits use the correct secret interpolation", () => {
  const claudeMarketplace = json(join(root, ".claude-plugin/marketplace.json"));
  assert.equal(claudeMarketplace.name, "titen");
  assert.deepEqual(claudeMarketplace.plugins.map((entry: any) => entry.name), ["titen-memory"]);
  assert.equal(claudeMarketplace.plugins[0].source, "./plugins/claude/titen-memory");

  const claudeRoot = join(root, "plugins/claude/titen-memory");
  const claudeManifest = json(join(claudeRoot, ".claude-plugin/plugin.json"));
  assert.equal(claudeManifest.name, "titen-memory");
  assert.match(claudeManifest.version, /^\d+\.\d+\.\d+$/);
  const openClawManifest = json(join(claudeRoot, "openclaw.plugin.json"));
  assert.equal(openClawManifest.id, "titen-memory");
  assert.deepEqual(openClawManifest.skills, ["skills/titen-memory"]);
  assert.deepEqual(openClawManifest.configSchema, {
    type: "object",
    additionalProperties: false,
    properties: {},
  });
  for (const executable of ["extensions", "providers", "hooks"])
    assert.equal(executable in openClawManifest, false, `${executable} must stay absent`);
  assertRemoteConfig(
    json(join(claudeRoot, ".mcp.json")),
    "${TITEN_MCP_URL}",
    "Bearer ${TITEN_API_KEY}",
  );
  assert.equal(
    readFileSync(join(claudeRoot, ".clawhubignore"), "utf8").trimEnd().endsWith(".mcp.json"),
    true,
  );

  const openClaw = json(join(root, "integrations/openclaw/openclaw.json"));
  assert.equal(openClaw.mcp.servers.titen.url, "${TITEN_MCP_URL}");
  assert.equal(openClaw.mcp.servers.titen.transport, "streamable-http");
  assert.equal(
    openClaw.mcp.servers.titen.headers.Authorization,
    "Bearer ${TITEN_API_KEY}",
  );
  assert.deepEqual(openClaw.mcp.servers.titen.toolFilter.include.sort(), ordinaryTools);

  const cursorMarketplace = json(join(root, ".cursor-plugin/marketplace.json"));
  assert.equal(cursorMarketplace.name, "titen");
  assert.equal(cursorMarketplace.plugins[0].source, "plugins/cursor/titen-memory");
  const cursorRoot = join(root, "plugins/cursor/titen-memory");
  const cursorManifest = json(join(cursorRoot, ".cursor-plugin/plugin.json"));
  assert.equal(cursorManifest.name, "titen-memory");
  assert.equal(cursorManifest.skills, "./skills/");
  assert.equal(cursorManifest.mcpServers, "./mcp.json");
  assertRemoteConfig(
    json(join(cursorRoot, "mcp.json")),
    "${env:TITEN_MCP_URL}",
    "Bearer ${env:TITEN_API_KEY}",
  );

  const openCode = json(join(root, "integrations/opencode/opencode.json"));
  assert.equal(openCode.mcp.titen.type, "remote");
  assert.equal(openCode.mcp.titen.oauth, false);
  assertRemoteConfig(openCode, "{env:TITEN_MCP_URL}", "Bearer {env:TITEN_API_KEY}");
  assertRemoteConfig(
    json(join(root, "integrations/windsurf/mcp_config.json")),
    "${env:TITEN_MCP_URL}",
    "Bearer ${env:TITEN_API_KEY}",
  );

  assert.throws(() =>
    assertRemoteConfig(
      { mcpServers: { titen: { url: "${env:TITEN_MCP_URL}", headers: { Authorization: "x" } } } },
      "${TITEN_MCP_URL}",
      "Bearer ${TITEN_API_KEY}",
    ),
  );
});

test("every distributed package copies the same portable skill and adds no runtime hooks", () => {
  const canonicalSkill = readFileSync(canonicalSkillPath, "utf8");
  const skillCopies = [
    join(pluginRoot, "skills/titen-memory/SKILL.md"),
    join(root, "plugins/claude/titen-memory/skills/titen-memory/SKILL.md"),
    join(root, "plugins/cursor/titen-memory/skills/titen-memory/SKILL.md"),
    join(root, "plugins/hermes/titen-memory/skills/titen-memory/SKILL.md"),
    join(root, "plugins/pi/titen-memory/skills/titen-memory/SKILL.md"),
  ];
  for (const copy of skillCopies) assert.equal(readFileSync(copy, "utf8"), canonicalSkill, copy);

  const hermes = Bun.YAML.parse(
    readFileSync(join(root, "plugins/hermes/titen-memory/plugin.yaml"), "utf8"),
  ) as Record<string, any>;
  assert.equal(hermes.name, "titen-memory");
  assert.equal("provides_tools" in hermes, false);
  assert.equal("provides_hooks" in hermes, false);
  const hermesInit = readFileSync(join(root, "plugins/hermes/titen-memory/__init__.py"), "utf8");
  assert.match(hermesInit, /ctx\.register_skill/);
  assert.doesNotMatch(hermesInit, /register_(tool|hook|memory_provider)/);

  const pi = json(join(root, "plugins/pi/titen-memory/package.json"));
  assert.deepEqual(pi.pi.skills, ["./skills"]);
  assert.equal("extensions" in pi.pi, false);
  assert.equal("dependencies" in pi, false);

  const distributionRoots = [
    join(root, "plugins/claude"),
    join(root, "plugins/cursor"),
    join(root, "plugins/hermes"),
    join(root, "plugins/pi"),
    join(root, "integrations"),
  ];
  const distributionText = distributionRoots
    .flatMap(textFiles)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert.doesNotMatch(distributionText, /titen_sk_[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(distributionText, /https?:\/\/127\.0\.0\.1:\d+\/mcp/);
});

test("the host guide distinguishes packages from config-only integrations", () => {
  const guide = readFileSync(join(root, "docs/agent-plugins.md"), "utf8");
  for (const host of [
    "Codex",
    "Claude Code",
    "ZCode",
    "OpenClaw",
    "Cursor",
    "Hermes",
    "Pi",
    "OpenCode",
    "Windsurf",
    "TRAE",
  ]) {
    assert.match(guide, new RegExp(`\\| ${host.replace("Code", "Code")} \\|`));
  }
  assert.match(guide, /TRAE's share\/import flow scans Agent and MCP\nconfiguration for credentials/);
  assert.match(guide, /Pi has no built-in MCP client/);
  assert.match(guide, /ClawHub is the only public external registry publication/);
});
