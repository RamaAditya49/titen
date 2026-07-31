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
      diagnostics.recordStderr(`Authorization: Bearer raw-token private-test-key ${"x".repeat(180)}`);
      throw failure;
    }),
    (error) => {
      assert.equal(error, failure);
      assert.equal((error as assert.AssertionError).actual, 10);
      assert.equal((error as assert.AssertionError).expected, 11);
      assert.match((error as Error).message, /expected exact product result/);
      assert.match((error as Error).message, /run=run-diagnostic-test phase=checkpoint contention/);
      assert.doesNotMatch((error as Error).message, /raw-token|private-test-key/);
      return true;
    },
  );
  assert.ok(Buffer.byteLength(emitted.join("")) <= 220);
  assert.doesNotMatch(emitted.join(""), /raw-token|private-test-key/);
});
