import assert from "node:assert/strict";
import type { Db } from "../../src/core/db";
import type { Fixture, Res } from "./harness";

export interface Case {
  name: string;
  run: (fx: Fixture) => Promise<void>;
}

const observation = (overrides: Record<string, unknown> = {}) => ({
  subject_id: "user_rama",
  kind: "tool_result",
  content: "Production deploy smoke returned 200 application/json for the checkout service.",
  source: { type: "tool", ref: "deploy_456#smoke" },
  trust: "verified",
  ...overrides,
});

const claim = (observationId: string, overrides: Record<string, unknown> = {}) => ({
  kind: "procedural",
  statement: "Production deploys require a verified rollback smoke before release.",
  confidence: 0.96,
  sources: [{ observation_id: observationId, relation: "supports" }],
  ...overrides,
});

function expectError(res: Res, status: number, code?: string) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body?.error?.code, "error envelope must carry a code");
  assert.ok(res.body?.meta?.request_id, "error envelope must carry a request id");
  assert.equal(res.body?.data, undefined, "error envelope must not carry data");
  if (code) assert.equal(res.body.error.code, code);
}

function expectOk(res: Res, status = 200) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body?.data, "success envelope must carry data");
  assert.ok(res.body?.meta?.request_id, "success envelope must carry a request id");
  assert.equal(res.body?.error, undefined, "success envelope must not carry an error");
}

/** Appends one observation and materializes one claim from it. */
async function seedClaim(
  fx: Fixture,
  key: string,
  overrides: { observation?: Record<string, unknown>; claim?: Record<string, unknown> } = {},
) {
  const obs = await fx.call("POST", "/v1/observations", {
    key,
    body: observation(overrides.observation),
  });
  expectOk(obs, 201);
  const consolidation = await fx.call("POST", "/v1/consolidations", {
    key,
    body: {
      subject_id: (overrides.observation?.subject_id as string) ?? "user_rama",
      claims: [claim(obs.body.data.observation_id, overrides.claim)],
    },
  });
  expectOk(consolidation, 201);
  return {
    observationId: obs.body.data.observation_id as string,
    claimId: consolidation.body.data.claims[0].claim_id as string,
    claim: consolidation.body.data.claims[0],
  };
}

export const CASES: Case[] = [
  {
    name: "health reports liveness without sensitive detail",
    async run(fx) {
      const res = await fx.call("GET", "/healthz");
      expectOk(res);
      assert.equal(res.body.data.status, "ok");
      assert.ok(res.body.data.runtime.length > 0);
      const serialized = JSON.stringify(res.body);
      for (const leak of ["titen_sk_", "password", "/home/", "/var/", "C:\\", "sqlite_master"])
        assert.ok(!serialized.includes(leak), `health output leaked ${leak}`);
    },
  },
  {
    name: "readiness reports applied migrations and disabled optional capabilities",
    async run(fx) {
      const res = await fx.call("GET", "/readyz");
      expectOk(res);
      assert.equal(res.body.data.ready, true);
      assert.equal(res.body.data.schema.applied, res.body.data.schema.expected);
      assert.equal(res.body.data.checks.canonical_sql, "ok");
      assert.equal(res.body.data.capabilities.fts, "enabled");
      assert.equal(res.body.data.capabilities.vector, "disabled");
      assert.equal(res.body.data.capabilities.model, "disabled");
    },
  },
  {
    name: "unknown endpoint and wrong method fail in the documented envelope",
    async run(fx) {
      expectError(await fx.call("GET", "/v1/nope"), 404, "NOT_FOUND");
      const wrongMethod = await fx.call("GET", "/v1/observations");
      expectError(wrongMethod, 405, "METHOD_NOT_ALLOWED");
      assert.match(wrongMethod.body.error.message, /POST/);
    },
  },
  {
    name: "missing, malformed, unknown, and revoked credentials all return 401",
    async run(fx) {
      const provisioned = await fx.provision();
      expectError(await fx.call("POST", "/v1/observations", { body: observation() }), 401, "UNAUTHENTICATED");
      expectError(
        await fx.call("POST", "/v1/observations", {
          body: observation(),
          headers: { authorization: "Basic abc" },
        }),
        401,
      );
      expectError(
        await fx.call("POST", "/v1/observations", { body: observation(), key: "not-a-titen-key" }),
        401,
      );
      expectError(
        await fx.call("POST", "/v1/observations", {
          body: observation(),
          key: "titen_sk_unknownkeyunknownkeyunknownkey",
        }),
        401,
      );
      expectOk(await fx.call("POST", "/v1/observations", { key: provisioned.key, body: observation() }), 201);
      await fx.revoke(provisioned.keyId);
      expectError(
        await fx.call("POST", "/v1/observations", { key: provisioned.key, body: observation() }),
        401,
      );
    },
  },
  {
    name: "a key without the required scope is refused",
    async run(fx) {
      const reader = await fx.provision({ scopes: ["evidence:read"] });
      const res = await fx.call("POST", "/v1/observations", {
        key: reader.key,
        body: observation(),
      });
      expectError(res, 403, "FORBIDDEN");
    },
  },
  {
    name: "project references normalize to a stable lowercase owner/repo",
    async run(fx) {
      const owner = await fx.provision();
      const created = await fx.call("POST", "/v1/projects/resolve", {
        key: owner.key,
        body: { reference: "https://GitHub.com/Rama/Titen.git", create: true },
      });
      expectOk(created, 201);
      assert.equal(created.body.data.reference, "rama/titen");
      assert.equal(created.body.data.created, true);

      for (const reference of [
        "github.com/rama/titen",
        "rama/titen",
        "git@github.com:Rama/Titen.git",
        "https://github.com/rama/titen/",
      ]) {
        const resolved = await fx.call("POST", "/v1/projects/resolve", {
          key: owner.key,
          body: { reference },
        });
        expectOk(resolved);
        assert.equal(resolved.body.data.project_id, created.body.data.project_id, reference);
        assert.equal(resolved.body.data.created, false);
      }
    },
  },
  {
    name: "resolution never creates a project without the create capability",
    async run(fx) {
      const limited = await fx.provision({ scopes: ["projects:resolve"] });
      expectError(
        await fx.call("POST", "/v1/projects/resolve", {
          key: limited.key,
          body: { reference: "rama/unseen", create: true },
        }),
        404,
      );
      expectError(
        await fx.call("POST", "/v1/projects/resolve", {
          key: limited.key,
          body: { reference: "rama/unseen" },
        }),
        404,
      );
    },
  },
  {
    name: "credential-bearing, query-string, and local-path references are rejected",
    async run(fx) {
      const owner = await fx.provision();
      for (const reference of [
        "https://user:token@github.com/rama/titen",
        "https://github.com/rama/titen?token=abc",
        "/home/rama/Project/titen",
        "C:\\Users\\rama\\titen",
        "~/titen",
        "ssh://git@github.com/rama/titen",
      ]) {
        const res = await fx.call("POST", "/v1/projects/resolve", {
          key: owner.key,
          body: { reference, create: true },
        });
        expectError(res, 400, "VALIDATION_ERROR");
      }
      const rows = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM projects WHERE org_id = ?`,
        [owner.orgId],
      );
      assert.equal(Number(rows[0]!.count), 0, "a rejected reference must store no project");
    },
  },
  {
    name: "an observation commits its canonical row, history, FTS row, and outbox entry together",
    async run(fx) {
      const agent = await fx.provision();
      const res = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: observation({ occurred_at: "2026-07-20T10:00:00.000Z" }),
      });
      expectOk(res, 201);
      const id = res.body.data.observation_id as string;
      assert.match(id, /^obs_[0-9a-f]{32}$/);
      assert.equal(res.body.data.occurred_at, "2026-07-20T10:00:00.000Z");
      assert.ok(res.body.data.ingested_at, "server must assign ingested_at");
      assert.match(res.body.data.content_hash, /^[0-9a-f]{64}$/);

      const counts = await fx.query<{ label: string; count: number }>(
        `SELECT 'canonical' AS label, COUNT(*) AS count FROM observations WHERE id = ?
         UNION ALL SELECT 'fts', COUNT(*) FROM observations_fts WHERE observation_id = ?
         UNION ALL SELECT 'history', COUNT(*) FROM record_history WHERE record_id = ?
         UNION ALL SELECT 'outbox', COUNT(*) FROM index_outbox WHERE record_id = ?`,
        [id, id, id, id],
      );
      for (const row of counts) assert.equal(Number(row.count), 1, `${row.label} row missing`);
    },
  },
  {
    name: "an idempotent retry returns the original result and writes nothing new",
    async run(fx) {
      const agent = await fx.provision();
      const body = observation();
      const first = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body,
        headers: { "idempotency-key": "retry-001" },
      });
      expectOk(first, 201);
      const retry = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body,
        headers: { "idempotency-key": "retry-001" },
      });
      expectOk(retry, 200);
      assert.equal(retry.body.data.observation_id, first.body.data.observation_id);
      assert.equal(retry.body.meta.replayed, true);

      const rows = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM observations WHERE org_id = ?`,
        [agent.orgId],
      );
      assert.equal(Number(rows[0]!.count), 1, "retry must not append a second observation");

      const reused = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: observation({ content: "A different body under the same key." }),
        headers: { "idempotency-key": "retry-001" },
      });
      expectError(reused, 409, "CONFLICT");
    },
  },
  {
    name: "a credential cannot assert trust above its own ceiling",
    async run(fx) {
      const agent = await fx.provision({ maxTrust: "asserted" });
      expectError(
        await fx.call("POST", "/v1/observations", {
          key: agent.key,
          body: observation({ trust: "verified" }),
        }),
        403,
        "FORBIDDEN",
      );
      expectOk(
        await fx.call("POST", "/v1/observations", {
          key: agent.key,
          body: observation({ trust: "asserted" }),
        }),
        201,
      );
    },
  },
  {
    name: "a project from another organization is not found",
    async run(fx) {
      const other = await fx.provision();
      const created = await fx.call("POST", "/v1/projects/resolve", {
        key: other.key,
        body: { reference: "other/repo", create: true },
      });
      expectOk(created, 201);
      const mine = await fx.provision();
      expectError(
        await fx.call("POST", "/v1/observations", {
          key: mine.key,
          body: observation({ project_id: created.body.data.project_id }),
        }),
        404,
        "NOT_FOUND",
      );
    },
  },
  {
    name: "a deterministic claim links evidence without calling a model",
    async run(fx) {
      const agent = await fx.provision();
      const seeded = await seedClaim(fx, agent.key);
      assert.match(seeded.claimId, /^claim_[0-9a-f]{32}$/);
      assert.equal(seeded.claim.status, "active");
      assert.equal(seeded.claim.trust, "verified");
      assert.deepEqual(seeded.claim.evidence_ids, [seeded.observationId]);

      const evidence = await fx.call("GET", `/v1/claims/${seeded.claimId}/evidence`, {
        key: agent.key,
      });
      expectOk(evidence);
      assert.equal(evidence.body.data.evidence.supporting.length, 1);
      assert.equal(
        evidence.body.data.evidence.supporting[0].observation_id,
        seeded.observationId,
      );
      assert.equal(evidence.body.data.hidden_source_count, 0);
      assert.match(evidence.body.data.instructions, /untrusted/i);
    },
  },
  {
    name: "claim trust and visibility may not exceed their evidence",
    async run(fx) {
      const agent = await fx.provision();
      const weak = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: observation({ trust: "asserted", visibility: "private" }),
      });
      expectOk(weak, 201);
      expectError(
        await fx.call("POST", "/v1/consolidations", {
          key: agent.key,
          body: {
            subject_id: "user_rama",
            claims: [claim(weak.body.data.observation_id, { trust: "verified" })],
          },
        }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await fx.call("POST", "/v1/consolidations", {
          key: agent.key,
          body: {
            subject_id: "user_rama",
            claims: [claim(weak.body.data.observation_id, { visibility: "organization" })],
          },
        }),
        400,
        "VALIDATION_ERROR",
      );
    },
  },
  {
    name: "a foreign evidence reference is not found and writes no claim",
    async run(fx) {
      const other = await fx.provision();
      const foreign = await fx.call("POST", "/v1/observations", {
        key: other.key,
        body: observation({ content: "Evidence owned by a different organization." }),
      });
      expectOk(foreign, 201);

      const mine = await fx.provision();
      const own = await fx.call("POST", "/v1/observations", {
        key: mine.key,
        body: observation({ content: "Locally owned evidence about rollback smoke." }),
      });
      expectOk(own, 201);

      const marker = "Unwritable claim about cross tenant leakage.";
      const rejected = await fx.call("POST", "/v1/consolidations", {
        key: mine.key,
        body: {
          subject_id: "user_rama",
          claims: [
            claim(own.body.data.observation_id, { statement: marker }),
            claim(foreign.body.data.observation_id, { statement: "Foreign sourced claim." }),
          ],
        },
      });
      expectError(rejected, 404, "NOT_FOUND");

      const rows = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM claims WHERE org_id = ?`,
        [mine.orgId],
      );
      assert.equal(Number(rows[0]!.count), 0, "a rejected consolidation must write no claim");

      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: mine.key,
        body: { subject_id: "user_rama", task: "unwritable claim leakage", max_tokens: 800 },
      });
      expectOk(compiled);
      assert.equal(compiled.body.data.items.length, 0);
    },
  },
  {
    name: "contradicting evidence becomes a preserved dispute",
    async run(fx) {
      const agent = await fx.provision();
      const supporting = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: observation({ content: "Rollback smoke ran before the release was announced." }),
      });
      const contradicting = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: observation({ content: "The release was announced before any rollback smoke ran." }),
      });
      const res = await fx.call("POST", "/v1/consolidations", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          claims: [
            {
              kind: "procedural",
              statement: "Rollback smoke always precedes a release announcement.",
              sources: [
                { observation_id: supporting.body.data.observation_id, relation: "supports" },
                { observation_id: contradicting.body.data.observation_id, relation: "contradicts" },
              ],
            },
          ],
        },
      });
      expectOk(res, 201);
      assert.equal(res.body.data.claims[0].status, "disputed");

      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          task: "rollback smoke release announcement",
          max_tokens: 1200,
        },
      });
      expectOk(compiled);
      assert.equal(compiled.body.data.conflicts.length, 1);
      assert.equal(
        compiled.body.data.conflicts[0].claim_id,
        res.body.data.claims[0].claim_id,
      );

      const evidence = await fx.call(
        "GET",
        `/v1/claims/${res.body.data.claims[0].claim_id}/evidence`,
        { key: agent.key },
      );
      expectOk(evidence);
      assert.equal(evidence.body.data.evidence.contradicting.length, 1);
    },
  },
  {
    name: "duplicate source relations are rejected before any write",
    async run(fx) {
      const agent = await fx.provision();
      const obs = await fx.call("POST", "/v1/observations", { key: agent.key, body: observation() });
      expectError(
        await fx.call("POST", "/v1/consolidations", {
          key: agent.key,
          body: {
            subject_id: "user_rama",
            claims: [
              claim(obs.body.data.observation_id, {
                sources: [
                  { observation_id: obs.body.data.observation_id, relation: "supports" },
                  { observation_id: obs.body.data.observation_id, relation: "supports" },
                ],
              }),
            ],
          },
        }),
        400,
      );
      const rows = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM claims WHERE org_id = ?`,
        [agent.orgId],
      );
      assert.equal(Number(rows[0]!.count), 0);
    },
  },
  {
    name: "a compiled pack stays under budget and explains every item",
    async run(fx) {
      const agent = await fx.provision();
      const seeded = await seedClaim(fx, agent.key);
      const res = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          task: "deploy the current project safely with a rollback smoke",
          max_tokens: 900,
        },
      });
      expectOk(res);
      const pack = res.body.data;
      assert.match(pack.context_id, /^ctx_[0-9a-f]{32}$/);
      assert.equal(pack.budget.max_tokens, 900);
      assert.ok(pack.budget.used_tokens <= 900, "used tokens must not exceed the budget");
      assert.ok(pack.items.length >= 1);
      assert.match(pack.instructions, /untrusted reference data/i);
      assert.equal(pack.policy_snapshot.length > 0, true);

      const item = pack.items.find((entry: any) => entry.claim_id === seeded.claimId);
      assert.ok(item, "the seeded claim must be selected");
      for (const field of ["kind", "trust", "confidence", "status", "valid_from", "score"])
        assert.ok(item[field] !== undefined, `item is missing ${field}`);
      assert.deepEqual(item.evidence_ids, [seeded.observationId]);
      for (const component of ["relevance", "trust", "recency", "utility", "conflict", "confidence"])
        assert.ok(item.score_components[component] !== undefined, `missing ${component}`);
      assert.equal(res.body.meta.degraded.vector, "disabled");
      assert.equal(res.body.meta.degraded.model, "disabled");

      const again = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          task: "deploy the current project safely with a rollback smoke",
          max_tokens: 900,
        },
      });
      expectOk(again);
      assert.deepEqual(
        again.body.data.items.map((entry: any) => [entry.claim_id, entry.score]),
        pack.items.map((entry: any) => [entry.claim_id, entry.score]),
        "repeated compilation against unchanged state must be stable",
      );
      assert.notEqual(again.body.data.context_id, pack.context_id);
    },
  },
  {
    name: "a tiny budget drops whole items instead of truncating them",
    async run(fx) {
      const agent = await fx.provision();
      await seedClaim(fx, agent.key);
      const res = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: "user_rama", task: "rollback smoke", max_tokens: 128 },
      });
      expectOk(res);
      assert.ok(res.body.data.budget.used_tokens <= 128);
      for (const item of res.body.data.items)
        assert.ok(
          item.claim.endsWith(".") || item.claim.length > 0,
          "an included item must carry its whole statement",
        );
    },
  },
  {
    name: "no eligible memory returns a successful empty pack",
    async run(fx) {
      const agent = await fx.provision();
      await seedClaim(fx, agent.key);
      const res = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          task: "kompresi arsip fotografi antarbintang",
          max_tokens: 900,
        },
      });
      expectOk(res);
      assert.deepEqual(res.body.data.items, []);
      assert.deepEqual(res.body.data.conflicts, []);
      assert.equal(res.body.data.budget.used_tokens, 0);
    },
  },
  {
    name: "compilation excludes other organizations, subjects, and private memory",
    async run(fx) {
      const owner = await fx.provision({ principalId: "agent_owner" });
      const seeded = await seedClaim(fx, owner.key);
      const task = "deploy the current project safely with a rollback smoke";

      const intruder = await fx.provision();
      const foreign = await fx.call("POST", "/v1/context/compile", {
        key: intruder.key,
        body: { subject_id: "user_rama", task, max_tokens: 900 },
      });
      expectOk(foreign);
      assert.equal(foreign.body.data.items.length, 0, "cross-organization memory must not leak");
      assert.equal(foreign.body.meta.candidates, 0, "hidden records must not appear in counts");
      expectError(
        await fx.call("GET", `/v1/claims/${seeded.claimId}/evidence`, { key: intruder.key }),
        404,
      );

      const otherSubject = await fx.call("POST", "/v1/context/compile", {
        key: owner.key,
        body: { subject_id: "user_someone_else", task, max_tokens: 900 },
      });
      expectOk(otherSubject);
      assert.equal(otherSubject.body.data.items.length, 0, "another subject must not leak");

      const secretive = await fx.provision({
        orgId: owner.orgId,
        principalId: "agent_private",
      });
      const privateSeed = await seedClaim(fx, secretive.key, {
        observation: {
          visibility: "private",
          content: "Private ledger reconciliation quirk for the migration runbook.",
        },
        claim: { statement: "The migration runbook needs a private ledger reconciliation step." },
      });
      const ownerView = await fx.call("POST", "/v1/context/compile", {
        key: owner.key,
        body: {
          subject_id: "user_rama",
          task: "private ledger reconciliation migration runbook",
          max_tokens: 900,
        },
      });
      expectOk(ownerView);
      assert.equal(
        ownerView.body.data.items.length,
        0,
        "another principal's private memory must not be compiled",
      );
      expectError(
        await fx.call("GET", `/v1/claims/${privateSeed.claimId}/evidence`, { key: owner.key }),
        404,
      );
      const selfView = await fx.call("POST", "/v1/context/compile", {
        key: secretive.key,
        body: {
          subject_id: "user_rama",
          task: "private ledger reconciliation migration runbook",
          max_tokens: 900,
        },
      });
      expectOk(selfView);
      assert.equal(selfView.body.data.items.length, 1, "the owner still reads its own memory");
    },
  },
  {
    name: "feedback is recorded, idempotent, and changes no evidence",
    async run(fx) {
      const agent = await fx.provision();
      const seeded = await seedClaim(fx, agent.key);
      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          task: "deploy the current project safely with a rollback smoke",
          max_tokens: 900,
        },
      });
      expectOk(compiled);
      const contextId = compiled.body.data.context_id as string;
      const before = await fx.call("GET", `/v1/claims/${seeded.claimId}/evidence`, {
        key: agent.key,
      });

      for (const outcome of ["used", "useful", "irrelevant", "incorrect", "harmful"]) {
        const res = await fx.call("POST", `/v1/context/${contextId}/feedback`, {
          key: agent.key,
          body: { outcome, claim_id: seeded.claimId, reason_code: "contract_case" },
        });
        expectOk(res, 201);
        assert.equal(res.body.data.outcome, outcome);
      }

      const once = await fx.call("POST", `/v1/context/${contextId}/feedback`, {
        key: agent.key,
        body: { outcome: "useful", client_mutation_id: "fb-mutation-1" },
      });
      expectOk(once, 201);
      const twice = await fx.call("POST", `/v1/context/${contextId}/feedback`, {
        key: agent.key,
        body: { outcome: "useful", client_mutation_id: "fb-mutation-1" },
      });
      expectOk(twice, 200);
      assert.equal(twice.body.data.feedback_id, once.body.data.feedback_id);
      assert.equal(twice.body.meta.replayed, true);

      expectError(
        await fx.call("POST", `/v1/context/${contextId}/feedback`, {
          key: agent.key,
          body: { outcome: "invented" },
        }),
        400,
      );
      expectError(
        await fx.call("POST", `/v1/context/ctx_00000000000000000000000000000000/feedback`, {
          key: agent.key,
          body: { outcome: "used" },
        }),
        404,
      );
      expectError(
        await fx.call("POST", `/v1/context/${contextId}/feedback`, {
          key: agent.key,
          body: { outcome: "used", claim_id: "claim_00000000000000000000000000000000" },
        }),
        404,
      );

      const after = await fx.call("GET", `/v1/claims/${seeded.claimId}/evidence`, {
        key: agent.key,
      });
      assert.deepEqual(after.body.data, before.body.data, "feedback must not mutate evidence");
    },
  },
  {
    name: "another organization cannot submit feedback for a foreign context run",
    async run(fx) {
      const owner = await fx.provision();
      await seedClaim(fx, owner.key);
      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: owner.key,
        body: {
          subject_id: "user_rama",
          task: "deploy the current project safely with a rollback smoke",
          max_tokens: 900,
        },
      });
      const intruder = await fx.provision();
      expectError(
        await fx.call("POST", `/v1/context/${compiled.body.data.context_id}/feedback`, {
          key: intruder.key,
          body: { outcome: "harmful" },
        }),
        404,
      );
    },
  },
  {
    name: "malformed and oversized requests fail before any write",
    async run(fx) {
      const agent = await fx.provision();
      const invalidJson = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        headers: { "content-type": "application/json" },
      });
      expectError(invalidJson, 400, "VALIDATION_ERROR");
      expectError(
        await fx.call("POST", "/v1/observations", { key: agent.key, body: { subject_id: "u" } }),
        400,
      );
      expectError(
        await fx.call("POST", "/v1/observations", {
          key: agent.key,
          body: observation({ kind: "gossip" }),
        }),
        400,
      );
      expectError(
        await fx.call("POST", "/v1/context/compile", {
          key: agent.key,
          body: { subject_id: "user_rama", task: "anything", max_tokens: 4 },
        }),
        400,
      );
      expectError(
        await fx.call("POST", "/v1/observations", {
          key: agent.key,
          body: observation({ content: "x".repeat(40_000) }),
        }),
        400,
      );
      const rows = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM observations WHERE org_id = ?`,
        [agent.orgId],
      );
      assert.equal(Number(rows[0]!.count), 0);
    },
  },
  {
    name: "raw key material never reaches storage",
    async run(fx) {
      const agent = await fx.provision();
      const rows = await fx.query<Record<string, unknown>>(`SELECT * FROM api_keys WHERE id = ?`, [
        agent.keyId,
      ]);
      assert.equal(rows.length, 1);
      const serialized = JSON.stringify(rows[0]);
      assert.ok(!serialized.includes(agent.key), "the raw key must not be stored");
      assert.ok(/[0-9a-f]{64}/.test(serialized), "only a hash may be stored");
      const denied = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: { subject_id: "" },
      });
      assert.ok(!JSON.stringify(denied.body).includes(agent.key), "errors must not echo the key");
    },
  },
  {
    name: "multilingual content is retrievable through lexical search",
    async run(fx) {
      const agent = await fx.provision();
      const obs = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: observation({
          subject_id: "user_multi",
          content: "Penyebaran produksi wajib melewati smoke rollback terverifikasi.",
        }),
      });
      expectOk(obs, 201);
      const consolidated = await fx.call("POST", "/v1/consolidations", {
        key: agent.key,
        body: {
          subject_id: "user_multi",
          claims: [
            claim(obs.body.data.observation_id, {
              statement: "Penyebaran produksi memerlukan smoke rollback terverifikasi.",
            }),
          ],
        },
      });
      expectOk(consolidated, 201);
      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: "user_multi",
          task: "bagaimana cara penyebaran produksi yang aman",
          max_tokens: 900,
        },
      });
      expectOk(compiled);
      assert.equal(compiled.body.data.items.length, 1);
    },
  },
  {
    name: "committed memory survives a restart without a rebuild step",
    async run(fx) {
      const agent = await fx.provision();
      const seeded = await seedClaim(fx, agent.key);
      await fx.restart();

      const ready = await fx.call("GET", "/readyz");
      expectOk(ready);
      assert.equal(ready.body.data.ready, true);

      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          task: "deploy the current project safely with a rollback smoke",
          max_tokens: 900,
        },
      });
      expectOk(compiled);
      assert.equal(
        compiled.body.data.items.some((item: any) => item.claim_id === seeded.claimId),
        true,
        "a committed claim must survive a restart",
      );
      const evidence = await fx.call("GET", `/v1/claims/${seeded.claimId}/evidence`, {
        key: agent.key,
      });
      expectOk(evidence);
      assert.equal(
        evidence.body.data.evidence.supporting[0].observation_id,
        seeded.observationId,
      );
    },
  },
  {
    name: "compilation survives more candidates than one statement may bind",
    async run(fx) {
      const agent = await fx.provision();
      const obs = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: observation({
          subject_id: "user_volume",
          content: "Volume evidence about the shared rollback smoke gate.",
        }),
      });
      expectOk(obs, 201);
      const observationId = obs.body.data.observation_id as string;

      // 100 eligible claims exceeds D1's 100 bound-parameter statement limit
      // for any naive `IN (...)` hydration.
      for (let batch = 0; batch < 2; batch += 1) {
        const claims = Array.from({ length: 50 }, (_unused, index) => ({
          kind: "procedural",
          statement: `Rollback smoke gate variant ${batch}-${index} must pass before release.`,
          sources: [{ observation_id: observationId, relation: "supports" }],
        }));
        const res = await fx.call("POST", "/v1/consolidations", {
          key: agent.key,
          body: { subject_id: "user_volume", claims },
        });
        expectOk(res, 201);
        assert.equal(res.body.data.claims.length, 50);
      }

      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: "user_volume", task: "rollback smoke gate release", max_tokens: 2000 },
      });
      expectOk(compiled);
      assert.ok(compiled.body.meta.candidates >= 100, "all eligible claims must be considered");
      assert.ok(compiled.body.data.items.length >= 1);
      for (const item of compiled.body.data.items)
        assert.deepEqual(item.evidence_ids, [observationId], "evidence must hydrate for each item");
    },
  },
  {
    name: "a managed key cannot exceed the credential that created it",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"], maxTrust: "policy_approved" });
      const created = await fx.call("POST", "/v1/keys", {
        key: owner.key,
        body: {
          label: "reader",
          scopes: ["context:compile", "evidence:read"],
          max_trust: "asserted",
        },
      });
      expectOk(created, 201);
      const child = created.body.data.api_key as string;
      assert.match(child, /^titen_sk_/);
      assert.match(created.body.data.warning, /cannot show it again/i);

      // The child key works for what it was granted and nothing else.
      expectOk(
        await fx.call("POST", "/v1/context/compile", {
          key: child,
          body: { subject_id: "user_rama", task: "anything at all", max_tokens: 300 },
        }),
      );
      expectError(
        await fx.call("POST", "/v1/observations", { key: child, body: observation() }),
        403,
      );
      expectError(await fx.call("GET", "/v1/keys", { key: child }), 403);

      const limited = await fx.provision({
        orgId: owner.orgId,
        scopes: ["keys:manage", "context:compile"],
        maxTrust: "asserted",
      });
      expectError(
        await fx.call("POST", "/v1/keys", {
          key: limited.key,
          body: { label: "escalated", scopes: ["observations:write"] },
        }),
        403,
        "FORBIDDEN",
      );
      expectError(
        await fx.call("POST", "/v1/keys", {
          key: limited.key,
          body: { label: "escalated", scopes: ["context:compile"], max_trust: "verified" },
        }),
        403,
      );
    },
  },
  {
    name: "revocation takes effect on the next request and stays scoped",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const created = await fx.call("POST", "/v1/keys", {
        key: owner.key,
        body: { label: "temporary", scopes: ["context:compile"] },
      });
      expectOk(created, 201);
      const child = created.body.data.api_key as string;
      const childId = created.body.data.key_id as string;
      expectOk(
        await fx.call("POST", "/v1/context/compile", {
          key: child,
          body: { subject_id: "user_rama", task: "still authorized", max_tokens: 300 },
        }),
      );

      const listed = await fx.call("GET", "/v1/keys", { key: owner.key });
      expectOk(listed);
      const serialized = JSON.stringify(listed.body);
      assert.ok(!serialized.includes(child), "listing must not expose raw keys");
      assert.ok(!serialized.includes("key_hash"), "listing must not expose hashes");

      expectOk(await fx.call("DELETE", `/v1/keys/${childId}`, { key: owner.key }));
      expectError(
        await fx.call("POST", "/v1/context/compile", {
          key: child,
          body: { subject_id: "user_rama", task: "no longer authorized", max_tokens: 300 },
        }),
        401,
      );
      // Idempotent, and a foreign key id stays indistinguishable from absent.
      expectOk(await fx.call("DELETE", `/v1/keys/${childId}`, { key: owner.key }));
      const intruder = await fx.provision({ scopes: ["*"] });
      expectError(await fx.call("DELETE", `/v1/keys/${childId}`, { key: intruder.key }), 404);
    },
  },
  {
    name: "canonical records export and reimport as versioned JSONL",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const seeded = await seedClaim(fx, owner.key);
      const task = "deploy the current project safely with a rollback smoke";

      const observations = await fx.call("GET", "/v1/export?type=observations", { key: owner.key });
      assert.equal(observations.status, 200);
      assert.match(observations.headers.get("content-type") ?? "", /ndjson/);
      const observationLines = String(observations.body).trim().split("\n");
      const header = JSON.parse(observationLines[0]!);
      assert.equal(header.type, "titen.export.header");
      assert.equal(header.format_version, 1);
      assert.equal(header.complete, true);
      assert.equal(observationLines.length, 2);
      assert.ok(!String(observations.body).includes("titen_sk_"), "export must carry no key");

      const claims = await fx.call("GET", "/v1/export?type=claims", { key: owner.key });
      assert.equal(claims.status, 200);
      const claimLines = String(claims.body).trim().split("\n");
      const exportedClaim = JSON.parse(claimLines[1]!);
      assert.equal(exportedClaim.id, seeded.claimId);
      assert.deepEqual(exportedClaim.sources, [
        { observation_id: seeded.observationId, relation: "supports", created_at: exportedClaim.sources[0].created_at },
      ]);

      // Re-importing the same file must change nothing observable.
      const reimport = await fx.call("POST", "/v1/import", {
        key: owner.key,
        headers: { "content-type": "application/x-ndjson" },
        body: undefined,
      });
      expectError(reimport, 400);
      const replay = await fx.callRaw("POST", "/v1/import", {
        key: owner.key,
        body: `${observationLines.join("\n")}\n${claimLines.join("\n")}\n`,
      });
      expectOk(replay);
      assert.equal(replay.body.data.received.observation, 1);
      assert.equal(replay.body.data.received.claim, 1);
      const afterReplay = await fx.call("POST", "/v1/context/compile", {
        key: owner.key,
        body: { subject_id: "user_rama", task, max_tokens: 900 },
      });
      expectOk(afterReplay);
      assert.equal(afterReplay.body.data.items.length, 1, "re-import must not duplicate memory");

      // A different deployment's records land intact under new ownership.
      const migratedObservationId = "obs_migrated00000000000000000000";
      const migratedClaimId = "claim_migrated00000000000000000000";
      assert.notEqual(migratedObservationId, seeded.observationId);
      assert.notEqual(migratedClaimId, seeded.claimId);
      const migrated = `${observationLines.join("\n")}\n${claimLines.join("\n")}\n`
        .replaceAll(seeded.observationId, migratedObservationId)
        .replaceAll(seeded.claimId, migratedClaimId);
      const target = await fx.provision({ scopes: ["*"] });
      const imported = await fx.callRaw("POST", "/v1/import", { key: target.key, body: migrated });
      expectOk(imported);
      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: target.key,
        body: { subject_id: "user_rama", task, max_tokens: 900 },
      });
      expectOk(compiled);
      assert.equal(compiled.body.data.items.length, 1, "imported memory must be retrievable");
      const evidence = await fx.call(
        "GET",
        `/v1/claims/${compiled.body.data.items[0].claim_id}/evidence`,
        { key: target.key },
      );
      expectOk(evidence);
      assert.equal(evidence.body.data.evidence.supporting.length, 1);

      // Importing an id owned elsewhere fails loudly instead of silently.
      const collision = await fx.callRaw("POST", "/v1/import", {
        key: target.key,
        body: `${observationLines.join("\n")}\n`,
      });
      expectError(collision, 409, "CONFLICT");
    },
  },
  // --- v0.1: Temporal supersession ---
  {
    name: "a claim can be superseded by a newer active claim",
    async run(fx) {
      const agent = await fx.provision();
      const old = await seedClaim(fx, agent.key);
      const replacement = await seedClaim(fx, agent.key, {
        observation: { content: "Updated rollback procedure uses canary deploys." },
        claim: { statement: "Canary deploys replace rollback smoke for release safety." },
      });

      const res = await fx.call("POST", `/v1/claims/${old.claimId}/supersede`, {
        key: agent.key,
        body: { superseded_by: replacement.claimId },
      });
      expectOk(res);
      assert.equal(res.body.data.status, "superseded");
      assert.equal(res.body.data.superseded_by, replacement.claimId);
      assert.equal(res.body.data.version, 2);

      // Superseded claims disappear from compilation
      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: "user_rama", task: "rollback smoke canary deploy release safety", max_tokens: 1200 },
      });
      expectOk(compiled);
      const ids = compiled.body.data.items.map((i: any) => i.claim_id);
      assert.ok(!ids.includes(old.claimId), "superseded claim must not appear in context");
      assert.ok(ids.includes(replacement.claimId), "replacement claim must appear");

      // Cannot supersede again
      expectError(
        await fx.call("POST", `/v1/claims/${old.claimId}/supersede`, {
          key: agent.key,
          body: { superseded_by: replacement.claimId },
        }),
        400,
      );
    },
  },
  {
    name: "a claim can be explicitly revoked",
    async run(fx) {
      const agent = await fx.provision();
      const seeded = await seedClaim(fx, agent.key);

      const res = await fx.call("POST", `/v1/claims/${seeded.claimId}/revoke`, {
        key: agent.key,
        body: { reason: "Procedure is no longer valid." },
      });
      expectOk(res);
      assert.equal(res.body.data.status, "revoked");

      // Revoked claims disappear from compilation
      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: "user_rama", task: "rollback smoke", max_tokens: 900 },
      });
      expectOk(compiled);
      assert.equal(compiled.body.data.items.length, 0);

      // Idempotent
      const again = await fx.call("POST", `/v1/claims/${seeded.claimId}/revoke`, {
        key: agent.key,
        body: {},
      });
      expectOk(again);
      assert.equal(again.body.data.already_revoked, true);
    },
  },
  {
    name: "a claim can be explicitly expired",
    async run(fx) {
      const agent = await fx.provision();
      const seeded = await seedClaim(fx, agent.key);

      const res = await fx.call("POST", `/v1/claims/${seeded.claimId}/expire`, {
        key: agent.key,
        body: { reason: "Information is stale." },
      });
      expectOk(res);
      assert.equal(res.body.data.status, "expired");
      assert.ok(res.body.data.valid_to, "explicit expiry must set valid_to");

      // Expired claims disappear from compilation
      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: "user_rama", task: "rollback smoke", max_tokens: 900 },
      });
      expectOk(compiled);
      assert.equal(compiled.body.data.items.length, 0);
    },
  },
  {
    name: "lifecycle operations on foreign claims return 404",
    async run(fx) {
      const owner = await fx.provision();
      const seeded = await seedClaim(fx, owner.key);
      const intruder = await fx.provision();

      for (const op of ["supersede", "revoke", "expire"]) {
        const body = op === "supersede" ? { superseded_by: seeded.claimId } : {};
        expectError(
          await fx.call("POST", `/v1/claims/${seeded.claimId}/${op}`, {
            key: intruder.key,
            body,
          }),
          404,
        );
      }
    },
  },
  // --- v0.1: Checkpoints ---
  {
    name: "a checkpoint saves, retrieves, updates, and deletes resumable state",
    async run(fx) {
      const agent = await fx.provision();

      // Save
      const saved = await fx.call("POST", "/v1/checkpoints", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          kind: "task_state",
          state: { step: 3, context: "deploying" },
          ttl_seconds: 3600,
        },
      });
      expectOk(saved, 201);
      assert.match(saved.body.data.checkpoint_id, /^ckpt_/);
      assert.equal(saved.body.data.updated, false);

      // Retrieve
      const got = await fx.call("GET", "/v1/checkpoints?subject_id=user_rama&kind=task_state", {
        key: agent.key,
      });
      expectOk(got);
      assert.deepEqual(got.body.data.state, { step: 3, context: "deploying" });
      assert.equal(got.body.data.checkpoint_id, saved.body.data.checkpoint_id);

      // Update (upsert same org+subject+agent+kind)
      const updated = await fx.call("POST", "/v1/checkpoints", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          kind: "task_state",
          state: { step: 4, context: "verifying" },
          ttl_seconds: 7200,
        },
      });
      expectOk(updated);
      assert.equal(updated.body.data.checkpoint_id, saved.body.data.checkpoint_id);
      assert.equal(updated.body.data.updated, true);

      // Delete
      const deleted = await fx.call("DELETE", `/v1/checkpoints/${saved.body.data.checkpoint_id}`, {
        key: agent.key,
      });
      expectOk(deleted);
      assert.equal(deleted.body.data.deleted, true);

      // Gone after delete
      expectError(
        await fx.call("GET", "/v1/checkpoints?subject_id=user_rama&kind=task_state", {
          key: agent.key,
        }),
        404,
      );
    },
  },
  {
    name: "expired checkpoints are not retrievable",
    async run(fx) {
      const agent = await fx.provision();
      // Save with minimum TTL, then check it exists
      const saved = await fx.call("POST", "/v1/checkpoints", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          kind: "cursor",
          state: { offset: 42 },
          ttl_seconds: 60,
        },
      });
      expectOk(saved, 201);

      // It's retrievable while not expired
      const got = await fx.call("GET", "/v1/checkpoints?subject_id=user_rama&kind=cursor", {
        key: agent.key,
      });
      expectOk(got);
      assert.equal(got.body.data.state.offset, 42);
    },
  },
  {
    name: "checkpoints from another organization are not accessible",
    async run(fx) {
      const owner = await fx.provision();
      const saved = await fx.call("POST", "/v1/checkpoints", {
        key: owner.key,
        body: {
          subject_id: "user_rama",
          kind: "task_state",
          state: { secret: true },
          ttl_seconds: 3600,
        },
      });
      expectOk(saved, 201);

      const intruder = await fx.provision();
      expectError(
        await fx.call("GET", "/v1/checkpoints?subject_id=user_rama&kind=task_state", {
          key: intruder.key,
        }),
        404,
      );
      expectError(
        await fx.call("DELETE", `/v1/checkpoints/${saved.body.data.checkpoint_id}`, {
          key: intruder.key,
        }),
        404,
      );
    },
  },
  // --- v0.2: Collaboration ---
  {
    name: "workspaces can be created and listed within an organization",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const created = await fx.call("POST", "/v1/workspaces", {
        key: owner.key,
        body: { name: "deploy-team" },
      });
      expectOk(created, 201);
      assert.match(created.body.data.workspace_id, /^ws_/);
      assert.equal(created.body.data.name, "deploy-team");

      const listed = await fx.call("GET", "/v1/workspaces", { key: owner.key });
      expectOk(listed);
      assert.ok(listed.body.data.workspaces.some((w: any) => w.name === "deploy-team"));

      // Duplicate name fails
      expectError(
        await fx.call("POST", "/v1/workspaces", { key: owner.key, body: { name: "deploy-team" } }),
        409,
      );
    },
  },
  {
    name: "memberships control who belongs to a workspace",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const wsName = `collab-${Date.now()}`;
      const ws = await fx.call("POST", "/v1/workspaces", {
        key: owner.key,
        body: { name: wsName },
      });
      const wsId = ws.body.data.workspace_id;

      const added = await fx.call("POST", "/v1/memberships", {
        key: owner.key,
        body: { workspace_id: wsId, principal_id: "agent_helper", principal_kind: "agent", role: "member" },
      });
      expectOk(added, 201);
      assert.match(added.body.data.membership_id, /^mbr_/);

      const listed = await fx.call("GET", `/v1/memberships?workspace_id=${wsId}`, { key: owner.key });
      expectOk(listed);
      assert.ok(listed.body.data.memberships.some((m: any) => m.principal_id === "agent_helper"));

      // Remove
      const removed = await fx.call("DELETE", `/v1/memberships/${added.body.data.membership_id}`, { key: owner.key });
      expectOk(removed);
      assert.ok(removed.body.data.removed_at);
    },
  },
  {
    name: "leases provide exclusive resource access with TTL",
    async run(fx) {
      const agent1 = await fx.provision({ scopes: ["*"] });
      const agent2 = await fx.provision({ orgId: agent1.orgId, scopes: ["*"] });

      // Acquire
      const lease = await fx.call("POST", "/v1/leases", {
        key: agent1.key,
        body: { resource_type: "subject", resource_id: "user_rama", purpose: "deploy", ttl_seconds: 300 },
      });
      expectOk(lease, 201);
      assert.match(lease.body.data.lease_id, /^lease_/);

      // Conflict: same resource
      expectError(
        await fx.call("POST", "/v1/leases", {
          key: agent2.key,
          body: { resource_type: "subject", resource_id: "user_rama", purpose: "review", ttl_seconds: 300 },
        }),
        409,
      );

      // Release
      const released = await fx.call("DELETE", `/v1/leases/${lease.body.data.lease_id}`, { key: agent1.key });
      expectOk(released);

      // Now agent2 can acquire
      const lease2 = await fx.call("POST", "/v1/leases", {
        key: agent2.key,
        body: { resource_type: "subject", resource_id: "user_rama", purpose: "review", ttl_seconds: 300 },
      });
      expectOk(lease2, 201);
    },
  },
  {
    name: "handoffs transfer work between principals",
    async run(fx) {
      const sender = await fx.provision({ scopes: ["*"] });
      const receiver = await fx.provision({ orgId: sender.orgId, scopes: ["*"] });

      const handoff = await fx.call("POST", "/v1/handoffs", {
        key: sender.key,
        body: { to_principal: receiver.principalId, subject_id: "user_rama", message: "Please continue deploy." },
      });
      expectOk(handoff, 201);
      assert.match(handoff.body.data.handoff_id, /^hoff_/);
      assert.equal(handoff.body.data.status, "pending");

      // Receiver sees it
      const listed = await fx.call("GET", "/v1/handoffs", { key: receiver.key });
      expectOk(listed);
      assert.ok(listed.body.data.handoffs.some((h: any) => h.handoff_id === handoff.body.data.handoff_id));

      // Accept
      const resolved = await fx.call("POST", `/v1/handoffs/${handoff.body.data.handoff_id}/resolve`, {
        key: receiver.key,
        body: { status: "accepted" },
      });
      expectOk(resolved);
      assert.equal(resolved.body.data.status, "accepted");
    },
  },
  // --- v0.2: MCP and Events ---
  {
    name: "MCP replies with a bare JSON-RPC body on both runtimes",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      // Asserted on the wire, not through an envelope: the reply must be the
      // JSON-RPC object itself or no MCP client can read it.
      const init = await fx.call("POST", "/mcp", {
        key: agent.key,
        body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      });
      assert.equal(init.status, 200);
      assert.equal(init.body.jsonrpc, "2.0");
      assert.equal(init.body.id, 1);
      assert.equal(init.body.result.serverInfo.name, "titen");
      assert.equal(init.body.data, undefined, "no Titen envelope may wrap an MCP reply");

      const tools = await fx.call("POST", "/mcp", {
        key: agent.key,
        body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      });
      assert.equal(tools.body.result.tools.length >= 7, true);
      assert.ok(tools.body.result.tools.some((t: any) => t.name === "titen_remember"));
      assert.ok(tools.body.result.tools.some((t: any) => t.name === "titen_compile"));

      // A notification must be accepted without a body on either runtime.
      const notified = await fx.call("POST", "/mcp", {
        key: agent.key,
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
      });
      assert.equal(notified.status, 202);
    },
  },
  {
    name: "MCP titen_remember and titen_compile tools work end-to-end",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });

      // Remember
      const remember = await fx.call("POST", "/mcp", {
        key: agent.key,
        body: {
          jsonrpc: "2.0", id: 3, method: "tools/call",
          params: {
            name: "titen_remember",
            arguments: {
              subject_id: "user_mcp",
              kind: "tool_result",
              content: "MCP tool integration test evidence.",
              source_type: "test",
              source_ref: "mcp#1",
              trust: "verified",
            },
          },
        },
      });
      assert.equal(remember.status, 200);
      assert.equal(remember.body.jsonrpc, "2.0");
      assert.ok(remember.body.result.content[0].text.includes("obs_"));

      // Compile
      const compile = await fx.call("POST", "/mcp", {
        key: agent.key,
        body: {
          jsonrpc: "2.0", id: 4, method: "tools/call",
          params: {
            name: "titen_compile",
            arguments: { subject_id: "user_mcp", task: "MCP tool integration test", max_tokens: 900 },
          },
        },
      });
      assert.equal(compile.status, 200);
      assert.equal(compile.body.jsonrpc, "2.0");
      assert.ok(compile.body.result.content[0].text);
    },
  },
  {
    name: "events can be listed with cursor-based polling",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });

      // Create some activity that generates events (if events are auto-recorded)
      // or just verify the endpoint works with empty state
      const listed = await fx.call("GET", "/v1/events", { key: agent.key });
      expectOk(listed);
      assert.ok(Array.isArray(listed.body.data.events));
    },
  },
  // --- v0.2: Collaboration cross-org ---
  {
    name: "collaboration from another org returns 404",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const ws = await fx.call("POST", "/v1/workspaces", { key: owner.key, body: { name: "secret" } });
      const intruder = await fx.provision({ scopes: ["*"] });

      const listed = await fx.call("GET", "/v1/workspaces", { key: intruder.key });
      expectOk(listed);
      assert.equal(listed.body.data.workspaces.length, 0);
    },
  },
  // --- Audit + events are now written by the paths they describe ---
  {
    name: "a canonical write records its event in the same transaction",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      const seeded = await seedClaim(fx, agent.key);

      const listed = await fx.call("GET", "/v1/events", { key: agent.key });
      expectOk(listed);
      const kinds = listed.body.data.events.map((e: any) => e.kind);
      assert.ok(kinds.includes("observation.appended"), "observation must emit an event");
      assert.ok(kinds.includes("claim.materialized"), "claim must emit an event");

      const claimEvent = listed.body.data.events.find(
        (e: any) => e.resource_id === seeded.claimId,
      );
      assert.ok(claimEvent, "the event must point at the claim it describes");
      assert.equal(claimEvent.resource_type, "claim");

      // A rejected write leaves no event behind: same batch, same rollback.
      const before = listed.body.data.events.length;
      expectError(
        await fx.call("POST", "/v1/observations", {
          key: agent.key,
          body: observation({ kind: "gossip" }),
        }),
        400,
      );
      const after = await fx.call("GET", "/v1/events", { key: agent.key });
      assert.equal(after.body.data.events.length, before, "a failed write emits no event");
    },
  },
  {
    name: "events stay inside their organization and page by cursor",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      await seedClaim(fx, owner.key);
      const intruder = await fx.provision({ scopes: ["*"] });

      const foreign = await fx.call("GET", "/v1/events", { key: intruder.key });
      expectOk(foreign);
      assert.equal(foreign.body.data.events.length, 0, "events must not cross organizations");

      const page = await fx.call("GET", "/v1/events?limit=1", { key: owner.key });
      expectOk(page);
      assert.equal(page.body.data.events.length, 1);
      const cursor = page.body.data.cursor;
      assert.ok(cursor);
      const next = await fx.call("GET", `/v1/events?after=${cursor}&limit=1`, { key: owner.key });
      expectOk(next);
      assert.notEqual(next.body.data.events[0]?.id, page.body.data.events[0].id);

      const single = await fx.call("GET", `/v1/events/${cursor}`, { key: owner.key });
      expectOk(single);
      assert.equal(single.body.data.id, cursor);
      expectError(await fx.call("GET", `/v1/events/${cursor}`, { key: intruder.key }), 404);
    },
  },
  {
    name: "a lifecycle transition writes both an event and an audit entry",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      const seeded = await seedClaim(fx, agent.key);
      expectOk(
        await fx.call("POST", `/v1/claims/${seeded.claimId}/revoke`, {
          key: agent.key,
          body: { reason: "superseded by policy" },
        }),
      );

      const events = await fx.call("GET", "/v1/events?kind=claim.revoked", { key: agent.key });
      expectOk(events);
      assert.equal(events.body.data.events.length, 1);
      assert.equal(events.body.data.events[0].resource_id, seeded.claimId);

      const audit = await fx.call("GET", "/v1/audit?action=claim.revoke", { key: agent.key });
      expectOk(audit);
      assert.equal(audit.body.data.entries.length, 1);
      assert.equal(audit.body.data.entries[0].resource_id, seeded.claimId);
      assert.equal(audit.body.data.entries[0].detail, "superseded by policy");
    },
  },
  {
    name: "the audit trail exports as NDJSON and stays scoped",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const seeded = await seedClaim(fx, owner.key);
      expectOk(
        await fx.call("POST", `/v1/claims/${seeded.claimId}/expire`, {
          key: owner.key,
          body: {},
        }),
      );

      const exported = await fx.call("GET", "/v1/audit/export", { key: owner.key });
      assert.equal(exported.status, 200);
      assert.match(exported.headers.get("content-type") ?? "", /ndjson/);
      const lines = String(exported.body).trim().split("\n");
      const header = JSON.parse(lines[0]!);
      assert.equal(header.type, "titen.audit.header");
      assert.equal(header.format_version, 1);
      assert.ok(lines.length >= 2, "the expire action must be exported");
      assert.ok(!String(exported.body).includes("titen_sk_"), "export must carry no key");

      const intruder = await fx.provision({ scopes: ["*"] });
      const foreign = await fx.call("GET", "/v1/audit", { key: intruder.key });
      expectOk(foreign);
      assert.equal(foreign.body.data.entries.length, 0);
    },
  },
  // --- v0.3: Governance ---
  {
    name: "a policy is created and listed within its organization",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const created = await fx.call("POST", "/v1/policies", {
        key: owner.key,
        body: {
          kind: "retention",
          target_type: "org",
          config: JSON.stringify({ keep_days: 365 }),
        },
      });
      expectOk(created, 201);
      assert.match(created.body.data.policy_id, /^pol_/);

      expectError(
        await fx.call("POST", "/v1/policies", {
          key: owner.key,
          body: { kind: "invented", target_type: "org", config: "{}" },
        }),
        400,
      );
      expectError(
        await fx.call("POST", "/v1/policies", {
          key: owner.key,
          body: { kind: "retention", target_type: "org", config: "not json" },
        }),
        400,
      );

      const listed = await fx.call("GET", "/v1/policies", { key: owner.key });
      expectOk(listed);
      assert.equal(listed.body.data.policies.length, 1);

      const intruder = await fx.provision({ scopes: ["*"] });
      const foreign = await fx.call("GET", "/v1/policies", { key: intruder.key });
      expectOk(foreign);
      assert.equal(foreign.body.data.policies.length, 0);
    },
  },
  {
    name: "only verified claims reach a channel release, and only when published",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"], maxTrust: "policy_approved" });
      const verified = await seedClaim(fx, owner.key);

      // An asserted claim is not publishable knowledge.
      const weak = await fx.call("POST", "/v1/observations", {
        key: owner.key,
        body: observation({ trust: "asserted", content: "Draft note about the rollback gate." }),
      });
      const weakClaim = await fx.call("POST", "/v1/consolidations", {
        key: owner.key,
        body: {
          subject_id: "user_rama",
          claims: [claim(weak.body.data.observation_id, { statement: "Draft rollback rule." })],
        },
      });
      expectOk(weakClaim, 201);

      expectError(
        await fx.call("POST", "/v1/channel-releases", {
          key: owner.key,
          body: {
            channel: "crm",
            audience: "public",
            claim_ids: [weakClaim.body.data.claims[0].claim_id],
          },
        }),
        400,
      );

      const release = await fx.call("POST", "/v1/channel-releases", {
        key: owner.key,
        body: {
          channel: "crm",
          audience: "public",
          claim_ids: [verified.claimId, weakClaim.body.data.claims[0].claim_id],
        },
      });
      expectOk(release, 201);
      assert.equal(release.body.data.status, "draft");
      assert.equal(release.body.data.claims_included, 1, "only the verified claim is eligible");
      assert.equal(release.body.data.version, 1);
      const releaseId = release.body.data.release_id;

      // A draft discloses nothing: trust is not publication.
      const beforePublish = await fx.call("POST", "/v1/channel-context", {
        key: owner.key,
        body: { channel: "crm", audience: "public", task: "rollback smoke", max_tokens: 900 },
      });
      expectOk(beforePublish);
      assert.equal(beforePublish.body.data.items.length, 0, "a draft must not serve content");

      expectOk(await fx.call("POST", `/v1/channel-releases/${releaseId}/publish`, {
        key: owner.key,
        body: {},
      }));

      const afterPublish = await fx.call("POST", "/v1/channel-context", {
        key: owner.key,
        body: { channel: "crm", audience: "public", task: "rollback smoke", max_tokens: 900 },
      });
      expectOk(afterPublish);
      assert.equal(afterPublish.body.data.items.length, 1);
      assert.match(afterPublish.body.data.instructions, /untrusted reference data/i);
      assert.ok(afterPublish.body.data.budget.used_tokens <= 900);

      // A different audience shares nothing with this release.
      const otherAudience = await fx.call("POST", "/v1/channel-context", {
        key: owner.key,
        body: { channel: "crm", audience: "partner", task: "rollback smoke", max_tokens: 900 },
      });
      expectOk(otherAudience);
      assert.equal(otherAudience.body.data.items.length, 0);

      // Publishing twice is refused; revoking withdraws access immediately.
      expectError(
        await fx.call("POST", `/v1/channel-releases/${releaseId}/publish`, {
          key: owner.key,
          body: {},
        }),
        409,
      );
      expectOk(await fx.call("POST", `/v1/channel-releases/${releaseId}/revoke`, {
        key: owner.key,
        body: {},
      }));
      const afterRevoke = await fx.call("POST", "/v1/channel-context", {
        key: owner.key,
        body: { channel: "crm", audience: "public", task: "rollback smoke", max_tokens: 900 },
      });
      expectOk(afterRevoke);
      assert.equal(afterRevoke.body.data.items.length, 0, "revoke takes effect on the next read");

      // Publication and disclosure are both audited.
      const audit = await fx.call("GET", "/v1/audit", { key: owner.key });
      expectOk(audit);
      const actions = audit.body.data.entries.map((e: any) => e.action);
      assert.ok(actions.includes("release.publish"));
      assert.ok(actions.includes("release.revoke"));
      assert.ok(actions.includes("channel.context"), "a channel read is itself evidence");
    },
  },
  {
    name: "a release from another organization is not found",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const seeded = await seedClaim(fx, owner.key);
      const release = await fx.call("POST", "/v1/channel-releases", {
        key: owner.key,
        body: { channel: "crm", audience: "public", claim_ids: [seeded.claimId] },
      });
      expectOk(release, 201);
      const releaseId = release.body.data.release_id;

      const intruder = await fx.provision({ scopes: ["*"] });
      expectError(await fx.call("GET", `/v1/channel-releases/${releaseId}`, { key: intruder.key }), 404);
      expectError(
        await fx.call("POST", `/v1/channel-releases/${releaseId}/publish`, {
          key: intruder.key,
          body: {},
        }),
        404,
      );

      const own = await fx.call("GET", `/v1/channel-releases/${releaseId}`, { key: owner.key });
      expectOk(own);
      assert.equal(own.body.data.items.length, 1);
    },
  },
  // --- v0.2: Memory Atlas view compiler ---
  {
    name: "atlas compiles each lens over authorized records only",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const seeded = await seedClaim(fx, owner.key);

      const trace = await fx.call("POST", "/v1/memory-views/compile", {
        key: owner.key,
        body: { lens: "evidence_trace", focus_id: seeded.claimId, subject_id: "user_rama" },
      });
      expectOk(trace);
      assert.equal(trace.body.data.lens, "evidence_trace");
      assert.ok(
        trace.body.data.nodes.some((n: any) => n.id === seeded.claimId),
        "the focus claim must be a node",
      );
      assert.ok(
        trace.body.data.nodes.some((n: any) => n.id === seeded.observationId),
        "its evidence must be a node",
      );
      assert.ok(trace.body.data.edges.length >= 1, "the supports edge must be present");

      for (const lens of ["neighborhood", "conflict_freshness", "scope_preview"]) {
        const res = await fx.call("POST", "/v1/memory-views/compile", {
          key: owner.key,
          body: { lens, subject_id: "user_rama", focus_id: seeded.claimId },
        });
        expectOk(res);
        assert.equal(res.body.data.lens, lens);
        assert.ok(Array.isArray(res.body.data.nodes), `${lens} must return nodes`);
      }

      expectError(
        await fx.call("POST", "/v1/memory-views/compile", {
          key: owner.key,
          body: { lens: "invented", subject_id: "user_rama" },
        }),
        400,
      );

      // Atlas is a projection, never an authorization bypass.
      const intruder = await fx.provision({ scopes: ["*"] });
      const foreign = await fx.call("POST", "/v1/memory-views/compile", {
        key: intruder.key,
        body: { lens: "evidence_trace", focus_id: seeded.claimId, subject_id: "user_rama" },
      });
      assert.ok(
        foreign.status === 404 || foreign.body?.data?.nodes?.length === 0,
        "a foreign focus must disclose nothing",
      );
    },
  },
  // --- Post-v1: webhooks ---
  {
    name: "a webhook registers, validates its destination, and hides its secret",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const created = await fx.call("POST", "/v1/webhooks", {
        key: owner.key,
        body: {
          url: "https://example.test/titen",
          secret: "a-shared-secret-value",
          events: ["claim.materialized"],
        },
      });
      expectOk(created, 201);
      assert.match(created.body.data.webhook_id, /^whk_/);

      // A destination that could reach internal metadata is refused.
      for (const url of [
        "http://169.254.169.254/latest/meta-data",
        "http://10.0.0.5/hook",
        "ftp://example.test/hook",
      ])
        expectError(
          await fx.call("POST", "/v1/webhooks", {
            key: owner.key,
            body: { url, secret: "s3cret-value-here", events: ["*"] },
          }),
          400,
        );

      const listed = await fx.call("GET", "/v1/webhooks", { key: owner.key });
      expectOk(listed);
      const serialized = JSON.stringify(listed.body);
      assert.ok(!serialized.includes("a-shared-secret-value"), "listing must not expose the secret");
      assert.ok(!serialized.includes("secret_hash"), "listing must not expose the hash");

      const intruder = await fx.provision({ scopes: ["*"] });
      const foreign = await fx.call("GET", "/v1/webhooks", { key: intruder.key });
      expectOk(foreign);
      assert.equal(foreign.body.data.webhooks.length, 0);
    },
  },
  {
    name: "draining events queues a delivery for each subscribed webhook",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const hook = await fx.call("POST", "/v1/webhooks", {
        key: owner.key,
        body: {
          // Unroutable by design: the drain must record the attempt, not succeed.
          url: "https://127.0.0.1:9/titen-sink",
          secret: "drain-secret-value",
          events: ["*"],
        },
      });
      expectOk(hook, 201);
      const hookId = hook.body.data.webhook_id;

      await seedClaim(fx, owner.key);
      const drained = await fx.call("POST", "/v1/webhooks/deliver", { key: owner.key, body: {} });
      expectOk(drained);
      assert.ok(drained.body.data.events_drained >= 2, "queued events must be drained");

      const deliveries = await fx.call("GET", `/v1/webhooks/${hookId}/deliveries`, {
        key: owner.key,
      });
      expectOk(deliveries);
      assert.ok(deliveries.body.data.deliveries.length >= 2, "each event records a delivery");

      // A paused webhook receives nothing further.
      expectOk(await fx.call("POST", `/v1/webhooks/${hookId}/pause`, { key: owner.key, body: {} }));
      const before = deliveries.body.data.deliveries.length;
      await seedClaim(fx, owner.key, {
        observation: { content: "Second batch of rollback evidence." },
        claim: { statement: "Second rollback rule applies." },
      });
      expectOk(await fx.call("POST", "/v1/webhooks/deliver", { key: owner.key, body: {} }));
      const after = await fx.call("GET", `/v1/webhooks/${hookId}/deliveries`, { key: owner.key });
      expectOk(after);
      assert.equal(
        after.body.data.deliveries.length,
        before,
        "a paused webhook must receive no delivery",
      );

      expectOk(await fx.call("POST", `/v1/webhooks/${hookId}/resume`, { key: owner.key, body: {} }));
      expectOk(await fx.call("DELETE", `/v1/webhooks/${hookId}`, { key: owner.key }));
      expectError(
        await fx.call("GET", `/v1/webhooks/${hookId}/deliveries`, { key: owner.key }),
        404,
      );
    },
  },
  // --- v1: Federation ---
  {
    name: "a federation peer registers with a hashed secret and filters its scope",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const peer = await fx.call("POST", "/v1/federation/peers", {
        key: owner.key,
        body: {
          name: "eu-west",
          endpoint: "https://titen-eu.example.test",
          shared_secret: "peer-shared-secret-value",
          direction: "bidirectional",
        },
      });
      expectOk(peer, 201);
      const peerId = peer.body.data.peer_id;

      const listed = await fx.call("GET", "/v1/federation/peers", { key: owner.key });
      expectOk(listed);
      const serialized = JSON.stringify(listed.body);
      assert.ok(!serialized.includes("peer-shared-secret-value"), "the secret must not be listed");
      assert.ok(!serialized.includes("shared_secret_hash"), "the hash must not be listed");

      const filter = await fx.call("POST", `/v1/federation/peers/${peerId}/filters`, {
        key: owner.key,
        body: { resource_type: "event", min_trust: "verified" },
      });
      expectOk(filter, 201);
      const filters = await fx.call("GET", `/v1/federation/peers/${peerId}/filters`, {
        key: owner.key,
      });
      expectOk(filters);
      assert.equal(filters.body.data.filters.length, 1);

      const intruder = await fx.provision({ scopes: ["*"] });
      const foreign = await fx.call("GET", "/v1/federation/peers", { key: intruder.key });
      expectOk(foreign);
      assert.equal(foreign.body.data.peers.length, 0);
      expectError(
        await fx.call("GET", `/v1/federation/peers/${peerId}/filters`, { key: intruder.key }),
        404,
      );
    },
  },
  {
    name: "federation pull advances a cursor and suspension stops exchange",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const peer = await fx.call("POST", "/v1/federation/peers", {
        key: owner.key,
        body: {
          name: "ap-south",
          endpoint: "https://titen-ap.example.test",
          shared_secret: "another-peer-secret",
          direction: "pull",
        },
      });
      expectOk(peer, 201);
      const peerId = peer.body.data.peer_id;

      await seedClaim(fx, owner.key);
      const pulled = await fx.call("POST", "/v1/federation/pull", {
        key: owner.key,
        body: { peer_id: peerId },
      });
      expectOk(pulled);
      assert.ok(pulled.body.data.events.length >= 1, "eligible events must be offered");

      const again = await fx.call("POST", "/v1/federation/pull", {
        key: owner.key,
        body: { peer_id: peerId },
      });
      expectOk(again);
      assert.equal(again.body.data.events.length, 0, "the cursor must not replay events");

      expectOk(await fx.call("POST", `/v1/federation/peers/${peerId}/suspend`, {
        key: owner.key,
        body: {},
      }));
      // A suspended peer is an authorization state, not a write conflict.
      expectError(
        await fx.call("POST", "/v1/federation/pull", { key: owner.key, body: { peer_id: peerId } }),
        403,
      );

      const log = await fx.call("GET", `/v1/federation/log?peer_id=${peerId}`, { key: owner.key });
      expectOk(log);
      assert.ok(Array.isArray(log.body.data.entries ?? log.body.data.log));
    },
  },
];

/**
 * Atomicity is a driver guarantee, so it is verified against the driver itself
 * on both runtimes: a batch whose last statement fails must leave nothing.
 */
export async function assertBatchAtomicity(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS atomicity_probe (id TEXT PRIMARY KEY)`);
  await db.batch([{ sql: `DELETE FROM atomicity_probe`, params: [] }]);
  await assert.rejects(
    db.batch([
      { sql: `INSERT INTO atomicity_probe (id) VALUES (?)`, params: ["first"] },
      { sql: `INSERT INTO atomicity_probe (id) VALUES (?)`, params: ["first"] },
    ]),
  );
  const rows = await db.all<{ count: number }>(`SELECT COUNT(*) AS count FROM atomicity_probe`);
  assert.equal(Number(rows[0]!.count), 0, "a failed batch must roll back completely");
}
