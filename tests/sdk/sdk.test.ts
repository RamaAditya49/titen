import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { TitenClient, TitenError } from "../../src/sdk";
import { provisionWith } from "../contract/harness";

/**
 * The published client, driven against a real server over real HTTP.
 *
 * The contract suite proves the service; this proves the client agrees with it.
 * Every method here is one an integrator calls, so a renamed response field or a
 * changed path breaks this file rather than someone's agent.
 */
const directory = mkdtempSync(join(tmpdir(), "titen-sdk-"));
const dbPath = join(directory, "titen.db");

let running: Awaited<ReturnType<typeof serve>>;
let handle: ReturnType<typeof openDatabase>;
let titen: TitenClient;

beforeAll(async () => {
  running = await serve({
    dbPath,
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    revision: "sdk-test",
  });
  handle = openDatabase(dbPath);
  const provisioned = await provisionWith(createSqliteDb(handle), { scopes: ["*"] });
  titen = new TitenClient({ url: running.url, key: provisioned.key });
});

afterAll(async () => {
  handle.close();
  await running.stop();
  rmSync(directory, { recursive: true, force: true });
});

test("health and readiness resolve through the client", async () => {
  const health = await titen.health();
  assert.equal(health.status, "ok");
  const ready = await titen.ready();
  assert.equal(ready.ready, true);
});

test("the client drives the whole Level 5 loop", async () => {
  const project = await titen.resolveProject("github.com/RamaAditya49/titen", true);
  assert.equal(project.reference, "ramaaditya49/titen");

  const observation = await titen.observe({
    subject_id: "user_sdk",
    project_id: project.project_id,
    kind: "tool_result",
    content: "Integration smoke returned 200 for the checkout rollback path.",
    source: { type: "tool", ref: "sdk#1" },
    trust: "verified",
  });
  assert.match(observation.observation_id, /^obs_/);

  const consolidated = await titen.consolidate(
    "user_sdk",
    [
      {
        kind: "procedural",
        statement: "Checkout rollback must be smoke tested before release.",
        confidence: 0.93,
        sources: [{ observation_id: observation.observation_id, relation: "supports" }],
      },
    ],
    project.project_id,
  );
  const claimId = consolidated.claims[0].claim_id as string;
  assert.match(claimId, /^claim_/);

  const context = await titen.compile({
    subject_id: "user_sdk",
    task: "checkout rollback smoke before release",
    max_tokens: 900,
  });
  assert.match(context.context_id, /^ctx_/);
  assert.ok(context.budget.used_tokens <= 900);
  assert.match(context.instructions, /untrusted reference data/i);
  const selected = context.items.find((item: any) => item.claim_id === claimId);
  assert.ok(selected, "the client must receive the claim it just wrote");

  const feedback = await titen.feedback(context.context_id, {
    outcome: "useful",
    claim_id: claimId,
  });
  assert.equal(feedback.outcome, "useful");

  const evidence = await titen.evidence(claimId);
  assert.equal(evidence.evidence.supporting.length, 1);
  assert.equal(
    evidence.evidence.supporting[0].observation_id,
    observation.observation_id,
  );
});

test("checkpoints round-trip through the client", async () => {
  const saved = await titen.saveCheckpoint({
    subject_id: "user_sdk",
    kind: "task_state",
    state: { step: 2, pending: ["verify"] },
    ttl_seconds: 600,
  });
  assert.match(saved.checkpoint_id, /^ckpt_/);

  const loaded = await titen.getCheckpoint("user_sdk", "task_state");
  assert.deepEqual(loaded.state, { step: 2, pending: ["verify"] });

  const removed = await titen.deleteCheckpoint(saved.checkpoint_id);
  assert.equal(removed.deleted, true);
});

test("claim lifecycle calls resolve through the client", async () => {
  const observation = await titen.observe({
    subject_id: "user_sdk_lifecycle",
    kind: "user_statement",
    content: "The old retry budget was three attempts.",
    source: { type: "chat" },
    trust: "verified",
  });
  const first = await titen.consolidate("user_sdk_lifecycle", [
    {
      kind: "procedural",
      statement: "Retry budget is three attempts.",
      sources: [{ observation_id: observation.observation_id, relation: "supports" }],
    },
  ]);
  const second = await titen.consolidate("user_sdk_lifecycle", [
    {
      kind: "procedural",
      statement: "Retry budget is two attempts, then escalate.",
      sources: [{ observation_id: observation.observation_id, relation: "supports" }],
    },
  ]);

  const superseded = await titen.supersede(
    first.claims[0].claim_id,
    second.claims[0].claim_id,
    "measured under load",
  );
  assert.equal(superseded.status, "superseded");

  const revoked = await titen.revoke(second.claims[0].claim_id, "policy change");
  assert.equal(revoked.status, "revoked");
});

test("key management round-trips and a scoped key is enforced", async () => {
  const created = await titen.createKey({
    label: "sdk-reader",
    scopes: ["context:compile"],
    max_trust: "asserted",
  });
  assert.match(created.api_key, /^titen_sk_/);

  const reader = new TitenClient({ url: running.url, key: created.api_key });
  const compiled = await reader.compile({
    subject_id: "user_sdk",
    task: "anything at all",
    max_tokens: 300,
  });
  assert.ok(compiled.context_id);

  // The client must surface a refusal as a typed error, not a silent result.
  await assert.rejects(
    () =>
      reader.observe({
        subject_id: "user_sdk",
        kind: "tool_result",
        content: "This write is not permitted for a compile-only key.",
        source: { type: "tool" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof TitenError, "the SDK must throw TitenError");
      assert.equal(error.status, 403);
      assert.equal(error.code, "FORBIDDEN");
      return true;
    },
  );

  const listed = await titen.listKeys();
  assert.ok(!JSON.stringify(listed).includes(created.api_key), "listing leaks no key");
  const revoked = await titen.revokeKey(created.key_id);
  assert.equal(revoked.revoked, true);

  await assert.rejects(
    () => reader.compile({ subject_id: "user_sdk", task: "after revocation", max_tokens: 300 }),
    (error: unknown) => (error as TitenError).status === 401,
  );
});

test("a validation failure arrives as a typed error", async () => {
  await assert.rejects(
    () =>
      titen.compile({ subject_id: "user_sdk", task: "budget too small", max_tokens: 4 }),
    (error: unknown) => {
      assert.ok(error instanceof TitenError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    },
  );
});
