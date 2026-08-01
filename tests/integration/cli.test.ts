import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { MIGRATIONS, SCHEMA_VERSION, schemaState } from "../../src/core/migrations";
import { fetchStableRelease, stableVersionStatus } from "../../src/runtime/bun/release";

const root = mkdtempSync(join(tmpdir(), "titen-cli-"));
const cli = join(import.meta.dir, "../../src/runtime/bun/cli.ts");
const version = (JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8")) as {
  version: string;
}).version;
const releasePreload = join(root, "release-preload.ts");
writeFileSync(releasePreload, `
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (String(input) === "https://titen.dev/version.json" && process.env.TITEN_TEST_RELEASE)
    return Promise.resolve(new Response(process.env.TITEN_TEST_RELEASE, { status: 200 }));
  return nativeFetch(input, init);
};
`);

afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(name: string, args: string[], release?: unknown) {
  const cwd = join(root, name);
  mkdirSync(cwd, { recursive: true });
  const result = Bun.spawnSync({
    cmd: release === undefined
      ? ["bun", cli, ...args]
      : ["bun", "--preload", releasePreload, cli, ...args],
    cwd,
    env: release === undefined
      ? undefined
      : { ...process.env, TITEN_TEST_RELEASE: JSON.stringify(release) },
  });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
    files: readdirSync(cwd),
  };
}

test("help is side-effect free for every documented command", () => {
  const cases = [
    ["top", ["--help"]],
    ["version", ["version", "--help"]],
    ["mcp", ["mcp", "--help"]],
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

test("version is exact and side-effect free", () => {
  const result = run("version", ["--version"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, `${version}\n`);
  assert.deepEqual(result.files, []);

  const command = run("version-command", ["version"]);
  assert.equal(command.exitCode, 0);
  assert.equal(command.output, `${version}\n`);
  assert.deepEqual(command.files, []);
});

test("version check validates and reports the stable CLI and plugin release", async () => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)!;
  const nextStable = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  const release = {
    schema: 1,
    channel: "stable",
    cli: { version: nextStable },
    plugin: { version: "0.2.0" },
  };
  const result = run("version-check", ["version", "--check"], release);
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(result.output, [
    `CLI installed: ${version}`,
    `CLI stable:    ${nextStable}`,
    "CLI status:    update available",
    "Plugin stable: 0.2.0",
    `Release notes: https://titen.dev/releases/${nextStable}`,
    "Install/update: https://titen.dev/docs/install",
    "",
  ].join("\n"));
  assert.deepEqual(result.files, []);

  const invalid = run("version-check-invalid", ["version", "--check"], {
    ...release,
    channel: "preview",
  });
  assert.notEqual(invalid.exitCode, 0);
  assert.match(invalid.output, /error: invalid stable release manifest/);
  assert.deepEqual(invalid.files, []);

  let requestInit: RequestInit | undefined;
  assert.deepEqual(
    await fetchStableRelease(async (_input, init) => {
      requestInit = init;
      return new Response(JSON.stringify(release));
    }),
    { cliVersion: nextStable, pluginVersion: "0.2.0" },
  );
  assert.equal(requestInit?.redirect, "error", "the fixed release URL must not follow redirects");

  const rejected = [
    [new Response("redirect", { status: 302 }), /release endpoint returned HTTP 302/],
    [new Response("unavailable", { status: 503 }), /release endpoint returned HTTP 503/],
    [new Response("{"), /release endpoint returned invalid JSON/],
    [new Response(JSON.stringify({ ...release, schema: 2 })), /invalid stable release manifest/],
    [new Response(JSON.stringify({ ...release, cli: { version: "v0.5.0" } })), /invalid stable release manifest/],
    [new Response(JSON.stringify({ ...release, plugin: { version: "latest" } })), /invalid stable release manifest/],
  ] as const;
  for (const [response, message] of rejected)
    await assert.rejects(fetchStableRelease(async () => response), message);

  assert.equal(stableVersionStatus("0.5.0", "0.5.0"), "current");
  assert.equal(stableVersionStatus("0.6.0", "0.5.0"), "ahead");
  assert.equal(stableVersionStatus("0.6.0-rc.1", "0.5.0"), "prerelease");
});

test("malformed flags fail before side effects for every command", () => {
  const cases = [
    ["serve", ["serve", "--port", "nope"]],
    ["mcp", ["mcp", "--api-key", "must-not-be-accepted"]],
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

test("bootstrap creates owner login with a one-time random password", () => {
  const boot = run("bootstrap-owner-login", ["bootstrap", "--db", "titen.db", "--org", "Example"]);
  assert.equal(boot.exitCode, 0, boot.output);
  assert.match(boot.output, /^dashboard_username: owner$/m);
  const temporary = /^temporary_password: ([A-Za-z0-9_-]{24})$/m.exec(boot.output)?.[1];
  assert.ok(temporary);
  assert.match(boot.output, /Change the temporary password on first dashboard sign-in\./);
  const database = openDatabase(join(root, "bootstrap-owner-login", "titen.db"), { create: false, readonly: true });
  try {
    const account = database.query(`SELECT a.username, a.password_verifier, a.must_change_password, m.role
      FROM operator_accounts a JOIN memberships m
        ON m.org_id = a.org_id AND m.principal_id = a.principal_id
      WHERE a.username = 'owner'`).get() as {
        username: string;
        password_verifier: string;
        must_change_password: number;
        role: string;
      };
    assert.equal(account.username, "owner");
    assert.equal(account.role, "owner");
    assert.equal(account.must_change_password, 1);
    assert.match(account.password_verifier, /^pbkdf2-sha256\$100000x6\$/);
    assert.ok(!account.password_verifier.includes(temporary));
  } finally {
    database.close();
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

test("key lifecycle flags survive listing and verified backup", async () => {
  const boot = run("key-lifecycle", ["bootstrap", "--db", "source.db"]);
  assert.equal(boot.exitCode, 0, boot.output);
  const orgId = /^organization: (org_[^ ]+)/m.exec(boot.output)?.[1];
  assert.ok(orgId);
  const notBefore = new Date(Date.now() + 86_400_000).toISOString();
  const expiresAt = new Date(Date.now() + 90_000_000).toISOString();
  const created = run("key-lifecycle", [
    "key", "create", "--db", "source.db", "--org-id", orgId,
    "--not-before", notBefore, "--expires-at", expiresAt,
  ]);
  assert.equal(created.exitCode, 0, created.output);
  const keyId = /^key_id: (key_[^\s]+)/m.exec(created.output)?.[1];
  assert.ok(keyId);
  const listed = run("key-lifecycle", ["key", "list", "--db", "source.db"]);
  assert.equal(listed.exitCode, 0, listed.output);
  assert.match(listed.output, new RegExp(`${keyId}  pending.*not_before=${notBefore}.*expires_at=${expiresAt}`));

  const expiredBefore = new Date(Date.now() - 7_200_000).toISOString();
  const expiredAt = new Date(Date.now() - 3_600_000).toISOString();
  const expired = run("key-lifecycle", [
    "key", "create", "--db", "source.db", "--org-id", orgId,
    "--not-before", expiredBefore, "--expires-at", expiredAt,
  ]);
  assert.equal(expired.exitCode, 0, expired.output);
  const expiredId = /^key_id: (key_[^\s]+)/m.exec(expired.output)?.[1];
  assert.ok(expiredId);
  const relisted = run("key-lifecycle", ["key", "list", "--db", "source.db"]);
  assert.match(relisted.output, new RegExp(`${expiredId}  expired`));

  const invalid = run("key-lifecycle", [
    "key", "create", "--db", "source.db", "--org-id", orgId,
    "--not-before", expiresAt, "--expires-at", notBefore,
  ]);
  assert.notEqual(invalid.exitCode, 0);
  assert.match(invalid.output, /--not-before must be earlier/u);

  const backup = run("key-lifecycle", [
    "backup", "--db", "source.db", "--out", "restored.db",
  ]);
  assert.equal(backup.exitCode, 0, backup.output);
  const handle = openDatabase(join(root, "key-lifecycle", "restored.db"), { create: false });
  try {
    const row = await createSqliteDb(handle).all<{
      not_before: string;
      expires_at: string;
      last_used_at: string | null;
    }>("SELECT not_before, expires_at, last_used_at FROM api_keys WHERE id = ?", [keyId]);
    assert.deepEqual(row, [{
      not_before: notBefore,
      expires_at: expiresAt,
      last_used_at: null,
    }]);
  } finally {
    handle.close();
  }
});

test("local key administration fails closed for missing organizations and keys", () => {
  const missingCases = [
    ["list", ["key", "list", "--db", "missing.db"]],
    ["revoke", ["key", "revoke", "--db", "missing.db", "--id", "key_missing"]],
    ["create", ["key", "create", "--db", "missing.db", "--org-id", "org_missing"]],
  ] as const;
  for (const [name, args] of missingCases) {
    const result = run(`key-missing-${name}`, [...args]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.output, /error: database does not exist: missing\.db/);
    assert.doesNotMatch(result.output, /SQLiteError|node_modules|src\/runtime|\n\s+at /);
    assert.deepEqual(result.files, []);
  }

  const boot = run("key-fail-closed", ["bootstrap", "--db", "keys.db"]);
  assert.equal(boot.exitCode, 0, boot.output);
  const ownerKey = /^key_id: (key_[^\s]+)/m.exec(boot.output)?.[1];
  assert.ok(ownerKey);
  const path = join(root, "key-fail-closed", "keys.db");
  const countKeys = () => {
    const database = openDatabase(path, { create: false, readonly: true });
    try {
      return Number((database.query("SELECT COUNT(*) AS count FROM api_keys").get() as { count: number }).count);
    } finally {
      database.close();
    }
  };

  const before = countKeys();
  const unknownOrganization = run("key-fail-closed", [
    "key", "create", "--db", "keys.db", "--org-id", "org_missing",
  ]);
  assert.notEqual(unknownOrganization.exitCode, 0);
  assert.equal(unknownOrganization.output, "error: organization not found: org_missing\n");
  assert.doesNotMatch(unknownOrganization.output, /api_key:|SQLiteError|\n\s+at /);
  assert.equal(countKeys(), before);

  const unknownKey = run("key-fail-closed", [
    "key", "revoke", "--db", "keys.db", "--id", "key_missing",
  ]);
  assert.notEqual(unknownKey.exitCode, 0);
  assert.equal(unknownKey.output, "error: key not found: key_missing\n");

  const revoked = run("key-fail-closed", [
    "key", "revoke", "--db", "keys.db", "--id", ownerKey,
  ]);
  assert.equal(revoked.exitCode, 0, revoked.output);
  assert.equal(revoked.output, `revoked ${ownerKey}\n`);

  const repeated = run("key-fail-closed", [
    "key", "revoke", "--db", "keys.db", "--id", ownerKey,
  ]);
  assert.notEqual(repeated.exitCode, 0);
  assert.equal(repeated.output, `error: key already revoked: ${ownerKey}\n`);
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

  assert.equal(run("backup-repeat", ["bootstrap", "--db", "source.db", "--org", "Second", "--username", "owner-second"]).exitCode, 0);
  const second = run("backup-repeat", ["backup", "--db", "source.db", "--out", "latest.db"]);
  assert.equal(second.exitCode, 0, second.output);
  assert.doesNotMatch(second.output, /SQLiteError|\n\s+at /);
  assert.equal(statSync(join(root, "backup-repeat", "latest.db")).mode & 0o777, 0o600);

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
  assert.match(fresh.output, new RegExp(`-- ${MIGRATIONS.length} migration\\(s\\) pending; database unchanged`));
  assert.deepEqual(fresh.files, []);

  assert.equal(run("dry-run-current", ["bootstrap", "--db", "current.db"]).exitCode, 0);
  const currentDirectory = join(root, "dry-run-current");
  const currentPath = join(currentDirectory, "current.db");
  chmodSync(currentPath, 0o400);
  const before = statSync(currentPath);
  chmodSync(currentDirectory, 0o500);
  let current: ReturnType<typeof run>;
  try {
    current = run("dry-run-current", ["migrate", "--db", "current.db", "--dry-run"]);
  } finally {
    chmodSync(currentDirectory, 0o700);
  }
  const after = statSync(currentPath);
  assert.equal(current.exitCode, 0, current.output);
  assert.match(current.output, /-- 0 migration\(s\) pending; database unchanged/);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.mode & 0o777, 0o400);

  const first = run("schema-deterministic", ["schema"]);
  const second = run("schema-deterministic", ["schema"]);
  assert.equal(first.output, second.output);
  assert.match(first.output, /INSERT OR IGNORE INTO titen_migrations/);
  assert.match(first.output, /1970-01-01T00:00:00\.000Z/);
});

test("serve reports a port collision without a stack trace", async () => {
  const blocker = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("busy"),
  });
  try {
    const result = run("busy-port", ["serve", "--port", String(blocker.port)]);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output, `error: port ${blocker.port} is already in use\n`);
    assert.doesNotMatch(result.output, /node_modules|src\/runtime|\bat\s/);
  } finally {
    await blocker.stop(true);
  }
});

test("serve --quiet accepts requests without startup or access output", async () => {
  const reservation = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("reserved"),
  });
  const port = reservation.port;
  await reservation.stop(true);

  const cwd = join(root, "quiet-serve");
  mkdirSync(cwd);
  const process = Bun.spawn({
    cmd: ["bun", cli, "serve", "--port", String(port), "--quiet"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    let response: Response | undefined;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/healthz`);
        if (response.ok) break;
      } catch {
        await Bun.sleep(25);
      }
    }
    assert.equal(response?.status, 200, "quiet server never became healthy");
  } finally {
    process.kill("SIGTERM");
    await process.exited;
  }
  const output = `${await new Response(process.stdout).text()}${await new Response(process.stderr).text()}`;
  assert.equal(output, "");
});
