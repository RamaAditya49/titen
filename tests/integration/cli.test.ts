import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "titen-cli-"));
const cli = join(import.meta.dir, "../../src/runtime/bun/cli.ts");

afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(name: string, args: string[]) {
  const cwd = join(root, name);
  mkdirSync(cwd);
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
