import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { SCHEMA_VERSION, schemaState } from "../../src/core/migrations";

const root = mkdtempSync(join(tmpdir(), "titen-cli-"));
const cli = join(import.meta.dir, "../../src/runtime/bun/cli.ts");

afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(name: string, args: string[]) {
  const cwd = join(root, name);
  mkdirSync(cwd, { recursive: true });
  const result = Bun.spawnSync({ cmd: ["bun", cli, ...args], cwd });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
    files: readdirSync(cwd),
  };
}

test("help is side-effect free for every documented command", () => {
  const cases = [
    ["top", ["--help"]],
    ["serve", ["serve", "--help"]],
    ["migrate", ["migrate", "--help"]],
    ["bootstrap", ["bootstrap", "--help"]],
    ["key-create", ["key", "create", "--help"]],
    ["key-list", ["key", "list", "--help"]],
    ["key-revoke", ["key", "revoke", "--help"]],
    ["backup", ["backup", "--help"]],
    ["schema", ["schema", "--help"]],
  ] as const;

  for (const [name, args] of cases) {
    const result = run(`help-${name}`, [...args]);
    assert.equal(result.exitCode, 0, `${name} help must succeed: ${result.output}`);
    assert.match(result.output, /Usage:/);
    assert.doesNotMatch(result.output, /api_key:|titen listening/);
    assert.deepEqual(result.files, [], `${name} help created state`);
  }
});

test("malformed flags fail before side effects for every command", () => {
  const cases = [
    ["serve", ["serve", "--port", "nope"]],
    ["migrate", ["migrate", "--db"]],
    ["bootstrap", ["bootstrap", "--org"]],
    ["key-create", ["key", "create", "--org-id"]],
    ["key-list", ["key", "list", "--db"]],
    ["key-revoke", ["key", "revoke", "--id"]],
    ["backup", ["backup", "--out"]],
    ["schema", ["schema", "--unknown"]],
  ] as const;

  for (const [name, args] of cases) {
    const result = run(`invalid-${name}`, [...args]);
    assert.notEqual(result.exitCode, 0, `${name} malformed input unexpectedly succeeded`);
    assert.match(result.output, /error:/);
    assert.doesNotMatch(result.output, /api_key:|titen listening/);
    assert.deepEqual(result.files, [], `${name} malformed input created state`);
  }
});

test("port zero, non-decimal integers, and values outside the TCP range are rejected", () => {
  for (const value of ["0", "65536", "1.5", "1e3", "+80", "NaN"]) {
    const result = run(`port-${value.replace(".", "-")}`, ["serve", "--port", value]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.output, /--port must be an integer between 1 and 65535/);
    assert.deepEqual(result.files, []);
  }
});

test("backup refuses a missing source and atomically refreshes a fixed target", async () => {
  const missing = run("backup-missing", ["backup", "--db", "missing.db", "--out", "latest.db"]);
  assert.notEqual(missing.exitCode, 0);
  assert.match(missing.output, /error: database does not exist/);
  assert.doesNotMatch(missing.output, /SQLiteError|\n\s+at /);
  assert.deepEqual(missing.files, []);

  assert.equal(run("backup-repeat", ["bootstrap", "--db", "source.db", "--org", "First"]).exitCode, 0);
  const first = run("backup-repeat", ["backup", "--db", "source.db", "--out", "latest.db"]);
  assert.equal(first.exitCode, 0, first.output);
  assert.match(first.output, /backup verified:/);
  assert.equal(statSync(join(root, "backup-repeat", "latest.db")).mode & 0o777, 0o600);

  const sourcePath = join(root, "backup-repeat", "source.db");
  const source = openDatabase(sourcePath, { create: false });
  try {
    source.run(
      "INSERT INTO titen_migrations (version, applied_at) VALUES (?, ?)",
      SCHEMA_VERSION + 1,
      "2026-07-31T00:00:00.000Z",
    );
  } finally {
    source.close();
  }
  const failedRefresh = run("backup-repeat", ["backup", "--db", "source.db", "--out", "latest.db"]);
  assert.notEqual(failedRefresh.exitCode, 0);
  assert.match(failedRefresh.output, /error: backup failed: schema verification failed/);
  assert.doesNotMatch(failedRefresh.output, /SQLiteError|\n\s+at /);
  const preserved = openDatabase(join(root, "backup-repeat", "latest.db"), { create: false });
  try {
    assert.equal((preserved.query("SELECT COUNT(*) AS count FROM organizations").get() as { count: number }).count, 1);
  } finally {
    preserved.close();
  }
  const repaired = openDatabase(sourcePath, { create: false });
  try {
    repaired.run("DELETE FROM titen_migrations WHERE version = ?", SCHEMA_VERSION + 1);
  } finally {
    repaired.close();
  }

  assert.equal(run("backup-repeat", ["bootstrap", "--db", "source.db", "--org", "Second"]).exitCode, 0);
  const second = run("backup-repeat", ["backup", "--db", "source.db", "--out", "latest.db"]);
  assert.equal(second.exitCode, 0, second.output);
  assert.doesNotMatch(second.output, /SQLiteError|\n\s+at /);

  const copy = openDatabase(join(root, "backup-repeat", "latest.db"), { create: false });
  try {
    assert.equal((copy.query("SELECT COUNT(*) AS count FROM organizations").get() as { count: number }).count, 2);
    assert.deepEqual(await schemaState(createSqliteDb(copy)), {
      applied: SCHEMA_VERSION,
      expected: SCHEMA_VERSION,
      verified: true,
    });
    assert.equal((copy.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
  } finally {
    copy.close();
  }
  assert.ok(!readdirSync(join(root, "backup-repeat")).some((name) => name.includes(".tmp-")));
});

test("migrate dry-run is read-only and schema output is deterministic", () => {
  const fresh = run("dry-run-fresh", ["migrate", "--db", "missing.db", "--dry-run"]);
  assert.equal(fresh.exitCode, 0, fresh.output);
  assert.match(fresh.output, /-- migration 1/);
  assert.match(fresh.output, new RegExp(`-- ${SCHEMA_VERSION} migration\\(s\\) pending; database unchanged`));
  assert.deepEqual(fresh.files, []);

  assert.equal(run("dry-run-current", ["bootstrap", "--db", "current.db"]).exitCode, 0);
  const before = statSync(join(root, "dry-run-current", "current.db"));
  const current = run("dry-run-current", ["migrate", "--db", "current.db", "--dry-run"]);
  const after = statSync(join(root, "dry-run-current", "current.db"));
  assert.equal(current.exitCode, 0, current.output);
  assert.match(current.output, /-- 0 migration\(s\) pending; database unchanged/);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);

  const first = run("schema-deterministic", ["schema"]);
  const second = run("schema-deterministic", ["schema"]);
  assert.equal(first.output, second.output);
  assert.match(first.output, /INSERT OR IGNORE INTO titen_migrations/);
  assert.match(first.output, /1970-01-01T00:00:00\.000Z/);
});
