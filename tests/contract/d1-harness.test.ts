import { test } from "bun:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
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

function diagnosticOwner(run_id: string): D1LaneOwner {
  return {
    run_id,
    pid: process.pid,
    worktree: "fixture",
    started_at: "2026-07-31T00:00:00.000Z",
  };
}

function diagnosticBody(output: string) {
  const marker = "workerd stderr (bounded):\n";
  const start = output.indexOf(marker);
  assert.notEqual(start, -1);
  return output.slice(start + marker.length).replace(/\n$/, "");
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
  const slash = "\\";
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
    {
      name: "quoted structural value",
      input: 'context-before {"access_token":"SENSITIVE_HEAD_9382 SPACE_SECRET_9382;SEMICOLON_SECRET_9382,COMMA_SECRET_9382}BRACE_SECRET_9382 and \\"QUOTE_SECRET_9382\\" tail","safe":"KEEP_SAFE_9382; still, }"} context-after',
      secrets: [],
      forbidden: [
        "SENSITIVE_HEAD_9382",
        "SPACE_SECRET_9382",
        "SEMICOLON_SECRET_9382",
        "COMMA_SECRET_9382",
        "BRACE_SECRET_9382",
        "QUOTE_SECRET_9382",
      ],
      expected: '"access_token":"[redacted]"',
      redacted: 'context-before {"access_token":"[redacted]","safe":"KEEP_SAFE_9382; still, }"} context-after',
    },
    {
      name: "single quoted structural value",
      input: "context-before client_secret='SENSITIVE_SINGLE_9382 SPACE_SINGLE_9382;SEMICOLON_SINGLE_9382,COMMA_SINGLE_9382}BRACE_SINGLE_9382 and \\'QUOTE_SINGLE_9382\\' tail' context-after",
      secrets: [],
      forbidden: [
        "SENSITIVE_SINGLE_9382",
        "SPACE_SINGLE_9382",
        "SEMICOLON_SINGLE_9382",
        "COMMA_SINGLE_9382",
        "BRACE_SINGLE_9382",
        "QUOTE_SINGLE_9382",
      ],
      expected: "client_secret='[redacted]'",
      redacted: "context-before client_secret='[redacted]' context-after",
    },
    {
      name: "quoted bearer structural value",
      input: 'context-before {"Authorization":"Bearer SENSITIVE_BEARER_9382 SPACE_BEARER_9382;SEMICOLON_BEARER_9382,COMMA_BEARER_9382}BRACE_BEARER_9382"} context-after',
      secrets: [],
      forbidden: [
        "SENSITIVE_BEARER_9382",
        "SPACE_BEARER_9382",
        "SEMICOLON_BEARER_9382",
        "COMMA_BEARER_9382",
        "BRACE_BEARER_9382",
      ],
      expected: '"Authorization":"[redacted]"',
      redacted: 'context-before {"Authorization":"[redacted]"} context-after',
    },
    {
      name: "escaped JSON structural value",
      input: String.raw`context-before \{\"token\":\"SENSITIVE_ESCAPED_9382 SPACE_ESCAPED_9382;SEMICOLON_ESCAPED_9382,COMMA_ESCAPED_9382}BRACE_ESCAPED_9382\",\"safe\":\"KEEP_ESCAPED_SAFE_9382; still, }\"\} context-after`,
      secrets: [],
      forbidden: [
        "SENSITIVE_ESCAPED_9382",
        "SPACE_ESCAPED_9382",
        "SEMICOLON_ESCAPED_9382",
        "COMMA_ESCAPED_9382",
        "BRACE_ESCAPED_9382",
      ],
      expected: String.raw`\"token\":\"[redacted]\"`,
      redacted: String.raw`context-before \{\"token\":\"[redacted]\",\"safe\":\"KEEP_ESCAPED_SAFE_9382; still, }\"\} context-after`,
    },
    {
      name: "escaped single quoted structural value",
      input: String.raw`context-before secret_key=\'SENSITIVE_ESINGLE_9382 SPACE_ESINGLE_9382;SEMICOLON_ESINGLE_9382,COMMA_ESINGLE_9382}BRACE_ESINGLE_9382\' context-after`,
      secrets: [],
      forbidden: [
        "SENSITIVE_ESINGLE_9382",
        "SPACE_ESINGLE_9382",
        "SEMICOLON_ESINGLE_9382",
        "COMMA_ESINGLE_9382",
        "BRACE_ESINGLE_9382",
      ],
      expected: String.raw`secret_key=\'[redacted]\'`,
      redacted: String.raw`context-before secret_key=\'[redacted]\' context-after`,
    },
    {
      name: "raw value with safe suffix",
      input: "context-before api_token=SENSITIVE_RAW_9382;safe-context-after",
      secrets: [],
      forbidden: ["SENSITIVE_RAW_9382"],
      expected: "api_token=[redacted]",
      redacted: "context-before api_token=[redacted];safe-context-after",
    },
    {
      name: "unterminated double quoted value",
      input: 'context-before token="SENSITIVE VALUE 9382',
      secrets: [],
      forbidden: ["SENSITIVE VALUE 9382"],
      expected: 'token="[redacted]',
      redacted: 'context-before token="[redacted]',
    },
    {
      name: "unterminated single quoted value",
      input: "context-before client_secret='SENSITIVE;SEMI_9382",
      secrets: [],
      forbidden: ["SENSITIVE;SEMI_9382"],
      expected: "client_secret='[redacted]",
      redacted: "context-before client_secret='[redacted]",
    },
    {
      name: "unterminated escaped JSON value",
      input: String.raw`context-before \{\"token\":\"SENSITIVE ESCAPED 9382`,
      secrets: [],
      forbidden: ["SENSITIVE ESCAPED 9382"],
      expected: String.raw`\"token\":\"[redacted]`,
      redacted: String.raw`context-before \{\"token\":\"[redacted]`,
    },
    {
      name: "mismatched quoted value",
      input: 'context-before access_token="SENSITIVE_MISMATCH_9382 VALUE_MISMATCH_9382;tail\'',
      secrets: [],
      forbidden: ["SENSITIVE_MISMATCH_9382", "VALUE_MISMATCH_9382"],
      expected: 'access_token="[redacted]',
      redacted: 'context-before access_token="[redacted]',
    },
    {
      name: "multiple assignments with unterminated tail",
      input: 'context-before token="COMPLETE_MULTI_9382" client_secret=\'UNTERMINATED_MULTI_9382 VALUE_MULTI_9382; api_token=TAIL_MULTI_9382',
      secrets: [],
      forbidden: ["COMPLETE_MULTI_9382", "UNTERMINATED_MULTI_9382", "VALUE_MULTI_9382", "TAIL_MULTI_9382"],
      expected: 'token="[redacted]" client_secret=\'[redacted]',
      redacted: 'context-before token="[redacted]" client_secret=\'[redacted]',
    },
    {
      name: "unterminated assignment before quoted assignment",
      input: 'context-before token="FIRST_MULTI_OPEN_9382 client_secret="SECOND_MULTI_9382" context-after',
      secrets: [],
      forbidden: ["FIRST_MULTI_OPEN_9382", "SECOND_MULTI_9382"],
      expected: 'token="[redacted]"',
      redacted: 'context-before token="[redacted]" context-after',
    },
    {
      name: "escaped outer JSON with escaped inner quotes",
      input: `context-before ${slash}{${slash}"token${slash}":${slash}"OUTER_SECRET_9382 ${slash.repeat(3)}"INNER_SECRET_9382${slash.repeat(3)}" TAIL_SECRET_9382${slash}"${slash}} context-after`,
      secrets: [],
      forbidden: ["OUTER_SECRET_9382", "INNER_SECRET_9382", "TAIL_SECRET_9382"],
      expected: `${slash}"token${slash}":${slash}"[redacted]${slash}"`,
      redacted: `context-before ${slash}{${slash}"token${slash}":${slash}"[redacted]${slash}"${slash}} context-after`,
    },
    {
      name: "escaped outer JSON with seven and five slash runs",
      input: `context-before ${slash}{${slash}"token${slash}":${slash}"RUN_HEAD_9382 ${slash.repeat(7)}"RUN_INNER_9382${slash.repeat(7)}" RUN_TAIL_9382${slash.repeat(5)}"${slash}} context-after`,
      secrets: [],
      forbidden: ["RUN_HEAD_9382", "RUN_INNER_9382", "RUN_TAIL_9382"],
      expected: `${slash}"token${slash}":${slash}"[redacted]${slash}"`,
      redacted: `context-before ${slash}{${slash}"token${slash}":${slash}"[redacted]${slash}"${slash}} context-after`,
    },
    {
      name: "plain quote with trailing literal backslash",
      input: `context-before token="TRAILING_BACKSLASH_SECRET_9382${slash.repeat(2)}" context-after`,
      secrets: [],
      forbidden: ["TRAILING_BACKSLASH_SECRET_9382"],
      expected: 'token="[redacted]"',
      redacted: 'context-before token="[redacted]" context-after',
    },
    {
      name: "prefixed environment API key",
      input: "context-before OPENAI_API_KEY=ENV_API_KEY_SECRET_9382 context-after",
      secrets: [],
      forbidden: ["ENV_API_KEY_SECRET_9382"],
      expected: "OPENAI_API_KEY=[redacted]",
    },
  ];

  for (const fixture of cases) {
    const expectedLine = "redacted" in fixture
      ? fixture.redacted
      : fixture.input
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

test("D1 diagnostics decode and redact raw stderr bytes at every byte split", async () => {
  const slash = "\\";
  const unicodeSecret = "秘密鍵_UNICODE_SECRET_9382";
  const cases = [
    {
      name: "unicode configured secret",
      input: `context-before configured=${unicodeSecret} context-after`,
      secrets: [unicodeSecret],
      forbidden: [unicodeSecret, "UNICODE_SECRET_9382"],
      expected: "context-before configured=[redacted] context-after",
    },
    {
      name: "folded authorization CRLF",
      input: "context-before\r\nAuthorization:\r\n Bearer FOLDED_CRLF_SECRET_9382\r\ncontext-after",
      secrets: [],
      forbidden: ["FOLDED_CRLF_SECRET_9382"],
      expected: "Authorization:\r\n [redacted]\r\ncontext-after",
    },
    {
      name: "folded authorization LF",
      input: "context-before\nAuthorization:\n\tBearer FOLDED_LF_SECRET_9382\ncontext-after",
      secrets: [],
      forbidden: ["FOLDED_LF_SECRET_9382"],
      expected: "Authorization:\n\t[redacted]\ncontext-after",
    },
    {
      name: "escaped structured token",
      input: `context-before ${slash}{${slash}"token${slash}":${slash}"BYTE_HEAD_9382 ${slash.repeat(3)}"BYTE_INNER_9382${slash.repeat(3)}" BYTE_TAIL_9382${slash}"${slash}} context-after`,
      secrets: [],
      forbidden: ["BYTE_HEAD_9382", "BYTE_INNER_9382", "BYTE_TAIL_9382"],
      expected: `context-before ${slash}{${slash}"token${slash}":${slash}"[redacted]${slash}"${slash}} context-after`,
    },
    {
      name: "compound credential key",
      input: "context-before access_token=BYTE_ACCESS_TOKEN_9382 context-after",
      secrets: [],
      forbidden: ["BYTE_ACCESS_TOKEN_9382"],
      expected: "context-before access_token=[redacted] context-after",
    },
  ];

  for (const fixture of cases) {
    const bytes = Buffer.from(fixture.input);
    for (let split = 0; split <= bytes.length; split++) {
      const emitted: string[] = [];
      const diagnostics = new D1RunDiagnostics(
        diagnosticOwner(`run-byte-${fixture.name.replaceAll(" ", "-")}-${split}`),
        fixture.secrets,
        512,
        (value) => emitted.push(value),
      );
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      diagnostics.handleRuntimeStdio(stdout, stderr);
      const failure = new Error(`controlled ${fixture.name}: ${fixture.input}`);

      await assert.rejects(
        diagnostics.run(fixture.name, async () => {
          const ended = once(stderr, "end");
          stderr.write(bytes.subarray(0, split));
          stderr.end(bytes.subarray(split));
          await ended;
          throw failure;
        }),
        (error) => {
          assert.equal(error, failure);
          const thrown = `${(error as Error).message}\n${(error as Error).stack}`;
          for (const forbidden of fixture.forbidden) {
            assert.ok(!thrown.includes(forbidden), `${fixture.name} error leaked at byte split ${split}`);
          }
          assert.ok(thrown.includes(fixture.expected));
          return true;
        },
      );
      stdout.destroy();
      const output = emitted.join("");
      for (const forbidden of fixture.forbidden) {
        assert.ok(!output.includes(forbidden), `${fixture.name} emission leaked at byte split ${split}`);
      }
      assert.ok(output.includes(fixture.expected));
      assert.ok(Buffer.byteLength(diagnosticBody(output)) <= 512);
    }
  }
});

test("D1 diagnostics fail closed after an oversized folded label", async () => {
  const secret = "OVERSIZED_FOLDED_SECRET_9382";
  const input = `Authorization:${" ".repeat(180)}\r\n Bearer ${secret}\r\ncontext-after`;
  const emitted: string[] = [];
  const diagnostics = new D1RunDiagnostics(
    diagnosticOwner("run-oversized-folded-label"),
    [],
    128,
    (value) => emitted.push(value),
  );
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  diagnostics.handleRuntimeStdio(stdout, stderr);
  const failure = new Error(`controlled oversized folded failure: ${input}`);

  await assert.rejects(
    diagnostics.run("oversized folded label", () => {
      stderr.write(Buffer.from(input));
      throw failure;
    }),
    (error) => {
      assert.equal(error, failure);
      const thrown = `${(error as Error).message}\n${(error as Error).stack}`;
      assert.ok(!thrown.includes(secret));
      assert.ok(thrown.includes(" [redacted]\r\ncontext-after"));
      return true;
    },
  );
  const output = emitted.join("");
  assert.ok(!output.includes(secret));
  assert.ok(output.includes("[redacted oversized stderr line]\n [redacted]\r\ncontext-after"));
  assert.ok(Buffer.byteLength(diagnosticBody(output)) <= 128);
  stdout.destroy();
  stderr.destroy();
});

test("D1 diagnostics retain Unicode decoder state across run boundaries", async () => {
  const secret = "秘密鍵_CROSS_RUN_SECRET_9382";
  const input = `context-before configured=${secret} context-after`;
  const bytes = Buffer.from(input);
  const split = Buffer.byteLength("context-before configured=") + 1;
  const emitted: string[] = [];
  const diagnostics = new D1RunDiagnostics(
    diagnosticOwner("run-cross-boundary-unicode"),
    [secret],
    256,
    (value) => emitted.push(value),
  );
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  diagnostics.handleRuntimeStdio(stdout, stderr);

  await diagnostics.run("successful prefix", () => {
    stderr.write(bytes.subarray(0, split));
  });
  const failure = new Error(`controlled cross-run failure: ${input}`);
  await assert.rejects(
    diagnostics.run("failing suffix", () => {
      stderr.write(bytes.subarray(split));
      throw failure;
    }),
    (error) => {
      assert.equal(error, failure);
      const thrown = `${(error as Error).message}\n${(error as Error).stack}`;
      assert.ok(!thrown.includes(secret));
      assert.ok(!thrown.includes("CROSS_RUN_SECRET_9382"));
      assert.ok(thrown.includes("context-before configured=[redacted] context-after"));
      return true;
    },
  );
  const output = emitted.join("");
  assert.ok(!output.includes(secret));
  assert.ok(!output.includes("CROSS_RUN_SECRET_9382"));
  assert.ok(output.includes("context-before configured=[redacted] context-after"));
  stdout.destroy();
  stderr.destroy();
});

test("D1 diagnostics keep folded and line state isolated per stderr stream", async () => {
  const foldedSecret = "INTERLEAVED_FOLDED_SECRET_9382";
  const tokenSecret = "INTERLEAVED_TOKEN_SECRET_9382";
  const emitted: string[] = [];
  const diagnostics = new D1RunDiagnostics(
    diagnosticOwner("run-interleaved-streams"),
    [],
    512,
    (value) => emitted.push(value),
  );
  const stdoutA = new PassThrough();
  const stderrA = new PassThrough();
  const stdoutB = new PassThrough();
  const stderrB = new PassThrough();
  diagnostics.handleRuntimeStdio(stdoutA, stderrA);
  diagnostics.handleRuntimeStdio(stdoutB, stderrB);
  const failure = new Error("controlled interleaved stream failure");

  await assert.rejects(
    diagnostics.run("interleaved streams", () => {
      stderrA.write("Authorization:\r\n");
      stderrB.write(`token=${tokenSecret}`);
      stderrA.write(` Bearer ${foldedSecret}\r\n`);
      stderrB.write(" context-after\n");
      throw failure;
    }),
    (error) => {
      assert.equal(error, failure);
      const thrown = `${(error as Error).message}\n${(error as Error).stack}`;
      assert.ok(!thrown.includes(foldedSecret));
      assert.ok(!thrown.includes(tokenSecret));
      assert.ok(thrown.includes("Authorization:\r\n [redacted]\r\ntoken=[redacted] context-after"));
      return true;
    },
  );
  const output = emitted.join("");
  assert.ok(!output.includes(foldedSecret));
  assert.ok(!output.includes(tokenSecret));
  assert.ok(output.includes("Authorization:\r\n [redacted]\r\ntoken=[redacted] context-after"));
  assert.ok(Buffer.byteLength(diagnosticBody(output)) <= 512);
  stdoutA.destroy();
  stderrA.destroy();
  stdoutB.destroy();
  stderrB.destroy();
});

test("D1 diagnostics preserve non-credential diagnostic controls", async () => {
  const controls = [
    "token_count=42",
    "secretary=available",
    "authorization_status=denied",
    "api_key_rotation_state=ready",
  ].join("\n");
  const emitted: string[] = [];
  const diagnostics = new D1RunDiagnostics(
    diagnosticOwner("run-safe-controls"),
    [],
    256,
    (value) => emitted.push(value),
  );
  const failure = new Error(`controlled safe control failure\n${controls}`);
  await assert.rejects(
    diagnostics.run("safe controls", () => {
      diagnostics.recordStderr(controls);
      throw failure;
    }),
    (error) => {
      assert.equal(error, failure);
      assert.ok((error as Error).message.includes(controls));
      return true;
    },
  );
  const output = emitted.join("");
  assert.ok(output.includes(controls));
  assert.ok(!output.includes("[redacted]"));
});

test("D1 diagnostics trim retained stderr on a valid UTF-8 boundary", async () => {
  for (let limit = 1; limit <= 21; limit++) {
    const emitted: string[] = [];
    const diagnostics = new D1RunDiagnostics(
      diagnosticOwner(`run-byte-limit-${limit}`),
      [],
      limit,
      (value) => emitted.push(value),
    );
    await assert.rejects(
      diagnostics.run("byte limit", () => {
        diagnostics.recordStderr("é\n".repeat(12));
        diagnostics.recordStderr("x");
        throw new Error("controlled byte limit failure");
      }),
    );
    const body = diagnosticBody(emitted.join(""));
    assert.ok(Buffer.byteLength(body) <= limit, `body exceeded ${limit} bytes`);
    assert.ok(!body.includes("�"));
  }
});
