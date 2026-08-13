import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApp } from "../../src/core/app";
import { migrate } from "../../src/core/migrations";
import { TitenClient } from "../../src/sdk";
import {
  SOURCE_IMPORT_PROFILE_IDS,
  SOURCE_IMPORT_PROFILES,
  applySourceImport,
  prepareSourceImport,
} from "../../src/runtime/bun/source-import";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { provisionWith } from "../contract/harness";

const root = mkdtempSync(join(tmpdir(), "titen-source-import-"));
const cli = join(import.meta.dir, "../../src/runtime/bun/cli.ts");

afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function json(path: string, value: unknown): string {
  return write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fixtures(): Record<(typeof SOURCE_IMPORT_PROFILE_IDS)[number], string> {
  const base = join(root, "profiles");
  return {
    "mem0-json@1": json(join(base, "mem0.json"), {
      results: [{
        id: "m1", memory: "The billing service uses idempotent webhooks.",
        created_at: "2026-08-01T10:00:00Z", subject_id: "source-controlled",
        project_id: "source/project", workspace_id: "source-workspace",
        trust: "verified", visibility: "organization",
      }],
    }),
    "openclaw-memory@1": (() => {
      const path = join(base, "openclaw");
      write(join(path, "USER.md"), "# User\n\nPrefers concise incident summaries.\n");
      write(join(path, "MEMORY.md"), "# Memory\n\nProduction deploys require a rollback smoke.\n");
      write(join(path, "memory", "2026-08-13-release.md"), "# Release\n\nVersion checks run before publication.\n");
      write(join(path, "memory", "imports", "ignored.md"), "Ignored generated import.\n");
      return path;
    })(),
    "hermes-memory@1": (() => {
      const path = join(base, "hermes");
      write(join(path, "MEMORY.md"), "# Runtime\n\nHermes keeps curated memory here.\n");
      write(join(path, "USER.md"), "# User\n\nThe user reviews migrations before apply.\n");
      return path;
    })(),
    "claude-code-memory@1": (() => {
      const path = join(base, "claude");
      write(join(path, "project.md"), "# Project\n\nUse the shared TypeScript core.\n");
      return path;
    })(),
    "codex-memory@1": (() => {
      const path = join(base, "codex");
      write(join(path, "MEMORY.md"), "# Durable\n\nRepository state is authoritative.\n");
      write(join(path, "memory_summary.md"), "# Summary\n\nManual release gates are required.\n");
      return path;
    })(),
    "gemini-cli-memory@1": (() => {
      const path = join(base, "gemini");
      write(join(path, "private.md"), "# Private memory\n\nThe operator prefers local-first tools.\n");
      write(join(path, "GEMINI.md"), "Rules belong to agent-rules.\n");
      write(join(path, "inbox", "draft.md"), "Unapproved draft.\n");
      return path;
    })(),
    "qwen-code-memory@1": (() => {
      const path = join(base, "qwen");
      write(join(path, "fact.md"), "# Fact\n\nThe API binds scope before search.\n");
      write(join(path, "MEMORY.md"), "Generated index.\n");
      write(join(path, "pinned", "release.md"), "# Pinned\n\nKeep stable releases reproducible.\n");
      return path;
    })(),
    "byterover-context@1": (() => {
      const path = join(base, "byterover");
      write(join(path, "service.md"), "# Service\n\nSQLite is the canonical local store.\n");
      write(join(path, "_index.md"), "Generated index.\n");
      write(join(path, "service.abstract.md"), "Generated abstract.\n");
      return path;
    })(),
    "amazon-q-memory@1": (() => {
      const path = join(base, "amazon-q");
      write(join(path, "product.md"), "# Product\n\nTiten stores evidence before inference.\n");
      write(join(path, "structure.md"), "# Structure\n\nOne shared core serves two runtimes.\n");
      write(join(path, "tech.md"), "# Tech\n\nBun uses SQLite.\n");
      write(join(path, "guidelines.md"), "# Guidelines\n\nRun the smallest relevant test.\n");
      return path;
    })(),
    "replit-memory@1": write(join(base, "replit.md"), "# Replit memory\n\nThe project uses a manual release flow.\n"),
    "honcho-conclusions@1": (() => {
      const path = join(base, "honcho");
      json(join(path, "page-1.json"), {
        items: [{
          id: "conclusion-1", content: "The support queue is checked every morning.",
          observer_id: "peer-a", observed_id: "peer-b", created_at: "2026-08-01T08:00:00Z",
          session_id: null, level: "explicit",
        }],
        total: 2, page: 1, size: 1, pages: 2,
      });
      json(join(path, "page-2.json"), {
        items: [{
          id: "conclusion-2", content: "Release notes cite the exact package version.",
          observer_id: "peer-a", observed_id: "peer-b", created_at: "2026-08-02T08:00:00Z",
          session_id: "session-1", level: "deductive",
        }],
        total: 2, page: 2, size: 1, pages: 2,
      });
      return path;
    })(),
    "letta-agentfile@1": json(join(base, "agent.af"), {
      agents: [{
        id: "agent-1", block_ids: ["block-1", "block-2"], secrets: null,
        tool_exec_environment_variables: {}, messages: [{ content: "ignored transcript" }],
      }],
      blocks: [
        { id: "block-1", label: "persona", value: "The operator values explicit rollback evidence.", description: "reviewed memory" },
        { id: "block-2", label: "project", value: "Titen keeps canonical SQL independent from vectors." },
        { id: "unused", label: "unused", value: "This unreferenced block is ignored." },
      ],
      tools: [{ source_code: "ignored" }],
    }),
    "memomind-json@1": json(join(base, "memomind.json"), {
      version: "1.0", format: "memomind-export",
      memories: [{ text: "The team prefers deterministic migration rehearsals.", date: "2026-08-03T09:00:00Z", tags: ["ignored"] }],
      graph: { nodes: [], edges: [] },
    }),
    "agent-rules@1": (() => {
      const path = join(base, "rules");
      write(join(path, "AGENTS.md"), "---\napplyTo: '**/*.ts'\n---\n# Verification\n\nRun focused tests before the full gate.\n\n@file missing-rules.md\n@include rules/*.md\n");
      write(join(path, ".cursor", "rules", "scope.mdc"), "# Scope\n\nNever infer organization from source content.\n");
      write(join(path, ".kiro", "steering", "scope.md"), "# Kiro\n\n#[[file:missing.txt]] stays inert.\n");
      write(join(path, ".augment", "rules", "component.mdx"), "# MDX\n\n<MissingComponent /> remains text.\n");
      write(join(path, "prompts", "ignored.md"), "Prompt, not a rule.\n");
      return path;
    })(),
    "basic-memory@1": (() => {
      const path = join(base, "basic");
      write(join(path, "notes", "architecture.md"), "---\ntitle: Architecture\n---\n# Architecture\n\n[[SQLite]] remains the source of truth.\n\n- relates_to [[Titen]]\n");
      write(join(path, ".hidden", "ignored.md"), "Hidden note.\n");
      return path;
    })(),
    "markdown@1": write(join(base, "memory.md"), "# Portable memory\n\nA plain reviewed file is the generic fallback.\n"),
  };
}

test("all sixteen profiles use four parser families and produce deterministic bounded previews", async () => {
  const sources = fixtures();
  const selected: Record<(typeof SOURCE_IMPORT_PROFILE_IDS)[number], string[]> = {
    "mem0-json@1": ["mem0.json"],
    "openclaw-memory@1": ["MEMORY.md", "USER.md", "memory/2026-08-13-release.md"],
    "hermes-memory@1": ["MEMORY.md", "USER.md"],
    "claude-code-memory@1": ["project.md"],
    "codex-memory@1": ["MEMORY.md", "memory_summary.md"],
    "gemini-cli-memory@1": ["private.md"],
    "qwen-code-memory@1": ["fact.md", "pinned/release.md"],
    "byterover-context@1": ["service.md"],
    "amazon-q-memory@1": ["guidelines.md", "product.md", "structure.md", "tech.md"],
    "replit-memory@1": ["replit.md"],
    "honcho-conclusions@1": ["page-1.json", "page-2.json"],
    "letta-agentfile@1": ["agent.af"],
    "memomind-json@1": ["memomind.json"],
    "agent-rules@1": [
      ".augment/rules/component.mdx", ".cursor/rules/scope.mdc",
      ".kiro/steering/scope.md", "AGENTS.md",
    ],
    "basic-memory@1": ["notes/architecture.md"],
    "markdown@1": ["memory.md"],
  };
  assert.equal(SOURCE_IMPORT_PROFILE_IDS.length, 16);
  assert.deepEqual(new Set(Object.values(SOURCE_IMPORT_PROFILES).map((profile) => profile.parser)),
    new Set(["markdown", "records", "honcho", "agentfile"]));

  for (const profile of SOURCE_IMPORT_PROFILE_IDS) {
    const options = { path: sources[profile], profile, subject: `subject-${profile}` };
    const first = await prepareSourceImport(options);
    const second = await prepareSourceImport(options);
    assert.deepEqual(first.preview, second.preview, `${profile} preview drifted`);
    const locators = first.preview.selected_files.map((file) => file.locator);
    assert.deepEqual(locators, locators.toSorted((left, right) => left.localeCompare(right)));
    assert.deepEqual(new Set(locators), new Set(selected[profile]), `${profile} selected the wrong files`);
    assert.ok(first.preview.entries > 0, `${profile} produced no entries`);
    assert.equal(first.preview.visibility, "private");
    assert.equal(first.preview.trust, "unverified");
    assert.equal(first.preview.entries, first.entries.length);
    assert.ok(first.entries.every((entry) => entry.content.length <= 4_000));
    assert.ok(first.entries.every((entry) => entry.sourceId.startsWith("imp_")));
    assert.ok(first.entries.every((entry) => entry.sourceRef.length <= 200));
  }

  const amazon = await prepareSourceImport({
    path: sources["amazon-q-memory@1"], profile: "amazon-q-memory@1", subject: "amazon",
  });
  assert.equal(amazon.entries.filter((entry) => entry.kind === "procedural").length, 1);
  const mapped = await prepareSourceImport({
    path: sources["mem0-json@1"], profile: "mem0-json@1", subject: "explicit-subject",
    project: "owner/project", workspaceId: "explicit-workspace",
    visibility: "organization", trust: "asserted",
  });
  assert.deepEqual({
    subject: mapped.preview.subject_id,
    project: mapped.preview.project_reference,
    workspace: mapped.preview.workspace_id,
    visibility: mapped.preview.visibility,
    trust: mapped.preview.trust,
  }, {
    subject: "explicit-subject", project: "owner/project", workspace: "explicit-workspace",
    visibility: "organization", trust: "asserted",
  });
  assert.equal(mapped.entries[0]!.content, "The billing service uses idempotent webhooks.");
  const rules = await prepareSourceImport({
    path: sources["agent-rules@1"], profile: "agent-rules@1", subject: "rules",
  });
  assert.ok(rules.entries.every((entry) => entry.kind === "procedural"));
  assert.ok(rules.entries.some((entry) => entry.content.includes("Source applicability metadata (inert)")));
  assert.ok(rules.entries.some((entry) => entry.content.includes("@file missing-rules.md")));
  assert.ok(rules.entries.some((entry) => entry.content.includes("#[[file:missing.txt]] stays inert")));
  assert.ok(rules.entries.some((entry) => entry.content.includes("<MissingComponent /> remains text")));
  const letta = await prepareSourceImport({
    path: sources["letta-agentfile@1"], profile: "letta-agentfile@1", subject: "letta",
  });
  assert.ok(letta.entries.every((entry) =>
    !entry.content.includes("ignored transcript")
    && !entry.content.includes("source_code")
    && !entry.content.includes("unreferenced block")));
  const memomind = await prepareSourceImport({
    path: sources["memomind-json@1"], profile: "memomind-json@1", subject: "memomind",
  });
  assert.ok(memomind.entries.every((entry) =>
    !entry.content.includes("ignored") && !entry.content.includes("nodes")));
});

test("source parsing rejects secrets, symlinks, unsafe text, oversized input, and incomplete structured exports", async () => {
  const failures = join(root, "failures");
  const secrets = [
    ["aws_access_key_id", `AKIA${"A".repeat(16)}`],
    ["private_key_block", "-----BEGIN PRIVATE KEY-----"],
    ["github_token", `ghp_${"A".repeat(36)}`],
    ["slack_token", `xoxb-${"A".repeat(12)}`],
    ["google_api_key", `AIza${"A".repeat(35)}`],
    ["openai_style_key", `sk-${"A".repeat(30)}`],
    ["jwt", `eyJ${"A".repeat(10)}.eyJ${"B".repeat(10)}.${"C".repeat(10)}`],
    ["url_basic_auth", "https://synthetic-user:synthetic-password@example.test"],
    ["assigned_credential", "password: synthetic-password"],
  ] as const;
  for (const [rule, value] of secrets) {
    const secret = write(join(failures, `secret-${rule}.md`), `Synthetic fixture: ${value}\n`);
    await assert.rejects(
      prepareSourceImport({ path: secret, profile: "markdown@1", subject: "secret" }),
      (error: Error) => error.message.includes(rule) && !error.message.includes(value),
    );
  }

  const source = write(join(failures, "real.md"), "Safe source.\n");
  const empty = write(join(failures, "empty.md"), "\n");
  await assert.rejects(prepareSourceImport({ path: empty, profile: "markdown@1", subject: "empty" }), /no memory entries/);
  const malformed = write(join(failures, "malformed.json"), "{\n");
  await assert.rejects(prepareSourceImport({ path: malformed, profile: "mem0-json@1", subject: "bad" }), /valid JSON/);
  const link = join(failures, "linked.md");
  symlinkSync(source, link);
  await assert.rejects(prepareSourceImport({ path: link, profile: "markdown@1", subject: "link" }), /symlink/);

  const unsafe = write(join(failures, "unsafe.md"), "safe\u202Eunsafe\n");
  await assert.rejects(prepareSourceImport({ path: unsafe, profile: "markdown@1", subject: "unsafe" }), /unsafe Unicode/);
  await assert.rejects(
    prepareSourceImport({ path: source, profile: "markdown@1", subject: "safe\u202Eunsafe" }),
    /--subject contains an unsafe Unicode control character/,
  );
  await assert.rejects(
    prepareSourceImport({ path: source, profile: "markdown@1", subject: "safe", trust: "verified" }),
    /--trust must be unverified or asserted/,
  );
  await assert.rejects(
    prepareSourceImport({ path: source, profile: "markdown@1", subject: "safe", visibility: "team" }),
    /--workspace-id is required/,
  );

  const oversized = join(failures, "oversized.md");
  write(oversized, "x");
  truncateSync(oversized, (64 * 1024 * 1024) + 1);
  await assert.rejects(prepareSourceImport({ path: oversized, profile: "markdown@1", subject: "large" }), /exceeds/);

  const badMem0 = json(join(failures, "bad-mem0.json"), { unknown: [] });
  await assert.rejects(prepareSourceImport({ path: badMem0, profile: "mem0-json@1", subject: "bad" }), /supported Mem0/);

  const badHoncho = join(failures, "honcho");
  json(join(badHoncho, "page.json"), { items: [], total: 2, page: 1, size: 1, pages: 2 });
  await assert.rejects(prepareSourceImport({ path: badHoncho, profile: "honcho-conclusions@1", subject: "bad" }), /exactly 2 page/);
  const duplicateHoncho = join(failures, "honcho-duplicate");
  for (const file of ["a.json", "b.json"])
    json(join(duplicateHoncho, file), {
      items: [{
        id: file, content: "Synthetic conclusion.", observer_id: "a", observed_id: "b",
        created_at: "2026-08-13T00:00:00Z", session_id: null, level: "explicit",
      }],
      total: 2, page: 1, size: 1, pages: 2,
    });
  await assert.rejects(
    prepareSourceImport({ path: duplicateHoncho, profile: "honcho-conclusions@1", subject: "bad" }),
    /complete contiguous set/,
  );

  const badAgent = json(join(failures, "bad.af"), {
    agents: [{ id: "agent", block_ids: ["missing"], secrets: null, tool_exec_environment_variables: {} }],
    blocks: [],
  });
  await assert.rejects(prepareSourceImport({ path: badAgent, profile: "letta-agentfile@1", subject: "bad" }), /dangling block/);
  const duplicateReferences = json(join(failures, "duplicate-references.af"), {
    agents: [{ id: "agent", block_ids: ["block", "block"], secrets: null, tool_exec_environment_variables: {} }],
    blocks: [{ id: "block", label: "memory", value: "Synthetic memory." }],
  });
  await assert.rejects(
    prepareSourceImport({ path: duplicateReferences, profile: "letta-agentfile@1", subject: "bad" }),
    /duplicate agent block references/,
  );

  const multipleAgents = json(join(failures, "multiple.af"), { agents: [{}, {}], blocks: [] });
  await assert.rejects(
    prepareSourceImport({ path: multipleAgents, profile: "letta-agentfile@1", subject: "bad" }),
    /exactly one agent/,
  );
  const populatedEnvironment = json(join(failures, "environment.af"), {
    agents: [{
      id: "agent", block_ids: [], secrets: null,
      tool_exec_environment_variables: { TOKEN: "configured" },
    }],
    blocks: [],
  });
  await assert.rejects(
    prepareSourceImport({ path: populatedEnvironment, profile: "letta-agentfile@1", subject: "bad" }),
    /populated tool execution environment variables/,
  );

  const badMemoMind = json(join(failures, "bad-memomind.json"), {
    version: "2.0", format: "memomind-export", memories: [],
  });
  await assert.rejects(
    prepareSourceImport({ path: badMemoMind, profile: "memomind-json@1", subject: "bad" }),
    /unsupported MemoMind version/,
  );
});

test("a partial apply reports its resume point and an exact rerun completes without duplicates", async () => {
  const directory = join(root, "partial-apply");
  mkdirSync(directory, { recursive: true });
  const source = json(join(directory, "mem0.json"), {
    memories: Array.from({ length: 51 }, (_, index) => ({
      id: `memory-${index}`,
      memory: `Imported durable fact ${index}.`,
    })),
  });
  const prepared = await prepareSourceImport({ path: source, profile: "mem0-json@1", subject: "partial" });
  const dbPath = join(directory, "titen.db");
  const handle = openDatabase(dbPath);
  const db = createSqliteDb(handle);
  await migrate(db);
  const principal = await provisionWith(db, { scopes: ["*"], maxTrust: "asserted" });
  let consolidationCalls = 0;
  let injectFailure = true;
  const app = createApp({ db, revision: "partial-source-import", runtime: "bun-sqlite" });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/v1/consolidations"
        && injectFailure && ++consolidationCalls === 2)
        return Response.json({ error: { code: "INJECTED", message: "injected failure" } }, { status: 503 });
      return app(request);
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  try {
    await assert.rejects(
      applySourceImport(prepared, { url, apiKey: principal.key }),
      /after 50 complete entries at .*record=memory-50/,
    );
    injectFailure = false;
    const resumed = await applySourceImport(prepared, { url, apiKey: principal.key });
    assert.deepEqual(resumed, {
      target: "served", database: null, endpoint: url, entries: 51,
      observations_created: 0, observations_replayed: 51,
      claims_created: 1, claims_replayed: 50,
    });
    const counts = await db.all<{ observations: number; claims: number }>(`SELECT
      (SELECT COUNT(*) FROM observations) AS observations,
      (SELECT COUNT(*) FROM claims) AS claims`);
    assert.deepEqual(counts[0], { observations: 51, claims: 51 });
  } finally {
    await server.stop(true);
    handle.close();
  }
});

test("CLI preview is target-free and local apply replays without duplicate observations or claims", async () => {
  const directory = join(root, "apply-local");
  mkdirSync(directory, { recursive: true });
  const source = write(join(directory, "source.md"), "# Release\n\nThe registry smoke installs the exact packed artifact.\n");
  const sourceBefore = readFileSync(source);
  const missingTarget = join(directory, "must-not-exist.db");
  const preview = Bun.spawnSync({
    cmd: ["bun", cli, "import-source", source, "--from", "markdown@1", "--subject", "release", "--db", missingTarget],
    cwd: directory,
    env: { ...process.env, TITEN_URL: "http://127.0.0.1:1", TITEN_API_KEY: "not-used" },
  });
  assert.equal(preview.exitCode, 0, preview.stderr.toString());
  assert.equal(JSON.parse(preview.stdout.toString()).meta.applied, false);
  assert.equal(existsSync(missingTarget), false);
  assert.deepEqual(readFileSync(source), sourceBefore);

  const dbPath = join(directory, "titen.db");
  const handle = openDatabase(dbPath);
  const db = createSqliteDb(handle);
  await migrate(db);
  const principal = await provisionWith(db, { scopes: ["*"], maxTrust: "asserted" });
  handle.close();

  const apply = () => Bun.spawnSync({
    cmd: [
      "bun", cli, "import-source", source, "--from", "markdown@1", "--subject", "release",
      "--db", dbPath, "--apply",
    ],
    cwd: directory,
    env: { ...process.env, TITEN_API_KEY: principal.key },
  });
  const first = apply();
  assert.equal(first.exitCode, 0, first.stderr.toString());
  assert.deepEqual(JSON.parse(first.stdout.toString()).data.apply, {
    target: "local", database: dbPath, endpoint: null, entries: 1,
    observations_created: 1, observations_replayed: 0, claims_created: 1, claims_replayed: 0,
  });
  const second = apply();
  assert.equal(second.exitCode, 0, second.stderr.toString());
  const replay = JSON.parse(second.stdout.toString()).data.apply;
  assert.equal(replay.observations_created, 0);
  assert.equal(replay.observations_replayed, 1);
  assert.equal(replay.claims_created, 0);
  assert.equal(replay.claims_replayed, 1);

  const verify = openDatabase(dbPath, { create: false, readonly: true });
  try {
    const counts = verify.query(`SELECT
      (SELECT COUNT(*) FROM observations) AS observations,
      (SELECT COUNT(*) FROM claims) AS claims,
      (SELECT COUNT(*) FROM claim_sources) AS sources,
      (SELECT COUNT(*) FROM record_history) AS history,
      (SELECT COUNT(*) FROM events) AS events`).get() as {
        observations: number; claims: number; sources: number; history: number; events: number;
      };
    assert.deepEqual(counts, { observations: 1, claims: 1, sources: 1, history: 2, events: 2 });
  } finally {
    verify.close();
  }
});

test("served apply uses the same handlers and imported evidence is recallable without vectors", async () => {
  const directory = join(root, "apply-served");
  mkdirSync(directory, { recursive: true });
  const dbPath = join(directory, "titen.db");
  const handle = openDatabase(dbPath);
  const db = createSqliteDb(handle);
  await migrate(db);
  const principal = await provisionWith(db, { scopes: ["*"], maxTrust: "asserted" });
  handle.close();
  const running = await serve({ dbPath, port: 0, hostname: "127.0.0.1", quiet: true, maintenanceIntervalMs: 0 });
  try {
    const source = json(join(directory, "mem0.json"), {
      memories: [{ id: "served-1", memory: "The served importer preserves evidence links." }],
    });
    const prepared = await prepareSourceImport({ path: source, profile: "mem0-json@1", subject: "served-import" });
    const applied = await applySourceImport(prepared, { url: running.url, apiKey: principal.key });
    assert.equal(applied.entries, 1);
    assert.equal(applied.claims_created, 1);

    const client = new TitenClient({ url: running.url, key: principal.key });
    const context = await client.compile({
      subject_id: "served-import",
      task: "served importer evidence links",
      max_tokens: 900,
    });
    assert.equal(context.items.length, 1);
    assert.equal(context.items[0]!.claim, "The served importer preserves evidence links.");
    assert.equal(context.items[0]!.evidence_ids.length, 1);
    assert.equal(context.budget.unconsolidated_observations, 0);
  } finally {
    await running.stop();
  }
});
