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
      diagnostics.recordStderr(`${"x".repeat(180)}\n`);
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

test("D1 diagnostics redact sensitive stderr at every chunk split", async () => {
  const cases = [
    {
      name: "configured secret",
      input: "context-before configured=SENSITIVE_CONFIGURED_9382 context-after",
      secrets: ["SENSITIVE_CONFIGURED_9382"],
      forbidden: ["SENSITIVE_CONFIGURED_9382"],
      expected: "configured=[redacted]",
    },
    {
      name: "overlapping configured secrets",
      input: "context-before configured=ABCDEF_OVERLAP_9382 context-after",
      secrets: ["ABC", "ABCDEF_OVERLAP_9382", "ABCDEF_OVERLAP_9382"],
      forbidden: ["ABCDEF_OVERLAP_9382", "DEF_OVERLAP_9382"],
      expected: "configured=[redacted]",
    },
    {
      name: "bearer token",
      input: "context-before Authorization: Bearer SENSITIVE_BEARER_9382 context-after",
      secrets: [],
      forbidden: ["SENSITIVE_BEARER_9382"],
      expected: "Authorization: [redacted]",
    },
    {
      name: "API key assignment",
      input: "context-before api_key=SENSITIVE_API_KEY_9382 context-after",
      secrets: [],
      forbidden: ["SENSITIVE_API_KEY_9382"],
      expected: "api_key=[redacted]",
    },
    {
      name: "token assignment",
      input: "context-before token: SENSITIVE_TOKEN_9382 context-after",
      secrets: [],
      forbidden: ["SENSITIVE_TOKEN_9382"],
      expected: "token: [redacted]",
    },
    {
      name: "secret assignment",
      input: "context-before secret = SENSITIVE_SECRET_9382 context-after",
      secrets: [],
      forbidden: ["SENSITIVE_SECRET_9382"],
      expected: "secret = [redacted]",
    },
    {
      name: "JSON bearer token",
      input: 'context-before {"Authorization":"Bearer SENSITIVE_JSON_BEARER_9382"} context-after',
      secrets: [],
      forbidden: ["SENSITIVE_JSON_BEARER_9382"],
      expected: '"Authorization":"[redacted]"',
    },
    {
      name: "JSON API key",
      input: 'context-before {"api_key":"SENSITIVE_JSON_API_KEY_9382"} context-after',
      secrets: [],
      forbidden: ["SENSITIVE_JSON_API_KEY_9382"],
      expected: '"api_key":"[redacted]"',
    },
    {
      name: "JSON token",
      input: 'context-before {"token":"SENSITIVE_JSON_TOKEN_9382"} context-after',
      secrets: [],
      forbidden: ["SENSITIVE_JSON_TOKEN_9382"],
      expected: '"token":"[redacted]"',
    },
    {
      name: "JSON secret",
      input: 'context-before {"secret":"SENSITIVE_JSON_SECRET_9382"} context-after',
      secrets: [],
      forbidden: ["SENSITIVE_JSON_SECRET_9382"],
      expected: '"secret":"[redacted]"',
    },
    {
      name: "access token assignment",
      input: "context-before access_token=SENSITIVE_ACCESS_TOKEN_9382 context-after",
      secrets: [],
      forbidden: ["SENSITIVE_ACCESS_TOKEN_9382"],
      expected: "access_token=[redacted]",
    },
    {
      name: "client secret assignment",
      input: "context-before client_secret=SENSITIVE_CLIENT_SECRET_9382 context-after",
      secrets: [],
      forbidden: ["SENSITIVE_CLIENT_SECRET_9382"],
      expected: "client_secret=[redacted]",
    },
    {
      name: "API token assignment",
      input: "context-before api_token=SENSITIVE_API_TOKEN_9382 context-after",
      secrets: [],
      forbidden: ["SENSITIVE_API_TOKEN_9382"],
      expected: "api_token=[redacted]",
    },
    {
      name: "secret key assignment",
      input: "context-before secret_key=SENSITIVE_SECRET_KEY_9382 context-after",
      secrets: [],
      forbidden: ["SENSITIVE_SECRET_KEY_9382"],
      expected: "secret_key=[redacted]",
    },
    {
      name: "escaped JSON token",
      input: 'context-before \\{\\"token\\":\\"SENSITIVE_ESCAPED_JSON_TOKEN_9382\\"\\} context-after',
      secrets: [],
      forbidden: ["SENSITIVE_ESCAPED_JSON_TOKEN_9382"],
      expected: '\\"token\\":\\"[redacted]\\"',
    },
  ];

  for (const fixture of cases) {
    const expectedLine = fixture.input
      .replace(fixture.forbidden[0], "[redacted]")
      .replace("Bearer [redacted]", "[redacted]");
    for (let split = 0; split <= fixture.input.length; split++) {
      const owner: D1LaneOwner = {
        run_id: `run-${fixture.name.replaceAll(" ", "-")}-${split}`,
        pid: process.pid,
        worktree: "fixture",
        started_at: "2026-07-31T00:00:00.000Z",
      };
      const emitted: string[] = [];
      const diagnostics = new D1RunDiagnostics(owner, fixture.secrets, 256, (value) => emitted.push(value));
      const failure = new Error(
        `controlled ${fixture.name} failure at split ${split}: ${fixture.input}`,
      );

      await assert.rejects(
        diagnostics.run(fixture.name, () => {
          diagnostics.recordStderr(fixture.input.slice(0, split));
          diagnostics.recordStderr(fixture.input.slice(split));
          throw failure;
        }),
        (error) => {
          assert.equal(error, failure);
          const thrown = `${(error as Error).message}\n${(error as Error).stack}`;
          for (const forbidden of fixture.forbidden) {
            assert.doesNotMatch(thrown, new RegExp(forbidden), `${fixture.name} leaked at split ${split}`);
          }
          assert.ok(thrown.includes(fixture.expected), `${fixture.name} was not redacted at split ${split}`);
          assert.ok(thrown.includes(expectedLine), `${fixture.name} lost context at split ${split}`);
          return true;
        },
      );
      const output = emitted.join("");
      for (const forbidden of fixture.forbidden) {
        assert.doesNotMatch(output, new RegExp(forbidden), `${fixture.name} emission leaked at split ${split}`);
      }
      assert.ok(output.includes(fixture.expected), `${fixture.name} emission was not redacted at split ${split}`);
      assert.ok(output.includes(expectedLine), `${fixture.name} emission lost context at split ${split}`);
      assert.ok(Buffer.byteLength(output) <= 512);
    }
  }
});
