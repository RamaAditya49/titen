import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const pluginRoot = join(root, "plugins/titen-memory");

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
  assert.match(skill, /Hermes, for\n  example, exposes `mcp_titen_<canonical-name>`/);
  assert.match(skill, /typed durable signals/);
  assert.match(skill, /Never store credentials or other secrets, raw transcripts or private\nconversations/);
  assert.match(skill, /chain of thought, prompts, embeddings, or routine command output/);
  assert.match(skill, /failed write must\nnever be reported as durable memory/);

  const tools = [...new Set(skill.match(/`titen_[a-z_]+`/g)?.map((name) => name.slice(1, -1)))].sort();
  assert.deepEqual(tools, [
    "titen_checkpoint_get",
    "titen_checkpoint_save",
    "titen_compile",
    "titen_feedback",
    "titen_handoff",
    "titen_lease_acquire",
    "titen_remember",
  ]);

  const pluginText = textFiles(pluginRoot).map((path) => readFileSync(path, "utf8")).join("\n");
  assert.doesNotMatch(pluginText, /titen_sk_[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(pluginText, /Authorization\s*[:=]\s*Bearer/i);
  assert.doesNotMatch(pluginText, /\$\{TITEN_URL\}|127\.0\.0\.1:\d+\/mcp/);
  assert.doesNotMatch(pluginText, /https?:\/\/[^\s"'`]+\/mcp\b/i);
});
