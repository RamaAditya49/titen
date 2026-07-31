import { test } from "bun:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { acquireD1Lane, D1RunDiagnostics, type D1LaneOwner } from "./d1-harness";

async function runLaneProbe(port: number) {
  const moduleUrl = pathToFileURL(`${process.cwd()}/tests/contract/d1-harness.ts`).href;
  const script = `
    import { acquireD1Lane } from ${JSON.stringify(moduleUrl)};
    try {
      const lane = await acquireD1Lane(${port});
      console.log("acquired", lane.owner.run_id);
      await lane.release();
    } catch (error) {
      console.error(error.code, error.message);
      process.exitCode = 73;
    }
  `;
  const child = Bun.spawn({
    cmd: [process.execPath, "-e", script],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test("D1 host lane rejects an overlapping process without disturbing its owner", async () => {
  const owner = await acquireD1Lane(0);
  try {
    const contender = await runLaneProbe(owner.port);
    assert.equal(contender.exitCode, 73);
    assert.equal(contender.stdout, "");
    assert.match(contender.stderr, /TITEN_D1_LANE_BUSY/);
    assert.match(contender.stderr, new RegExp(owner.owner.run_id));
    assert.match(contender.stderr, new RegExp(`pid=${process.pid}`));
    assert.match(contender.stderr, new RegExp(`worktree=${owner.owner.worktree}`));
  } finally {
    await owner.release();
  }

  const successor = await runLaneProbe(owner.port);
  assert.equal(successor.exitCode, 0);
  assert.match(successor.stdout, /^acquired [0-9a-f-]+/);
  assert.equal(successor.stderr, "");
});

test("D1 diagnostics retain the original assertion and only bounded redacted stderr", async () => {
  const owner: D1LaneOwner = {
    run_id: "run-diagnostic-test",
    pid: process.pid,
    worktree: "fixture",
    started_at: "2026-07-31T00:00:00.000Z",
  };
  const emitted: string[] = [];
  const diagnostics = new D1RunDiagnostics(owner, ["private-test-key"], 96, (value) => emitted.push(value));
  const failure = new assert.AssertionError({
    message: "expected exact product result",
    actual: 10,
    expected: 11,
    operator: "strictEqual",
  });

  await assert.rejects(
    diagnostics.run("checkpoint contention", async () => {
      diagnostics.recordStderr("x".repeat(180));
      diagnostics.recordStderr("private-");
      diagnostics.recordStderr("test-key Authoriza");
      diagnostics.recordStderr("tion: Bearer raw-auth-");
      diagnostics.recordStderr("token");
      throw failure;
    }),
    (error) => {
      assert.equal(error, failure);
      assert.equal((error as assert.AssertionError).actual, 10);
      assert.equal((error as assert.AssertionError).expected, 11);
      assert.match((error as Error).message, /expected exact product result/);
      assert.match((error as Error).message, /run=run-diagnostic-test phase=checkpoint contention/);
      assert.doesNotMatch(`${(error as Error).message}\n${(error as Error).stack}`, /raw-auth-token|private-test-key/);
      return true;
    },
  );
  const output = emitted.join("");
  assert.ok(Buffer.byteLength(output) <= 220);
  assert.match(output, /\[redacted\]/);
  assert.doesNotMatch(output, /raw-auth-token|private-test-key/);
});

test("D1 diagnostics hold an incomplete bearer prefix until the token chunk arrives", async () => {
  const owner: D1LaneOwner = {
    run_id: "run-bearer-boundary-test",
    pid: process.pid,
    worktree: "fixture",
    started_at: "2026-07-31T00:00:00.000Z",
  };
  const emitted: string[] = [];
  const diagnostics = new D1RunDiagnostics(owner, [], 128, (value) => emitted.push(value));
  const failure = new Error("controlled bearer boundary failure");

  await assert.rejects(
    diagnostics.run("bearer boundary", () => {
      diagnostics.recordStderr("Authorization: Bearer ");
      diagnostics.recordStderr("SENSITIVE_BEARER_9382");
      throw failure;
    }),
    (error) => {
      assert.equal(error, failure);
      assert.match((error as Error).message, /Authorization: \[redacted\]/);
      assert.doesNotMatch(`${(error as Error).message}\n${(error as Error).stack}`, /SENSITIVE_BEARER_9382/);
      return true;
    },
  );
  const output = emitted.join("");
  assert.match(output, /Authorization: \[redacted\]/);
  assert.doesNotMatch(output, /SENSITIVE_BEARER_9382/);
});
