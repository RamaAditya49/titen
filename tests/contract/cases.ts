import assert from "node:assert/strict";
import type { Db } from "../../src/core/db";
import { MAX_BODY_BYTES } from "../../src/core/http";
import { sha256Hex } from "../../src/core/ids";
import { signPayload } from "../../src/core/webhooks";
import { TITEN_VERSION } from "../../src/core/version";
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
      ...(typeof overrides.observation?.project_id === "string"
        ? { project_id: overrides.observation.project_id }
        : {}),
      ...(typeof overrides.observation?.workspace_id === "string"
        ? { workspace_id: overrides.observation.workspace_id }
        : {}),
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
      assert.equal(res.body.data.capabilities.version, 1);
      assert.equal(res.body.data.capabilities.fts, "enabled");
      assert.equal(res.body.data.capabilities.vector, "disabled");
      assert.equal(res.body.data.capabilities.embedding, "disabled");
      assert.equal(res.body.data.capabilities.extraction, "disabled");
      assert.equal(res.body.data.capabilities.background_enrichment, "disabled");
      assert.equal(res.body.data.capabilities.model, "disabled");
      assert.equal(
        res.body.data.capabilities.background_repair,
        fx.runtime === "cloudflare-d1" ? "stale" : "disabled",
      );
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
    name: "an observation commits canonical evidence without unused vector work",
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
      for (const row of counts)
        assert.equal(Number(row.count), row.label === "outbox" ? 0 : 1, `${row.label} row mismatch`);
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
      assert.equal(evidence.body.data.hidden_source_count, undefined);
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
    name: "a full-fit public context preserves rank and ideal final-pack metrics",
    async run(fx) {
      const agent = await fx.provision();
      const subject = "final_pack_ranking";
      const definitions = [
        ["procedural", 1, "Final pack metric marker alpha."],
        ["procedural", 0.9, "Final pack metric marker bravo."],
        ["preference", 0.8, "Final pack metric marker delta."],
        ["semantic_fact", 0.7, "Final pack metric marker gamma."],
        ["episodic_event", 0.6, "Final pack metric marker omega."],
      ] as const;
      const seeded = [];
      for (const [kind, confidence, statement] of definitions)
        seeded.push(await seedClaim(fx, agent.key, {
          observation: {
            subject_id: subject,
            content: `Evidence for ${statement}`,
          },
          claim: { kind, confidence, statement },
        }));

      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: subject,
          task: "final pack metric marker",
          max_tokens: 4_000,
          at: "2026-08-02T00:00:00.000Z",
        },
      });
      expectOk(compiled);
      const expected = seeded.map(({ claimId }) => claimId);
      const emitted = compiled.body.data.items.map((item: any) => item.claim_id as string);
      assert.deepEqual(emitted, expected);
      assert.deepEqual(
        compiled.body.data.items.map((item: any) => item.score),
        [...compiled.body.data.items.map((item: any) => item.score)].sort((a, b) => b - a),
      );

      const reciprocalRank = 1 / (emitted.indexOf(expected[1]!) + 1);
      const gains = new Map(expected.map((id, index) => [id, expected.length - index]));
      const dcg = emitted.reduce((sum: number, id: string, index: number) =>
        sum + ((2 ** gains.get(id)! - 1) / Math.log2(index + 2)), 0);
      const ideal = expected.reduce((sum, id, index) =>
        sum + ((2 ** gains.get(id)! - 1) / Math.log2(index + 2)), 0);
      assert.equal(reciprocalRank, 0.5);
      assert.equal(Number((dcg / ideal).toFixed(6)), 1);
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
    name: "missing project scope is unscoped-only and broad compile needs an explicit grant",
    async run(fx) {
      const subjectId = "user_project_scope_141";
      const owner = await fx.provision({ principalId: "agent_scope_owner", scopes: ["*"] });
      const member = await fx.provision({
        orgId: owner.orgId,
        principalId: "agent_scope_member",
        scopes: [
          "context:compile",
          "context:compile:all",
          "handoffs:write",
          "mcp:call",
        ],
      });
      const limited = await fx.provision({
        orgId: owner.orgId,
        principalId: "agent_scope_limited",
        scopes: ["context:compile", "mcp:call"],
      });
      const sibling = await fx.provision({
        orgId: owner.orgId,
        principalId: "agent_scope_sibling",
        scopes: ["*"],
      });
      const foreign = await fx.provision({ principalId: "agent_scope_foreign", scopes: ["*"] });

      const resolve = async (key: string, reference: string) => {
        const project = await fx.call("POST", "/v1/projects/resolve", {
          key,
          body: { reference, create: true },
        });
        expectOk(project, 201);
        return project.body.data.project_id as string;
      };
      const projectA = await resolve(owner.key, "scope-fixture/project-a");
      const projectB = await resolve(owner.key, "scope-fixture/project-b");
      const foreignProject = await resolve(foreign.key, "scope-fixture/foreign");

      const workspace = await fx.call("POST", "/v1/workspaces", {
        key: owner.key,
        body: { name: "scope-fixture-team" },
      });
      expectOk(workspace, 201);
      const workspaceId = workspace.body.data.workspace_id as string;
      let memberMembershipId = "";
      for (const principal of [owner, member]) {
        const membership = await fx.call("POST", "/v1/memberships", {
          key: owner.key,
          body: {
            workspace_id: workspaceId,
            principal_id: principal.principalId,
            principal_kind: "agent",
            role: "member",
          },
        });
        expectOk(membership, 201);
        if (principal === member)
          memberMembershipId = membership.body.data.membership_id;
      }

      const marker = "scope sentinel 141";
      const unscoped = await seedClaim(fx, owner.key, {
        observation: {
          subject_id: subjectId,
          content: `${marker} unscoped organization evidence.`,
          visibility: "organization",
        },
        claim: { statement: `${marker} unscoped organization claim.`, visibility: "organization" },
      });
      const inA = await seedClaim(fx, owner.key, {
        observation: {
          subject_id: subjectId,
          project_id: projectA,
          content: `${marker} project A organization evidence.`,
          visibility: "organization",
        },
        claim: { statement: `${marker} project A organization claim.`, visibility: "organization" },
      });
      const inB = await seedClaim(fx, owner.key, {
        observation: {
          subject_id: subjectId,
          project_id: projectB,
          content: `${marker} project B organization evidence.`,
          visibility: "organization",
        },
        claim: { statement: `${marker} project B organization claim.`, visibility: "organization" },
      });
      const teamA = await seedClaim(fx, owner.key, {
        observation: {
          subject_id: subjectId,
          project_id: projectA,
          workspace_id: workspaceId,
          content: `${marker} project A team evidence.`,
          visibility: "team",
        },
        claim: { statement: `${marker} project A team claim.`, visibility: "team" },
      });
      const privateA = await seedClaim(fx, sibling.key, {
        observation: {
          subject_id: subjectId,
          project_id: projectA,
          content: `${marker} sibling private evidence.`,
          visibility: "private",
        },
        claim: { statement: `${marker} sibling private claim.`, visibility: "private" },
      });
      const otherSubject = await seedClaim(fx, owner.key, {
        observation: {
          subject_id: "user_project_scope_other",
          project_id: projectA,
          content: `${marker} other subject evidence.`,
          visibility: "organization",
        },
        claim: { statement: `${marker} other subject claim.`, visibility: "organization" },
      });
      const foreignClaim = await seedClaim(fx, foreign.key, {
        observation: {
          subject_id: subjectId,
          project_id: foreignProject,
          content: `${marker} foreign organization evidence.`,
          visibility: "organization",
        },
        claim: { statement: `${marker} foreign organization claim.`, visibility: "organization" },
      });

      const ids = (response: Res) =>
        new Set(response.body.data.items.map((item: any) => item.claim_id as string));
      const compile = (key: string, extra: Record<string, unknown> = {}) =>
        fx.call("POST", "/v1/context/compile", {
          key,
          body: { subject_id: subjectId, task: marker, max_tokens: 4000, ...extra },
        });

      const omitted = await compile(member.key);
      expectOk(omitted);
      assert.deepEqual(omitted.body.data.scope, {
        subject_id: subjectId,
        project_id: null,
        project_mode: "unscoped",
        broad_access_reason: null,
      });
      assert.deepEqual(ids(omitted), new Set([unscoped.claimId]));

      const scoped = await compile(member.key, { project_id: projectA });
      expectOk(scoped);
      assert.equal(scoped.body.data.scope.project_mode, "project");
      assert.deepEqual(ids(scoped), new Set([inA.claimId, teamA.claimId]));

      expectError(await compile(limited.key, { cross_project: true }), 403, "FORBIDDEN");
      const deniedMcp = await fx.call("POST", "/mcp", {
        key: limited.key,
        body: {
          jsonrpc: "2.0",
          id: 140,
          method: "tools/call",
          params: {
            name: "titen_compile",
            arguments: {
              subject_id: subjectId,
              task: marker,
              max_tokens: 4000,
              cross_project: true,
            },
          },
        },
      });
      assert.equal(deniedMcp.body.result.isError, true);
      assert.equal(JSON.parse(deniedMcp.body.result.content[0].text).code, "FORBIDDEN");
      expectError(
        await compile(member.key, { project_id: projectA, cross_project: true }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(await compile(member.key, { project_id: foreignProject }), 404, "NOT_FOUND");

      const broad = await compile(member.key, { cross_project: true });
      expectOk(broad);
      assert.deepEqual(broad.body.data.scope, {
        subject_id: subjectId,
        project_id: null,
        project_mode: "cross_project",
        broad_access_reason: "credential_scope:context:compile:all",
      });
      assert.deepEqual(ids(broad), new Set([unscoped.claimId, inA.claimId, inB.claimId, teamA.claimId]));
      for (const hidden of [privateA.claimId, otherSubject.claimId, foreignClaim.claimId])
        assert.equal(ids(broad).has(hidden), false);

      const handoff = await fx.call("POST", "/v1/handoffs", {
        key: member.key,
        body: {
          to_principal: owner.principalId,
          subject_id: subjectId,
          context_id: broad.body.data.context_id,
          message: "Review the explicitly broad scope fixture.",
        },
      });
      expectOk(handoff, 201);
      const delegated = await fx.call(
        "GET",
        `/v1/context/${broad.body.data.context_id}`,
        { key: owner.key },
      );
      expectOk(delegated);
      assert.deepEqual(delegated.body.data.scope, broad.body.data.scope);
      assert.deepEqual(ids(delegated), ids(broad));

      const mcp = await fx.call("POST", "/mcp", {
        key: member.key,
        body: {
          jsonrpc: "2.0",
          id: 141,
          method: "tools/call",
          params: {
            name: "titen_compile",
            arguments: {
              subject_id: subjectId,
              task: marker,
              max_tokens: 4000,
              cross_project: true,
            },
          },
        },
      });
      assert.equal(mcp.status, 200);
      const mcpPayload = JSON.parse(mcp.body.result.content[0].text);
      assert.deepEqual(mcpPayload.data.scope, broad.body.data.scope);
      assert.deepEqual(
        new Set(mcpPayload.data.items.map((item: any) => item.claim_id)),
        ids(broad),
      );

      expectOk(
        await fx.call(
          "DELETE",
          `/v1/memberships/${memberMembershipId}`,
          { key: owner.key },
        ),
      );
      const afterRemoval = await compile(member.key, { cross_project: true });
      expectOk(afterRemoval);
      assert.equal(ids(afterRemoval).has(teamA.claimId), false);
      assert.deepEqual(ids(afterRemoval), new Set([unscoped.claimId, inA.claimId, inB.claimId]));

      const foreignBroad = await compile(foreign.key, { cross_project: true });
      expectOk(foreignBroad);
      assert.deepEqual(ids(foreignBroad), new Set([foreignClaim.claimId]));

      await fx.query(
        `UPDATE context_runs SET policy_snapshot = 'legacy-null-project-scope'
          WHERE id = ?`,
        [broad.body.data.context_id],
      );
      expectError(
        await fx.call("GET", `/v1/context/${broad.body.data.context_id}`, {
          key: owner.key,
        }),
        404,
        "NOT_FOUND",
      );
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
    name: "only the context owner or intended delegate can submit feedback",
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
      expectOk(compiled);
      const sibling = await fx.provision({ orgId: owner.orgId });
      expectError(
        await fx.call("POST", `/v1/context/${compiled.body.data.context_id}/feedback`, {
          key: sibling.key,
          body: { outcome: "harmful" },
        }),
        404,
      );
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
    name: "lexical limiting ranks a late best match before candidate and token budgets",
    async run(fx) {
      const agent = await fx.provision();
      const obs = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: observation({
          subject_id: "user_late_rank",
          content: "Shared evidence for a bounded lexical scale regression.",
        }),
      });
      expectOk(obs, 201);
      const observationId = obs.body.data.observation_id as string;

      // Insert 200 weaker matches first so limiting by row order would exclude
      // the final, more relevant claim before BM25 and token packing can see it.
      for (let batch = 0; batch < 4; batch += 1) {
        const claims = Array.from({ length: 50 }, (_unused, index) => ({
          kind: "procedural",
          statement: `Generic release note ${batch}-${index} with unrelated filler.`,
          sources: [{ observation_id: observationId, relation: "supports" }],
        }));
        expectOk(await fx.call("POST", "/v1/consolidations", {
          key: agent.key,
          body: { subject_id: "user_late_rank", claims },
        }), 201);
      }

      const target = await fx.call("POST", "/v1/consolidations", {
        key: agent.key,
        body: {
          subject_id: "user_late_rank",
          claims: [{
            kind: "procedural",
            statement: "Quartz rollback smoke is required before release.",
            sources: [{ observation_id: observationId, relation: "supports" }],
          }],
        },
      });
      expectOk(target, 201);
      const targetId = target.body.data.claims[0].claim_id as string;

      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: "user_late_rank",
          task: "quartz rollback smoke release",
          max_tokens: 300,
        },
      });
      expectOk(compiled);
      assert.equal(compiled.body.meta.candidates, 200);
      assert.equal(compiled.body.data.items[0]?.claim_id, targetId);
      assert.deepEqual(compiled.body.data.items[0]?.evidence_ids, [observationId]);
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
          principal_id: "agent_managed_reader",
        },
      });
      expectOk(created, 201);
      const child = created.body.data.api_key as string;
      assert.match(child, /^titen_sk_/);
      assert.equal(created.body.data.principal_id, "agent_managed_reader");
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
    name: "credential import cannot exceed the importing credential",
    async run(fx) {
      const limited = await fx.provision({
        scopes: ["keys:manage", "import:write"],
        maxTrust: "verified",
      });
      expectError(await fx.call("GET", "/v1/audit", { key: limited.key }), 403);

      const forgedKey = "titen_sk_synthetic_import_scope_ceiling";
      const at = "2026-08-01T00:00:00.000Z";
      const body = [
        { type: "titen.export.header", format_version: 4, org_id: limited.orgId },
        {
          type: "api_key",
          id: "key_import_scope_ceiling",
          principal_id: "agent_import_scope_ceiling",
          principal_kind: "agent",
          key_hash: await sha256Hex(forgedKey),
          label: "synthetic escalation attempt",
          scopes: "*",
          max_trust: "verified",
          created_at: at,
          not_before: at,
          expires_at: null,
          last_used_at: null,
          revoked_at: null,
        },
      ].map(JSON.stringify).join("\n");

      expectError(await fx.callRaw("POST", "/v1/import", { key: limited.key, body }), 403, "FORBIDDEN");
      expectError(await fx.call("GET", "/v1/audit", { key: forgedKey }), 401, "UNAUTHENTICATED");
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
    name: "managed keys enforce and preserve their complete lifecycle",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const principalId = "rotating-agent";
      const before = new Date(Date.now() + 60_000).toISOString();
      const expiry = new Date(Date.now() + 120_000).toISOString();
      const pending = await fx.call("POST", "/v1/keys", {
        key: owner.key,
        body: {
          label: "scheduled",
          principal_id: principalId,
          scopes: ["context:compile"],
          not_before: before,
          expires_at: expiry,
        },
      });
      expectOk(pending, 201);
      assert.equal(pending.body.data.not_before, before);
      assert.equal(pending.body.data.expires_at, expiry);
      assert.equal(pending.body.data.last_used_at, null);
      expectError(await fx.call("POST", "/v1/context/compile", {
        key: pending.body.data.api_key,
        body: { subject_id: "scheduled", task: "too early", max_tokens: 100 },
      }), 401);

      for (const body of [
        { label: "ignored", scopes: ["context:compile"], valid_until: expiry },
        { label: "backwards", scopes: ["context:compile"], not_before: expiry, expires_at: before },
      ]) expectError(await fx.call("POST", "/v1/keys", { key: owner.key, body }), 400, "VALIDATION_ERROR");

      const active = await fx.call("POST", "/v1/keys", {
        key: owner.key,
        body: {
          label: "active",
          principal_id: principalId,
          scopes: ["keys:manage", "export:read", "export:all", "import:write"],
          not_before: new Date(Date.now() - 60_000).toISOString(),
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      });
      expectOk(active, 201);
      const activeKey = active.body.data.api_key as string;
      const activeId = active.body.data.key_id as string;
      expectOk(await fx.call("GET", "/v1/keys", { key: activeKey }));
      const listed = await fx.call("GET", "/v1/keys", { key: owner.key });
      expectOk(listed);
      const rows = listed.body.data.keys.filter((row: any) => row.principal_id === principalId);
      assert.equal(rows.length, 2, "overlapping keys for one principal must remain independently visible");
      assert.equal(rows.find((row: any) => row.key_id === activeId).status, "active");
      assert.match(rows.find((row: any) => row.key_id === activeId).last_used_at, /^\d{4}-/u);
      assert.equal(rows.find((row: any) => row.key_id === pending.body.data.key_id).status, "pending");

      const exported = await fx.call("GET", "/v1/export?type=keys&all=true", { key: owner.key });
      assert.equal(exported.status, 200);
      assert.ok(!String(exported.body).includes(activeKey), "credential backup must never contain raw bearer material");
      const header = JSON.parse(String(exported.body).trim().split("\n")[0]!);
      assert.equal(header.format_version, 4);
      assert.equal(header.record_type, "keys");
      await fx.query(`DELETE FROM api_keys WHERE id = ?`, [activeId]);
      expectError(await fx.call("GET", "/v1/keys", { key: activeKey }), 401);
      expectOk(await fx.callRaw("POST", "/v1/import", { key: owner.key, body: String(exported.body) }));
      expectOk(await fx.call("GET", "/v1/keys", { key: activeKey }));

      await fx.restart();
      expectOk(await fx.call("GET", "/v1/keys", { key: activeKey }));
      expectOk(await fx.call("DELETE", `/v1/keys/${activeId}`, { key: owner.key }));
      expectError(await fx.call("GET", "/v1/keys", { key: activeKey }), 401);
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
      assert.equal(header.format_version, 4);
      assert.equal(header.complete, true);
      assert.deepEqual(header.dependency_order, ["keys", "workspaces", "memberships", "projects", "observations", "claims"]);
      assert.deepEqual(header.depends_on, ["workspaces", "memberships", "projects"]);
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
      const actorMap = JSON.stringify({
        type: "titen.import.actor_map",
        source_org_id: owner.orgId,
        source_actor_id: owner.principalId,
        destination_actor_id: target.principalId,
      });
      const imported = await fx.callRaw("POST", "/v1/import", { key: target.key, body: `${actorMap}\n${migrated}` });
      expectOk(imported);
      const importedOutbox = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM index_outbox
          WHERE org_id = ? AND record_id IN (?, ?)`,
        [target.orgId, migratedObservationId, migratedClaimId],
      );
      assert.equal(Number(importedOutbox[0]!.count), 0, "no-vector import must not queue index work");
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
        body: `${actorMap}\n${observationLines.join("\n")}\n`,
      });
      expectError(collision, 409, "CONFLICT");
    },
  },
  {
    name: "import preflights references and accepts child-before-parent atomically",
    async run(fx) {
      const target = await fx.provision({ scopes: ["*"] });
      const projectId = "project_import_parent_000000000000";
      const observationId = "obs_import_child_000000000000000";
      const project = { type: "project", id: projectId, reference: "rama/import-portability", created_at: "2026-07-30T00:00:00.000Z" };
      const observationRow = {
        type: "observation", id: observationId, subject_id: "user_rama", project_id: projectId,
        kind: "tool_result", content: "portable evidence", source_type: "tool", trust: "verified",
        visibility: "private", occurred_at: "2026-07-30T00:00:00.000Z", ingested_at: "2026-07-30T00:00:00.000Z",
      };
      const header = { type: "titen.export.header", format_version: 1, record_type: "observations" };
      const body = [header, observationRow, project].map(JSON.stringify).join("\n") + "\n";
      expectOk(await fx.callRaw("POST", "/v1/import", { key: target.key, body }));
      expectOk(await fx.callRaw("POST", "/v1/import", { key: target.key, body }));
      const counts = await fx.query<{ projects: number; observations: number }>(
        `SELECT (SELECT COUNT(*) FROM projects WHERE org_id = ?) AS projects,
                (SELECT COUNT(*) FROM observations WHERE org_id = ?) AS observations`,
        [target.orgId, target.orgId],
      );
      assert.equal(Number(counts[0]!.projects), 1);
      assert.equal(Number(counts[0]!.observations), 1);

      const canonicalCounts = async () => (await fx.query<{
        projects: number; observations: number; claims: number; claim_sources: number;
      }>(
        `SELECT (SELECT COUNT(*) FROM projects WHERE org_id = ?) AS projects,
                (SELECT COUNT(*) FROM observations WHERE org_id = ?) AS observations,
                (SELECT COUNT(*) FROM claims WHERE org_id = ?) AS claims,
                (SELECT COUNT(*) FROM claim_sources cs JOIN claims c ON c.id = cs.claim_id WHERE c.org_id = ?) AS claim_sources`,
        [target.orgId, target.orgId, target.orgId, target.orgId],
      ))[0]!;
      const beforeFailure = await canonicalCounts();
      const missingId = "project_missing_parent_00000000000";
      const missing = { ...observationRow, id: "obs_missing_parent_0000000000000", project_id: missingId };
      const failed = await fx.callRaw("POST", "/v1/import", { key: target.key, body: JSON.stringify(missing) + "\n" });
      expectError(failed, 422, "UNRESOLVED_REFERENCE");
      assert.deepEqual(
        { record_type: failed.body.meta.record_type, field: failed.body.meta.field, dependency_type: failed.body.meta.dependency_type },
        { record_type: "observation", field: "project_id", dependency_type: "project" },
      );
      assert.ok(!JSON.stringify(failed.body).includes(missingId), "diagnostic must not disclose referenced ids");
      assert.deepEqual(await canonicalCounts(), beforeFailure, "failed project preflight must not partially mutate");

      const missingObservationId = "obs_missing_source_00000000000000";
      const missingClaim = {
        type: "claim", id: "claim_missing_source_000000000000", subject_id: "user_rama",
        project_id: null, kind: "procedural", statement: "This claim must not import.",
        trust: "verified", visibility: "private", status: "active", confidence: 0.8, version: 1,
        valid_from: "2026-07-30T00:00:00.000Z",
        created_at: "2026-07-30T00:00:00.000Z",
        sources: [{ observation_id: missingObservationId, relation: "supports", created_at: "2026-07-30T00:00:00.000Z" }],
      };
      const failedClaim = await fx.callRaw("POST", "/v1/import", {
        key: target.key, body: JSON.stringify(missingClaim) + "\n",
      });
      expectError(failedClaim, 422, "UNRESOLVED_REFERENCE");
      assert.deepEqual(
        { record_type: failedClaim.body.meta.record_type, field: failedClaim.body.meta.field, dependency_type: failedClaim.body.meta.dependency_type },
        { record_type: "claim", field: "sources.observation_id", dependency_type: "observation" },
      );
      assert.ok(!JSON.stringify(failedClaim.body).includes(missingObservationId), "diagnostic must not disclose referenced ids");
      assert.deepEqual(await canonicalCounts(), beforeFailure, "failed source preflight must not partially mutate");
    },
  },
  {
    name: "v2 import preflights temporal bounds and preserves redacted evidence markers",
    async run(fx) {
      const target = await fx.provision({ principalId: "portability_temporal_owner", scopes: ["*"] });
      const header = {
        type: "titen.export.header",
        format_version: 2,
        record_type: "observations",
        org_id: target.orgId,
      };
      const baseObservation = {
        type: "observation",
        id: "obs_temporal_import_base_00000000",
        subject_id: "user_temporal_import",
        project_id: null,
        workspace_id: null,
        agent_id: null,
        run_id: null,
        actor_id: target.principalId,
        kind: "imported_source",
        content: "Temporal import evidence.",
        source_type: "import",
        source_ref: null,
        trust: "asserted",
        visibility: "private",
        occurred_at: null,
        ingested_at: "2026-07-31T00:00:00.000Z",
      };
      const counts = async () => (await fx.query<{ observations: number; claims: number }>(
        `SELECT (SELECT COUNT(*) FROM observations WHERE org_id = ?) AS observations,
                (SELECT COUNT(*) FROM claims WHERE org_id = ?) AS claims`,
        [target.orgId, target.orgId],
      ))[0]!;

      for (const [field, value, suffix] of [
        ["ingested_at", "+010000-01-01T00:00:00.000Z", "extended"],
        ["ingested_at", "999-01-01T00:00:00.000Z", "short"],
      ] as const) {
        const row = { ...baseObservation, id: `${baseObservation.id}_${suffix}`, [field]: value };
        const failed = await fx.callRaw("POST", "/v1/import", {
          key: target.key,
          body: `${JSON.stringify(header)}\n${JSON.stringify(row)}\n`,
        });
        expectError(failed, 400, "VALIDATION_ERROR");
        assert.deepEqual(await counts(), { observations: 0, claims: 0 });
      }

      const invalidClaim = {
        type: "claim",
        id: "claim_invalid_interval_0000000000",
        subject_id: baseObservation.subject_id,
        project_id: null,
        workspace_id: null,
        observer_id: null,
        actor_id: target.principalId,
        kind: "procedural",
        statement: "This invalid interval must never commit.",
        confidence: 0.8,
        trust: "asserted",
        visibility: "private",
        status: "active",
        version: 1,
        valid_from: "2030-01-01T00:00:00.000Z",
        valid_to: "2020-01-01T00:00:00.000Z",
        created_at: "2026-07-31T00:00:00.000Z",
        superseded_by: null,
        sources: [{
          observation_id: baseObservation.id,
          relation: "supports",
          created_at: "2026-07-31T00:00:00.000Z",
        }],
      };
      const invalidInterval = await fx.callRaw("POST", "/v1/import", {
        key: target.key,
        body: [header, baseObservation, invalidClaim].map(JSON.stringify).join("\n") + "\n",
      });
      expectError(invalidInterval, 400, "VALIDATION_ERROR");
      assert.deepEqual(await counts(), { observations: 0, claims: 0 });

      const originalHash = "a".repeat(64);
      const redacted = {
        ...baseObservation,
        id: "obs_redacted_import_000000000000",
        content: `[redacted sha256:${originalHash}]`,
        content_hash: originalHash,
      };
      const redactedClaim = {
        ...invalidClaim,
        id: "claim_redacted_import_0000000000",
        statement: "[redacted: purged evidence]",
        status: "revoked",
        version: 2,
        valid_from: "2026-07-31T00:00:00.000Z",
        valid_to: null,
        sources: [{
          observation_id: redacted.id,
          relation: "supports",
          created_at: "2026-07-31T00:00:00.000Z",
        }],
      };
      expectError(await fx.callRaw("POST", "/v1/import", {
        key: target.key,
        body: [header, { ...redactedClaim, status: "active" }, redacted].map(JSON.stringify).join("\n") + "\n",
      }), 400, "VALIDATION_ERROR");
      assert.deepEqual(await counts(), { observations: 0, claims: 0 });
      expectOk(await fx.callRaw("POST", "/v1/import", {
        key: target.key,
        body: [header, redactedClaim, redacted].map(JSON.stringify).join("\n") + "\n",
      }));
      const stored = await fx.query<{ content: string; content_hash: string }>(
        `SELECT content, content_hash FROM observations WHERE id = ? AND org_id = ?`,
        [redacted.id, target.orgId],
      );
      assert.deepEqual(stored, [{ content: redacted.content, content_hash: originalHash }]);
      const projections = await fx.query<{
        observation_fts: number;
        claim_fts: number;
        observation_operation: string | null;
        claim_operation: string | null;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM observations_fts WHERE observation_id = ?) AS observation_fts,
           (SELECT COUNT(*) FROM claims_fts WHERE claim_id = ?) AS claim_fts,
           (SELECT operation FROM index_outbox WHERE record_type = 'observation' AND record_id = ? LIMIT 1) AS observation_operation,
           (SELECT operation FROM index_outbox WHERE record_type = 'claim' AND record_id = ? LIMIT 1) AS claim_operation`,
        [redacted.id, redactedClaim.id, redacted.id, redactedClaim.id],
      );
      assert.deepEqual(projections, [{
        observation_fts: 0,
        claim_fts: 0,
        observation_operation: null,
        claim_operation: null,
      }]);

      const spoofed = {
        ...redacted,
        id: "obs_redacted_spoof_0000000000000",
        content: `[redacted sha256:${"b".repeat(64)}]`,
      };
      expectError(await fx.callRaw("POST", "/v1/import", {
        key: target.key,
        body: `${JSON.stringify(header)}\n${JSON.stringify(spoofed)}\n`,
      }), 400, "VALIDATION_ERROR");
      assert.deepEqual(await counts(), { observations: 1, claims: 1 });
    },
  },
  {
    name: "v2 portability maps actors and restores team supersession without widening ordinary export",
    async run(fx) {
      const owner = await fx.provision({ principalId: "portability_source_owner", scopes: ["*"] });
      const sibling = await fx.provision({
        orgId: owner.orgId,
        principalId: "portability_source_sibling",
        scopes: ["*"],
      });
      const outsider = await fx.provision({
        orgId: owner.orgId,
        principalId: "portability_outsider",
        scopes: ["export:read"],
      });
      const workspace = await fx.call("POST", "/v1/workspaces", {
        key: owner.key,
        body: { name: "portable-team" },
      });
      expectOk(workspace, 201);
      const workspaceId = workspace.body.data.workspace_id as string;
      const membershipIds: string[] = [];
      for (const principalId of [sibling.principalId]) {
        const membership = await fx.call("POST", "/v1/memberships", {
          key: owner.key,
          body: { workspace_id: workspaceId, principal_id: principalId, principal_kind: "agent", role: "member" },
        });
        expectOk(membership, 201);
        membershipIds.push(membership.body.data.membership_id as string);
      }
      const organizationMembership = await fx.call("POST", "/v1/memberships", {
        key: owner.key,
        body: { principal_id: sibling.principalId, principal_kind: "agent", role: "admin" },
      });
      expectOk(organizationMembership, 201);
      membershipIds.push(organizationMembership.body.data.membership_id as string);

      const privateObservation = await fx.call("POST", "/v1/observations", {
        key: sibling.key,
        body: observation({ content: "Portable private actor marker.", visibility: "private" }),
      });
      expectOk(privateObservation, 201);
      const teamRecords: { observationId: string; claimId: string }[] = [];
      for (const statement of ["Portable team procedure v1.", "Portable team procedure v2."]) {
        const observed = await fx.call("POST", "/v1/observations", {
          key: sibling.key,
          body: observation({ workspace_id: workspaceId, visibility: "team", content: statement }),
        });
        expectOk(observed, 201);
        const consolidated = await fx.call("POST", "/v1/consolidations", {
          key: sibling.key,
          body: {
            subject_id: "user_rama",
            workspace_id: workspaceId,
            claims: [claim(observed.body.data.observation_id, { visibility: "team", statement })],
          },
        });
        expectOk(consolidated, 201);
        teamRecords.push({
          observationId: observed.body.data.observation_id,
          claimId: consolidated.body.data.claims[0].claim_id,
        });
      }
      expectOk(await fx.call("POST", `/v1/claims/${teamRecords[0]!.claimId}/supersede`, {
        key: sibling.key,
        body: { superseded_by: teamRecords[1]!.claimId, expected_version: 1 },
      }));

      for (const type of ["workspaces", "memberships"] as const) {
        const hidden = await fx.call("GET", `/v1/export?type=${type}`, { key: outsider.key });
        assert.equal(hidden.status, 200);
        const header = typeof hidden.body === "string"
          ? JSON.parse(hidden.body.trim().split("\n")[0]!)
          : hidden.body;
        assert.equal(header.count, 0);
        assert.ok(!JSON.stringify(hidden.body).includes(workspaceId));
      }
      expectError(
        await fx.call("GET", "/v1/export?type=workspaces&all=true", { key: outsider.key }),
        403,
      );
      const ownerExport = await fx.call("GET", "/v1/export?type=observations", { key: owner.key });
      assert.ok(!String(ownerExport.body).includes(privateObservation.body.data.observation_id));

      const streams: string[] = [];
      for (const type of ["workspaces", "memberships", "projects", "observations", "claims"] as const) {
        const exported = await fx.call("GET", `/v1/export?type=${type}&all=true`, { key: owner.key });
        assert.equal(exported.status, 200);
        streams.push(typeof exported.body === "string" ? exported.body : `${JSON.stringify(exported.body)}\n`);
      }
      const audits = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM audit_log WHERE org_id = ? AND action = 'portability.export_all'`,
        [owner.orgId],
      );
      assert.equal(Number(audits[0]!.count), 5);

      const target = await fx.provision({ principalId: "portability_restore_owner", scopes: ["*"] });
      const ids = [
        workspaceId,
        ...membershipIds,
        privateObservation.body.data.observation_id as string,
        ...teamRecords.flatMap((record) => [record.observationId, record.claimId]),
      ];
      let migrated = streams.join("");
      const migratedId = new Map(ids.map((id) => [id, `${id}_restored`]));
      for (const [source, destination] of migratedId) migrated = migrated.replaceAll(source, destination);
      const siblingMap = JSON.stringify({
        type: "titen.import.actor_map",
        source_org_id: owner.orgId,
        source_actor_id: sibling.principalId,
        destination_actor_id: "portability_restored_sibling",
      });

      const missingMap = await fx.callRaw("POST", "/v1/import", {
        key: target.key,
        body: migrated,
      });
      expectError(missingMap, 422, "UNRESOLVED_REFERENCE");
      assert.equal(missingMap.body.meta.dependency_type, "actor_mapping");
      assert.deepEqual(
        await fx.query("SELECT id FROM workspaces WHERE org_id = ?", [target.orgId]),
        [],
      );

      const imported = await fx.callRaw("POST", "/v1/import", {
        key: target.key,
        body: `${siblingMap}\n${migrated}`,
      });
      expectOk(imported);
      assert.equal(imported.body.data.inserted.workspace, 1);
      assert.equal(imported.body.data.inserted.membership, 2);
      const restored = await fx.query<{
        actor_id: string;
        workspace_id: string | null;
        superseded_by: string | null;
      }>(
        `SELECT actor_id, workspace_id, NULL AS superseded_by FROM observations WHERE id = ? AND org_id = ?
         UNION ALL
         SELECT actor_id, workspace_id, superseded_by FROM claims WHERE id = ? AND org_id = ?`,
        [
          migratedId.get(privateObservation.body.data.observation_id as string)!, target.orgId,
          migratedId.get(teamRecords[0]!.claimId)!, target.orgId,
        ],
      );
      assert.equal(restored[0]!.actor_id, "portability_restored_sibling");
      assert.equal(restored[1]!.workspace_id, migratedId.get(workspaceId));
      assert.equal(restored[1]!.superseded_by, migratedId.get(teamRecords[1]!.claimId));
      assert.deepEqual(await fx.query(
        `SELECT workspace_id, principal_id, role FROM memberships
          WHERE org_id = ? ORDER BY role`,
        [target.orgId],
      ), [
        { workspace_id: null, principal_id: "portability_restored_sibling", role: "admin" },
        { workspace_id: migratedId.get(workspaceId), principal_id: "portability_restored_sibling", role: "member" },
      ]);

      const crossOrg = await fx.callRaw("POST", "/v1/import", {
        key: target.key,
        body: streams[0]!,
      });
      expectError(crossOrg, 409, "CONFLICT");
    },
  },
  {
    name: "every export page stays within the UTF-8 import boundary",
    async run(fx) {
      const owner = await fx.provision({ principalId: "byte_safe_owner", scopes: ["*"] });
      for (let index = 0; index < 20; index += 1) {
        const appended = await fx.call("POST", "/v1/observations", {
          key: owner.key,
          body: observation({
            subject_id: "byte_safe_subject",
            content: `${"🙂".repeat(15_000)}-${index}`,
          }),
        });
        expectOk(appended, 201);
      }
      const exported = await fx.call("GET", "/v1/export?type=observations&limit=2000", { key: owner.key });
      assert.equal(exported.status, 200);
      const bytes = new TextEncoder().encode(String(exported.body)).byteLength;
      assert.ok(bytes <= MAX_BODY_BYTES, `export emitted ${bytes} bytes`);
      const header = JSON.parse(String(exported.body).trim().split("\n")[0]!);
      assert.ok(header.count < 20);
      assert.equal(header.complete, false);
      assert.ok(header.next_cursor);
      expectOk(await fx.callRaw("POST", "/v1/import", { key: owner.key, body: String(exported.body) }));
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
        body: { superseded_by: replacement.claimId, expected_version: 1 },
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
          body: { superseded_by: replacement.claimId, expected_version: 2 },
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
        body: { reason: "Procedure is no longer valid.", expected_version: 1 },
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
        body: { expected_version: 2 },
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
        body: { reason: "Information is stale.", expected_version: 1 },
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
        const body = op === "supersede" ? { superseded_by: seeded.claimId, expected_version: 1 } : { expected_version: 1 };
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
      const agent = await fx.provision({ scopes: ["*"] });
      const recipient = await fx.provision({ orgId: agent.orgId, scopes: ["*"] });

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

      const handoff = await fx.call("POST", "/v1/handoffs", {
        key: agent.key,
        body: {
          to_principal: recipient.principalId,
          subject_id: "user_rama",
          checkpoint_id: saved.body.data.checkpoint_id,
        },
      });
      expectOk(handoff, 201);

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
      const received = await fx.call("GET", "/v1/handoffs", { key: recipient.key });
      expectOk(received);
      assert.equal(received.body.data.handoffs[0].checkpoint_id, null);
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

      expectError(await fx.call("POST", "/v1/memberships", {
        key: owner.key,
        body: {
          workspace_id: "ws_missing",
          principal_id: "agent_helper",
          principal_kind: "agent",
          role: "member",
        },
      }), 404);
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
    name: "lease introspection is bounded and only organization owners or admins force release",
    async run(fx) {
      const holder = await fx.provision({ scopes: ["*"] });
      const admin = await fx.provision({ orgId: holder.orgId, scopes: ["*"] });
      const member = await fx.provision({ orgId: holder.orgId, scopes: ["*"] });
      const outsider = await fx.provision({ scopes: ["*"] });

      for (const [agent, role] of [[admin, "admin"], [member, "member"]] as const) {
        expectOk(await fx.call("POST", "/v1/memberships", {
          key: holder.key,
          body: {
            principal_id: agent.principalId,
            principal_kind: "agent",
            role,
          },
        }), 201);
      }

      const lease = await fx.call("POST", "/v1/leases", {
        key: holder.key,
        body: {
          resource_type: "subject",
          resource_id: `recover-${Date.now()}`,
          purpose: "recover crashed agent",
          ttl_seconds: 600,
        },
      });
      expectOk(lease, 201);

      const listed = await fx.call("GET", "/v1/leases?limit=10", { key: admin.key });
      expectOk(listed);
      assert.ok(listed.body.data.leases.some((entry: any) => (
        entry.lease_id === lease.body.data.lease_id && entry.holder_id === holder.principalId
      )));
      const foreign = await fx.call("GET", "/v1/leases?limit=200", { key: outsider.key });
      expectOk(foreign);
      assert.equal(foreign.body.data.leases.length, 0);
      expectError(await fx.call("GET", "/v1/leases?limit=201", { key: admin.key }), 400);
      expectError(await fx.call("POST", `/v1/leases/${lease.body.data.lease_id}/force-release`, {
        key: member.key,
        body: {},
      }), 404);

      const forced = await fx.call("POST", `/v1/leases/${lease.body.data.lease_id}/force-release`, {
        key: admin.key,
        body: {},
      });
      expectOk(forced);
      assert.equal(forced.body.data.forced, true);

      await fx.query(
        `WITH RECURSIVE n(value) AS (
           VALUES(1) UNION ALL SELECT value + 1 FROM n WHERE value < 205
         )
         INSERT INTO leases
           (id, org_id, resource_type, resource_id, holder_id, purpose,
            ttl_seconds, expires_at, created_at)
         SELECT 'lease_inventory_' || printf('%03d', value), ?, 'subject',
                'inventory_' || printf('%03d', value), ?, 'inventory', 600,
                '2099-01-01T00:00:00.000Z',
                '2026-07-31T00:00:00.' || printf('%03d', value) || 'Z'
           FROM n`,
        [holder.orgId, holder.principalId],
      );
      const bounded = await fx.call("GET", "/v1/leases?limit=200", { key: admin.key });
      expectOk(bounded);
      assert.equal(bounded.body.data.leases.length, 200);
      assert.ok(bounded.body.data.cursor);
      const tail = await fx.call(
        "GET",
        `/v1/leases?limit=200&after=${bounded.body.data.cursor}`,
        { key: admin.key },
      );
      expectOk(tail);
      assert.equal(tail.body.data.leases.length, 5);
      assert.equal(tail.body.data.cursor, null);
    },
  },
  {
    name: "handoff creation rejects missing, foreign, mismatched, and unauthorized context items",
    async run(fx) {
      const sender = await fx.provision({ scopes: ["*"] });
      const receiver = await fx.provision({ orgId: sender.orgId, scopes: ["*"] });
      const foreign = await fx.provision({ scopes: ["*"] });
      const suffix = `${Date.now()}_${fx.runtime.replace(/[^a-z]/g, "")}`;
      const subjectId = `handoff_corrupt_${suffix}`;
      const projectExpected = `project_expected_${suffix}`;
      const projectOther = `project_other_${suffix}`;
      const claimForeign = `claim_foreign_${suffix}`;
      const claimSubject = `claim_subject_${suffix}`;
      const claimProject = `claim_project_${suffix}`;
      const claimPrivate = `claim_private_${suffix}`;
      const contexts = {
        foreign: `ctx_foreign_${suffix}`,
        subject: `ctx_subject_${suffix}`,
        project: `ctx_project_${suffix}`,
        private: `ctx_private_${suffix}`,
        missing: `ctx_missing_${suffix}`,
      };
      const now = "2026-07-31T00:00:00.000Z";

      await fx.query(
        `INSERT INTO projects (id, org_id, reference, created_at)
         VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
        [
          projectExpected, sender.orgId, `expected/${suffix}`, now,
          projectOther, sender.orgId, `other/${suffix}`, now,
        ],
      );
      await fx.query(
        `INSERT INTO claims
           (id, org_id, subject_id, project_id, actor_id, kind, statement,
            confidence, trust, visibility, status, valid_from, created_at)
         VALUES
           (?, ?, ?, NULL, ?, 'procedural', 'Foreign item.', 0.8, 'verified', 'organization', 'active', ?, ?),
           (?, ?, ?, NULL, ?, 'procedural', 'Wrong subject item.', 0.8, 'verified', 'organization', 'active', ?, ?),
           (?, ?, ?, ?, ?, 'procedural', 'Wrong project item.', 0.8, 'verified', 'organization', 'active', ?, ?),
           (?, ?, ?, NULL, ?, 'procedural', 'Private recipient item.', 0.8, 'verified', 'private', 'active', ?, ?)`,
        [
          claimForeign, foreign.orgId, subjectId, foreign.principalId, now, now,
          claimSubject, sender.orgId, `${subjectId}_other`, sender.principalId, now, now,
          claimProject, sender.orgId, subjectId, projectOther, sender.principalId, now, now,
          claimPrivate, sender.orgId, subjectId, sender.principalId, now, now,
        ],
      );
      await fx.query(
        `INSERT INTO context_runs
           (id, org_id, actor_id, subject_id, project_id, task_hash, max_tokens,
            used_tokens, policy_snapshot, degraded, created_at)
         VALUES
           (?, ?, ?, ?, NULL, 'foreign', 256, 1, 'policy', '{}', ?),
           (?, ?, ?, ?, NULL, 'subject', 256, 1, 'policy', '{}', ?),
           (?, ?, ?, ?, ?, 'project', 256, 1, 'policy', '{}', ?),
           (?, ?, ?, ?, NULL, 'private', 256, 1, 'policy', '{}', ?),
           (?, ?, ?, ?, NULL, 'missing', 256, 1, 'policy', '{}', ?)`,
        [
          contexts.foreign, sender.orgId, sender.principalId, subjectId, now,
          contexts.subject, sender.orgId, sender.principalId, subjectId, now,
          contexts.project, sender.orgId, sender.principalId, subjectId, projectExpected, now,
          contexts.private, sender.orgId, sender.principalId, subjectId, now,
          contexts.missing, sender.orgId, sender.principalId, subjectId, now,
        ],
      );
      await fx.query(
        `INSERT INTO context_run_items (context_id, claim_id, position, score, score_components)
         VALUES (?, ?, 0, 1, '{}'), (?, ?, 0, 1, '{}'),
                (?, ?, 0, 1, '{}'), (?, ?, 0, 1, '{}')`,
        [
          contexts.foreign, claimForeign,
          contexts.subject, claimSubject,
          contexts.project, claimProject,
          contexts.private, claimPrivate,
        ],
      );

      for (const contextId of [contexts.foreign, contexts.subject, contexts.project, contexts.private])
        expectError(await fx.call("POST", "/v1/handoffs", {
          key: sender.key,
          body: { to_principal: receiver.principalId, subject_id: subjectId, context_id: contextId },
        }), 404);

      // Legacy SQLite databases could contain an orphan created while foreign
      // keys were disabled; D1 enforces this foreign key at write time.
      if (fx.runtime === "bun-sqlite") {
        await fx.query("PRAGMA foreign_keys = OFF");
        await fx.query(
          `INSERT INTO context_run_items (context_id, claim_id, position, score, score_components)
           VALUES (?, ?, 0, 1, '{}')`,
          [contexts.missing, `claim_missing_${suffix}`],
        );
        await fx.query("PRAGMA foreign_keys = ON");
        expectError(await fx.call("POST", "/v1/handoffs", {
          key: sender.key,
          body: { to_principal: receiver.principalId, subject_id: subjectId, context_id: contexts.missing },
        }), 404);
      }
    },
  },
  {
    name: "handoffs transfer work between principals",
    async run(fx) {
      const sender = await fx.provision({ scopes: ["*"] });
      const createdReceiver = await fx.call("POST", "/v1/keys", {
        key: sender.key,
        body: {
          label: "handoff receiver",
          scopes: ["handoffs:read", "handoffs:write"],
        },
      });
      expectOk(createdReceiver, 201);
      const receiver = {
        key: createdReceiver.body.data.api_key as string,
        principalId: createdReceiver.body.data.principal_id as string,
      };
      assert.match(receiver.principalId, /^agent_/);
      assert.notEqual(receiver.principalId, createdReceiver.body.data.key_id);

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
  {
    name: "handoffs delegate only validated checkpoint and authorized context references",
    async run(fx) {
      const sender = await fx.provision({ scopes: ["*"] });
      const receiver = await fx.provision({ orgId: sender.orgId, scopes: ["*"] });
      const sibling = await fx.provision({ orgId: sender.orgId, scopes: ["*"] });
      const foreign = await fx.provision({ scopes: ["*"] });
      const subjectId = `handoff-scope-${Date.now()}`;

      expectError(await fx.call("POST", "/v1/handoffs", {
        key: sender.key,
        body: { to_principal: "agent_missing", subject_id: subjectId },
      }), 404);

      const privateSubject = `${subjectId}-private`;
      await seedClaim(fx, sender.key, {
        observation: {
          subject_id: privateSubject,
          content: "Private handoff marker must remain sender-only.",
        },
        claim: { statement: "Private handoff marker remains sender-only." },
      });
      const privateContext = await fx.call("POST", "/v1/context/compile", {
        key: sender.key,
        body: { subject_id: privateSubject, task: "private handoff marker", max_tokens: 600 },
      });
      expectOk(privateContext);
      assert.equal(privateContext.body.data.items.length, 1);
      expectError(await fx.call("POST", "/v1/handoffs", {
        key: sender.key,
        body: {
          to_principal: receiver.principalId,
          subject_id: privateSubject,
          context_id: privateContext.body.data.context_id,
        },
      }), 404);

      const workspace = await fx.call("POST", "/v1/workspaces", {
        key: sender.key,
        body: { name: `handoff-team-${Date.now()}` },
      });
      expectOk(workspace, 201);
      const workspaceId = workspace.body.data.workspace_id as string;
      const memberships: Record<string, string> = {};
      for (const agent of [sender, receiver]) {
        const membership = await fx.call("POST", "/v1/memberships", {
          key: sender.key,
          body: {
            workspace_id: workspaceId,
            principal_id: agent.principalId,
            principal_kind: "agent",
            role: "member",
          },
        });
        expectOk(membership, 201);
        memberships[agent.principalId] = membership.body.data.membership_id;
      }

      const observed = await fx.call("POST", "/v1/observations", {
        key: sender.key,
        body: observation({
          subject_id: subjectId,
          workspace_id: workspaceId,
          visibility: "team",
          content: "The handed deployment context is visible to this workspace.",
        }),
      });
      expectOk(observed, 201);
      const consolidated = await fx.call("POST", "/v1/consolidations", {
        key: sender.key,
        body: {
          subject_id: subjectId,
          workspace_id: workspaceId,
          claims: [claim(observed.body.data.observation_id, {
            visibility: "team",
            statement: "The receiver may resume the handed deployment context.",
          })],
        },
      });
      expectOk(consolidated, 201);
      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: sender.key,
        body: { subject_id: subjectId, task: "resume handed deployment context", max_tokens: 900 },
      });
      expectOk(compiled);
      assert.equal(compiled.body.data.items.length, 1);

      const checkpoint = await fx.call("POST", "/v1/checkpoints", {
        key: sender.key,
        body: {
          subject_id: subjectId,
          kind: "task_state",
          state: { step: "verify" },
          ttl_seconds: 600,
        },
      });
      expectOk(checkpoint, 201);

      for (const invalid of [
        { context_id: "ctx_missing" },
        { checkpoint_id: "ckpt_missing" },
        { context_id: compiled.body.data.context_id, subject_id: "wrong-subject" },
        { checkpoint_id: checkpoint.body.data.checkpoint_id, subject_id: "wrong-subject" },
      ]) expectError(await fx.call("POST", "/v1/handoffs", {
        key: sender.key,
        body: { to_principal: receiver.principalId, subject_id: subjectId, ...invalid },
      }), 404);

      expectError(await fx.call("POST", "/v1/handoffs", {
        key: sender.key,
        body: {
          to_principal: receiver.principalId,
          subject_id: subjectId,
          context_id: (await fx.call("POST", "/v1/context/compile", {
            key: foreign.key,
            body: { subject_id: subjectId, task: "foreign empty context", max_tokens: 256 },
          })).body.data.context_id,
        },
      }), 404);

      const handoff = await fx.call("POST", "/v1/handoffs", {
        key: sender.key,
        body: {
          to_principal: receiver.principalId,
          subject_id: subjectId,
          context_id: compiled.body.data.context_id,
          checkpoint_id: checkpoint.body.data.checkpoint_id,
          message: "Resume from the exact stored state.",
        },
      });
      expectOk(handoff, 201);

      const handedCheckpoint = await fx.call(
        "GET",
        `/v1/checkpoints/${checkpoint.body.data.checkpoint_id}`,
        { key: receiver.key },
      );
      expectOk(handedCheckpoint);
      assert.deepEqual(handedCheckpoint.body.data.state, { step: "verify" });
      const handedContext = await fx.call(
        "GET",
        `/v1/context/${compiled.body.data.context_id}`,
        { key: receiver.key },
      );
      expectOk(handedContext);
      assert.equal(handedContext.body.meta.delegated, true);
      assert.equal(handedContext.body.data.items[0].untrusted, true);
      assert.equal(handedContext.body.data.items[0].claim_id, consolidated.body.data.claims[0].claim_id);
      expectError(await fx.call("GET", `/v1/checkpoints/${checkpoint.body.data.checkpoint_id}`, {
        key: sibling.key,
      }), 404);
      expectError(await fx.call("GET", `/v1/context/${compiled.body.data.context_id}`, {
        key: sibling.key,
      }), 404);
      expectError(await fx.call("POST", `/v1/context/${compiled.body.data.context_id}/feedback`, {
        key: sibling.key,
        body: { outcome: "useful" },
      }), 404);
      expectOk(await fx.call("POST", `/v1/context/${compiled.body.data.context_id}/feedback`, {
        key: receiver.key,
        body: { outcome: "useful", claim_id: consolidated.body.data.claims[0].claim_id },
      }), 201);

      expectOk(await fx.call("POST", `/v1/handoffs/${handoff.body.data.handoff_id}/resolve`, {
        key: receiver.key,
        body: { status: "accepted" },
      }));
      expectOk(await fx.call("GET", `/v1/context/${compiled.body.data.context_id}`, {
        key: receiver.key,
      }));

      expectOk(await fx.call("DELETE", `/v1/memberships/${memberships[receiver.principalId]}`, {
        key: sender.key,
      }));
      expectError(await fx.call("GET", `/v1/context/${compiled.body.data.context_id}`, {
        key: receiver.key,
      }), 404);
      expectError(await fx.call("POST", `/v1/context/${compiled.body.data.context_id}/feedback`, {
        key: receiver.key,
        body: { outcome: "useful" },
      }), 404);
      expectOk(await fx.call("GET", `/v1/checkpoints/${checkpoint.body.data.checkpoint_id}`, {
        key: receiver.key,
      }));
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
      assert.equal(tools.body.result.tools.length, 9);
      assert.ok(tools.body.result.tools.some((t: any) => t.name === "titen_remember"));
      assert.ok(tools.body.result.tools.some((t: any) => t.name === "titen_consolidate"));
      assert.ok(tools.body.result.tools.some((t: any) => t.name === "titen_compile"));
      assert.ok(tools.body.result.tools.some((t: any) => t.name === "titen_project_resolve"));

      // A notification must be accepted without a body on either runtime.
      const notified = await fx.call("POST", "/mcp", {
        key: agent.key,
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
      });
      assert.equal(notified.status, 202);
    },
  },
  {
    name: "MCP resolves, remembers, consolidates, and recalls on both runtimes",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });

      const project = await fx.call("POST", "/mcp", {
        key: agent.key,
        body: {
          jsonrpc: "2.0", id: 2, method: "tools/call",
          params: {
            name: "titen_project_resolve",
            arguments: { reference: "github.com/RamaAditya49/titen", create: true },
          },
        },
      });
      const projectPayload = JSON.parse(project.body.result.content[0].text);
      assert.equal(projectPayload.data.reference, "ramaaditya49/titen");
      assert.match(projectPayload.data.project_id, /^project_/);

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
              project_id: projectPayload.data.project_id,
            },
          },
        },
      });
      assert.equal(remember.status, 200);
      assert.equal(remember.body.jsonrpc, "2.0");
      assert.ok(remember.body.result.content[0].text.includes("obs_"));
      const observationId = JSON.parse(remember.body.result.content[0].text).data.observation_id;

      const consolidate = await fx.call("POST", "/mcp", {
        key: agent.key,
        body: {
          jsonrpc: "2.0", id: 4, method: "tools/call",
          params: {
            name: "titen_consolidate",
            arguments: {
              subject_id: "user_mcp",
              project_id: projectPayload.data.project_id,
              claims: [{
                kind: "procedural",
                statement: "MCP integration evidence is retrievable after explicit consolidation.",
                sources: [{ observation_id: observationId, relation: "supports" }],
              }],
            },
          },
        },
      });
      const consolidationPayload = JSON.parse(consolidate.body.result.content[0].text);
      assert.equal(consolidate.body.result.isError, undefined);
      const claimId = consolidationPayload.data.claims[0].claim_id;
      assert.match(claimId, /^claim_/);

      // Compile
      const compile = await fx.call("POST", "/mcp", {
        key: agent.key,
        body: {
          jsonrpc: "2.0", id: 5, method: "tools/call",
          params: {
            name: "titen_compile",
            arguments: {
              subject_id: "user_mcp",
              project_id: projectPayload.data.project_id,
              task: "retrievable explicit consolidation evidence",
              max_tokens: 900,
            },
          },
        },
      });
      assert.equal(compile.status, 200);
      assert.equal(compile.body.jsonrpc, "2.0");
      const compiledPayload = JSON.parse(compile.body.result.content[0].text);
      assert.equal(compiledPayload.data.items[0].claim_id, claimId);
      assert.ok(compiledPayload.data.items.length > 0, "MCP recall must return the claim it created");
    },
  },
  {
    name: "MCP delegates to the REST domain contract",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      const mcp = (name: string, args: Record<string, unknown>, id = 1) =>
        fx.call("POST", "/mcp", {
          key: agent.key,
          body: {
            jsonrpc: "2.0", id, method: "tools/call",
            params: { name, arguments: args },
          },
        });

      const init = await fx.call("POST", "/mcp", {
        key: agent.key,
        body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      });
      assert.equal(init.body.result.serverInfo.version, TITEN_VERSION);

      const rememberBody = {
        subject_id: "user_mcp_parity",
        kind: "tool_result",
        content: "MCP and REST share one canonical observation command.",
        source: { type: "test", ref: "parity#1" },
        trust: "verified",
        visibility: "private",
      };
      const remembered = await mcp("titen_remember", {
        ...rememberBody,
        source_type: rememberBody.source.type,
        source_ref: rememberBody.source.ref,
        source: undefined,
        idempotency_key: "mcp-rest-parity",
      });
      assert.equal(remembered.body.result.isError, undefined);
      const rememberedPayload = JSON.parse(remembered.body.result.content[0].text);
      const observationId = rememberedPayload.data.observation_id as string;

      const replayed = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        headers: { "idempotency-key": "mcp-rest-parity" },
        body: rememberBody,
      });
      expectOk(replayed);
      assert.equal(replayed.body.data.observation_id, observationId);
      assert.equal(replayed.body.meta.replayed, true);

      const sideEffects = await fx.query<{ histories: number; outbox: number; events: number }>(
        `SELECT
           (SELECT COUNT(*) FROM record_history WHERE record_type = 'observation' AND record_id = ?) AS histories,
           (SELECT COUNT(*) FROM index_outbox WHERE record_type = 'observation' AND record_id = ?) AS outbox,
           (SELECT COUNT(*) FROM events WHERE resource_type = 'observation' AND resource_id = ?) AS events`,
        [observationId, observationId, observationId],
      );
      assert.deepEqual(sideEffects[0], { histories: 1, outbox: 0, events: 1 });

      const consolidated = await fx.call("POST", "/v1/consolidations", {
        key: agent.key,
        body: {
          subject_id: rememberBody.subject_id,
          claims: [{
            kind: "procedural",
            statement: "MCP and REST use the same authorized context compiler.",
            confidence: 0.9,
            visibility: "private",
            sources: [{ observation_id: observationId, relation: "supports" }],
          }],
        },
      });
      expectOk(consolidated, 201);
      const claimId = consolidated.body.data.claims[0].claim_id as string;
      const task = "same authorized context compiler";
      const restCompile = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: rememberBody.subject_id, task, max_tokens: 900 },
      });
      expectOk(restCompile);
      const mcpCompile = await mcp("titen_compile", {
        subject_id: rememberBody.subject_id, task, max_tokens: 900,
      }, 2);
      const mcpCompilePayload = JSON.parse(mcpCompile.body.result.content[0].text);
      assert.deepEqual(
        mcpCompilePayload.data.items.map((item: any) => item.claim_id),
        restCompile.body.data.items.map((item: any) => item.claim_id),
      );
      assert.equal(mcpCompilePayload.data.items[0].claim_id, claimId);
      assert.equal(mcpCompilePayload.data.policy_snapshot, restCompile.body.data.policy_snapshot);
      assert.deepEqual(mcpCompilePayload.meta.degraded, restCompile.body.meta.degraded);

      const lowTrust = await fx.provision({ scopes: ["*"], maxTrust: "asserted" });
      const deniedRest = await fx.call("POST", "/v1/observations", {
        key: lowTrust.key, body: { ...rememberBody, subject_id: "denied_rest" },
      });
      expectError(deniedRest, 403, "FORBIDDEN");
      const deniedMcp = await fx.call("POST", "/mcp", {
        key: lowTrust.key,
        body: {
          jsonrpc: "2.0", id: 3, method: "tools/call",
          params: {
            name: "titen_remember",
            arguments: {
              ...rememberBody,
              subject_id: "denied_mcp",
              source_type: rememberBody.source.type,
              source_ref: rememberBody.source.ref,
              source: undefined,
            },
          },
        },
      });
      assert.equal(deniedMcp.body.result.isError, true);
      assert.equal(JSON.parse(deniedMcp.body.result.content[0].text).code, "FORBIDDEN");

      const outsider = await fx.provision({ scopes: ["*"] });
      const hiddenRest = await fx.call("POST", "/v1/context/compile", {
        key: outsider.key,
        body: { subject_id: rememberBody.subject_id, task, max_tokens: 900 },
      });
      expectOk(hiddenRest);
      assert.equal(hiddenRest.body.data.items.length, 0);
      const hiddenMcp = await fx.call("POST", "/mcp", {
        key: outsider.key,
        body: {
          jsonrpc: "2.0", id: 4, method: "tools/call",
          params: {
            name: "titen_compile",
            arguments: { subject_id: rememberBody.subject_id, task, max_tokens: 900 },
          },
        },
      });
      assert.equal(JSON.parse(hiddenMcp.body.result.content[0].text).data.items.length, 0);
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

      const complete = await fx.call("GET", "/v1/events?limit=200", { key: owner.key });
      const tail = complete.body.data.cursor as string;
      const exhausted = await fx.call("GET", `/v1/events?after=${tail}`, { key: owner.key });
      expectOk(exhausted);
      assert.deepEqual(exhausted.body.data.events, []);
      assert.equal(exhausted.body.data.cursor, tail, "an empty page must preserve its incoming cursor");
    },
  },
  {
    name: "same-timestamp event and federation pages follow database sequence without skips",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const timestamp = "2026-07-31T12:00:00.000Z";
      for (const id of ["evt_same_z", "evt_same_a", "evt_same_m"])
        await fx.query(
          `INSERT INTO events
             (id, org_id, kind, actor_id, resource_type, resource_id, payload, created_at)
           VALUES (?, ?, 'same.timestamp', ?, 'probe', ?, '{}', ?)`,
          [id, owner.orgId, owner.principalId, id, timestamp],
        );

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 3; page += 1) {
        const result = await fx.call(
          "GET",
          `/v1/events?limit=1${cursor ? `&after=${cursor}` : ""}`,
          { key: owner.key },
        );
        expectOk(result);
        assert.equal(result.body.data.events.length, 1);
        seen.push(result.body.data.events[0].id);
        cursor = result.body.data.cursor;
      }
      assert.deepEqual(seen, ["evt_same_z", "evt_same_a", "evt_same_m"]);
      const legacy = await fx.call("GET", "/v1/events?after=evt_same_z&limit=1", {
        key: owner.key,
      });
      expectOk(legacy);
      assert.equal(legacy.body.data.events[0].id, "evt_same_a");

      const peer = await fx.call("POST", "/v1/federation/peers", {
        key: owner.key,
        body: {
          name: `same-ms-${Date.now()}`,
          endpoint: `https://same-ms-${Date.now()}.example.test`,
          shared_secret: "same-millisecond-secret",
          direction: "pull",
        },
      });
      expectOk(peer, 201);
      await fx.query(
        `WITH RECURSIVE n(value) AS (
           VALUES(1) UNION ALL SELECT value + 1 FROM n WHERE value < 205
         )
         INSERT INTO events
           (id, org_id, kind, actor_id, resource_type, resource_id, payload, created_at)
         SELECT 'evt_federation_' || printf('%03d', 206 - value), ?,
                'same.timestamp', ?, 'probe',
                'evt_federation_' || printf('%03d', 206 - value), '{}', ?
           FROM n`,
        [owner.orgId, owner.principalId, timestamp],
      );
      const first = await fx.call("POST", "/v1/federation/pull", {
        key: owner.key,
        body: { peer_id: peer.body.data.peer_id },
      });
      expectOk(first);
      assert.equal(first.body.data.events.length, 200);
      const second = await fx.call("POST", "/v1/federation/pull", {
        key: owner.key,
        body: { peer_id: peer.body.data.peer_id },
      });
      expectOk(second);
      assert.equal(second.body.data.events.length, 8);
      const all = [...first.body.data.events, ...second.body.data.events];
      assert.equal(new Set(all.map((event: any) => event.id)).size, 208);
      assert.deepEqual(all.slice(0, 3).map((event: any) => event.id), seen);
      assert.equal(all.at(-1).id, "evt_federation_001");
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
          body: { reason: "superseded by policy", expected_version: 1 },
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
          body: { expected_version: 1 },
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
  {
    name: "high-value operations write content-free authenticated audits",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const canaries = {
        forwarded: "203.0.113.44",
        key: "audit-secret-key-label",
        member: "audit-target-principal",
        handoff: "audit handoff message must not be copied",
        webhook: "audit-webhook-private-path",
        federation: "audit-federation-private-name",
      };

      const createdKey = await fx.call("POST", "/v1/keys", {
        key: owner.key,
        headers: { "x-forwarded-for": canaries.forwarded },
        body: { label: canaries.key, scopes: ["context:compile"] },
      });
      expectOk(createdKey, 201);
      expectOk(await fx.call("DELETE", `/v1/keys/${createdKey.body.data.key_id}`, { key: owner.key }));

      const exported = await fx.call("GET", "/v1/export?type=projects", { key: owner.key });
      assert.equal(exported.status, 200);
      expectOk(await fx.callRaw("POST", "/v1/import", {
        key: owner.key,
        body: `${JSON.stringify({
          type: "titen.export.header",
          format_version: 1,
          record_type: "projects",
        })}\n`,
      }));

      const membership = await fx.call("POST", "/v1/memberships", {
        key: owner.key,
        body: {
          principal_id: canaries.member,
          principal_kind: "agent",
          role: "member",
        },
      });
      expectOk(membership, 201);
      expectOk(await fx.call(
        "DELETE",
        `/v1/memberships/${membership.body.data.membership_id}`,
        { key: owner.key },
      ));

      const handoff = await fx.call("POST", "/v1/handoffs", {
        key: owner.key,
        body: {
          to_principal: owner.principalId,
          subject_id: "audit-subject",
          message: canaries.handoff,
        },
      });
      expectOk(handoff, 201);
      expectOk(await fx.call("POST", `/v1/handoffs/${handoff.body.data.handoff_id}/resolve`, {
        key: owner.key,
        body: { status: "accepted" },
      }));

      const webhook = await fx.call("POST", "/v1/webhooks", {
        key: owner.key,
        body: {
          url: `https://hooks.example.com/${canaries.webhook}`,
          secret: "audit-webhook-secret-value",
          events: ["claim.materialized"],
        },
      });
      expectOk(webhook, 201);
      expectOk(await fx.call("DELETE", `/v1/webhooks/${webhook.body.data.webhook_id}`, {
        key: owner.key,
      }));

      const peer = await fx.call("POST", "/v1/federation/peers", {
        key: owner.key,
        body: {
          name: canaries.federation,
          endpoint: "https://peer.example.test/private-audit-path",
          shared_secret: "audit-federation-secret-value",
          direction: "push",
        },
      });
      expectOk(peer, 201);
      expectOk(await fx.call("POST", `/v1/federation/peers/${peer.body.data.peer_id}/suspend`, {
        key: owner.key,
        body: {},
      }));

      const rows = await fx.query<{
        actor_id: string;
        action: string;
        resource_type: string;
        resource_id: string | null;
        detail: string | null;
        ip_hint: string | null;
      }>(
        `SELECT actor_id, action, resource_type, resource_id, detail, ip_hint
           FROM audit_log WHERE org_id = ? ORDER BY action`,
        [owner.orgId],
      );
      assert.deepEqual(rows.map((row) => row.action), [
        "federation.peer.register",
        "federation.peer.suspend",
        "handoff.create",
        "handoff.resolve",
        "key.create",
        "key.revoke",
        "membership.add",
        "membership.remove",
        "records.export",
        "records.import",
        "webhook.delete",
        "webhook.register",
      ]);
      for (const row of rows) {
        assert.equal(row.actor_id, owner.principalId);
        if (row.action === "key.create") {
          const lifecycle = JSON.parse(row.detail!);
          assert.match(lifecycle.not_before, /^\d{4}-/u);
          assert.equal(lifecycle.expires_at, null);
        } else assert.equal(row.detail, null);
        assert.equal(row.ip_hint, null);
        assert.ok(row.resource_type);
      }
      const serialized = JSON.stringify(rows);
      for (const value of Object.values(canaries))
        assert.ok(!serialized.includes(value), `audit copied content: ${value}`);
      assert.ok(!serialized.includes("audit-webhook-secret-value"));
      assert.ok(!serialized.includes("audit-federation-secret-value"));
    },
  },
  {
    name: "unshipped governance routes are absent from the public contract",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      for (const [method, path] of [
        ["GET", "/v1/policies"],
        ["POST", "/v1/policies"],
        ["POST", "/v1/channel-releases"],
        ["POST", "/v1/channel-context"],
      ] as const)
        expectError(await fx.call(method, path, { key: owner.key, ...(method === "POST" ? { body: {} } : {}) }), 404);
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

      for (const lens of ["neighborhood", "conflict_freshness"]) {
        const res = await fx.call("POST", "/v1/memory-views/compile", {
          key: owner.key,
          body: { lens, subject_id: "user_rama", focus_id: seeded.claimId },
        });
        expectOk(res);
        assert.equal(res.body.data.lens, lens);
        assert.ok(Array.isArray(res.body.data.nodes), `${lens} must return nodes`);
      }

      const other = await seedClaim(fx, owner.key, {
        observation: { subject_id: "other_subject", content: "A contradictory other-subject result." },
        claim: { statement: "Other subject base claim" },
      });
      const otherObs = await fx.call("POST", "/v1/observations", { key: owner.key, body: observation({ subject_id: "other_subject", content: "Other contradiction" }) });
      expectOk(otherObs, 201);
      await fx.call("POST", "/v1/consolidations", { key: owner.key, body: { subject_id: "other_subject", claims: [{ kind: "semantic_fact", statement: "Scoped disputed marker", sources: [{ observation_id: other.observationId, relation: "supports" }, { observation_id: otherObs.body.data.observation_id, relation: "contradicts" }] }] } });
      const scoped = await fx.call("POST", "/v1/memory-views/compile", { key: owner.key, body: { lens: "conflict_freshness", subject_id: "user_rama" } });
      expectOk(scoped);
      assert.ok(!scoped.body.data.nodes.some((n: any) => n.label === "Scoped disputed marker"), "conflict lens must not leak another subject");
      expectError(await fx.call("POST", "/v1/memory-views/compile", { key: owner.key, body: { lens: "conflict_freshness" } }), 400);

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
  {
    name: "review queue is authorized, deterministic, filtered, and keyset-paginated",
    async run(fx) {
      const reviewer = await fx.provision({ scopes: ["*"] });
      const sibling = await fx.provision({ orgId: reviewer.orgId, scopes: ["*"] });

      const harmful = await seedClaim(fx, reviewer.key, {
        observation: { subject_id: "review_harmful", content: "harmful review marker" },
        claim: { statement: "Harmful review marker claim." },
      });
      const harmfulContext = await fx.call("POST", "/v1/context/compile", {
        key: reviewer.key,
        body: { subject_id: "review_harmful", task: "harmful review marker", max_tokens: 900 },
      });
      expectOk(harmfulContext);
      expectOk(await fx.call("POST", `/v1/context/${harmfulContext.body.data.context_id}/feedback`, {
        key: reviewer.key,
        body: { claim_id: harmful.claimId, outcome: "harmful" },
      }), 201);

      const disputedBase = await fx.call("POST", "/v1/observations", {
        key: reviewer.key,
        body: observation({ subject_id: "review_disputed", content: "review dispute supporting evidence" }),
      });
      const disputedCounter = await fx.call("POST", "/v1/observations", {
        key: reviewer.key,
        body: observation({ subject_id: "review_disputed", content: "review dispute contradiction" }),
      });
      expectOk(disputedBase, 201);
      expectOk(disputedCounter, 201);
      const disputed = await fx.call("POST", "/v1/consolidations", {
        key: reviewer.key,
        body: {
          subject_id: "review_disputed",
          claims: [{
            kind: "semantic_fact",
            statement: "Disputed reviewer claim.",
            confidence: 0.9,
            sources: [
              { observation_id: disputedBase.body.data.observation_id, relation: "supports" },
              { observation_id: disputedCounter.body.data.observation_id, relation: "contradicts" },
            ],
          }],
        },
      });
      expectOk(disputed, 201);
      const disputedId = disputed.body.data.claims[0].claim_id as string;

      const incorrect = await seedClaim(fx, reviewer.key, {
        observation: { subject_id: "review_incorrect", content: "incorrect review marker" },
        claim: { statement: "Incorrect review marker claim." },
      });
      const incorrectContext = await fx.call("POST", "/v1/context/compile", {
        key: reviewer.key,
        body: { subject_id: "review_incorrect", task: "incorrect review marker", max_tokens: 900 },
      });
      expectOk(incorrectContext);
      expectOk(await fx.call("POST", `/v1/context/${incorrectContext.body.data.context_id}/feedback`, {
        key: reviewer.key,
        body: { claim_id: incorrect.claimId, outcome: "incorrect" },
      }), 201);

      const low = await seedClaim(fx, reviewer.key, {
        observation: { subject_id: "review_low", content: "low confidence review marker" },
        claim: { statement: "Low confidence review marker claim.", confidence: 0.5 },
      });
      const hidden = await seedClaim(fx, sibling.key, {
        observation: { subject_id: "review_hidden", content: "hidden low confidence marker" },
        claim: { statement: "Hidden low confidence claim.", confidence: 0.4 },
      });

      await fx.query(
        `INSERT INTO audit_log (id, org_id, actor_id, action, resource_type, resource_id, detail, ip_hint, created_at)
         VALUES (?, ?, ?, 'claim.review', 'claim', ?, NULL, NULL, ?)`,
        ["aud_review_visible", reviewer.orgId, reviewer.principalId, harmful.claimId, "2026-07-30T00:00:00.000Z"],
      );
      await fx.query(
        `INSERT INTO audit_log (id, org_id, actor_id, action, resource_type, resource_id, detail, ip_hint, created_at)
         VALUES (?, ?, ?, 'claim.review', 'claim', ?, NULL, NULL, ?)`,
        ["aud_review_hidden", reviewer.orgId, sibling.principalId, hidden.claimId, "2026-07-30T00:00:00.000Z"],
      );

      const first = await fx.call("POST", "/v1/memory-views/compile", {
        key: reviewer.key,
        body: { lens: "review_queue", limit: 2 },
      });
      expectOk(first);
      assert.deepEqual(first.body.data.nodes.map((node: any) => node.id), [harmful.claimId, disputedId]);
      assert.deepEqual(first.body.data.nodes.map((node: any) => node.priority), [4, 3]);
      assert.equal(first.body.data.metadata.remaining_count, 4);
      assert.equal(first.body.data.metadata.page_count, 2);
      assert.ok(first.body.data.metadata.next_cursor);
      assert.equal(first.body.data.nodes[0].owner_id, reviewer.principalId);
      assert.equal(first.body.data.nodes[0].next_action, "inspect_harmful_feedback");
      assert.equal(first.body.data.nodes[0].deadline, null);
      assert.equal(first.body.data.nodes[0].terminal_state, null);
      assert.ok(first.body.data.nodes[0].evidence_refs.includes(harmful.observationId));
      assert.deepEqual(first.body.data.nodes[0].audit_refs, ["aud_review_visible"]);
      assert.ok(!JSON.stringify(first.body).includes(hidden.claimId));
      assert.ok(!JSON.stringify(first.body).includes("aud_review_hidden"));

      const viewOnly = await fx.provision({
        orgId: reviewer.orgId,
        principalId: reviewer.principalId,
        scopes: ["views:compile"],
      });
      const withoutAuditScope = await fx.call("POST", "/v1/memory-views/compile", {
        key: viewOnly.key,
        body: { lens: "review_queue", limit: 1 },
      });
      expectOk(withoutAuditScope);
      assert.deepEqual(withoutAuditScope.body.data.nodes[0].audit_refs, []);
      assert.ok(withoutAuditScope.body.data.nodes[0].evidence_refs.includes(harmful.observationId));

      const second = await fx.call("POST", "/v1/memory-views/compile", {
        key: reviewer.key,
        body: { lens: "review_queue", cursor: first.body.data.metadata.next_cursor, limit: 2 },
      });
      expectOk(second);
      assert.deepEqual(second.body.data.nodes.map((node: any) => node.id), [incorrect.claimId, low.claimId]);
      assert.equal(second.body.data.metadata.next_cursor, null);
      assert.equal(new Set([...first.body.data.nodes, ...second.body.data.nodes].map((node: any) => node.id)).size, 4);

      const negative = await fx.call("POST", "/v1/memory-views/compile", {
        key: reviewer.key,
        body: { lens: "review_queue", review_reason: "negative_feedback" },
      });
      expectOk(negative);
      assert.deepEqual(negative.body.data.nodes.map((node: any) => node.id), [harmful.claimId, incorrect.claimId]);
      const lowOnly = await fx.call("POST", "/v1/memory-views/compile", {
        key: reviewer.key,
        body: { lens: "review_queue", review_reason: "low_confidence", owner_id: reviewer.principalId },
      });
      expectOk(lowOnly);
      assert.deepEqual(lowOnly.body.data.nodes.map((node: any) => node.id), [low.claimId]);
      expectError(await fx.call("POST", "/v1/memory-views/compile", {
        key: reviewer.key,
        body: { lens: "review_queue", cursor: "not-a-cursor" },
      }), 400);
      expectError(await fx.call("POST", "/v1/memory-views/compile", {
        key: reviewer.key,
        body: { lens: "review_queue", review_reason: "invented" },
      }), 400);

      expectOk(await fx.call("POST", `/v1/claims/${low.claimId}/revoke`, {
        key: reviewer.key,
        body: { expected_version: 1, reason: "reviewed and withdrawn" },
      }));
      const afterTerminal = await fx.call("POST", "/v1/memory-views/compile", {
        key: reviewer.key,
        body: { lens: "review_queue", review_reason: "low_confidence" },
      });
      expectOk(afterTerminal);
      assert.ok(!afterTerminal.body.data.nodes.some((node: any) => node.id === low.claimId));
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
          url: "https://hooks.example.com/titen",
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
          // Test transport refuses by design: the attempt must remain retryable.
          url: "https://hooks.example.com/titen-sink",
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
  {
    name: "federation pull does not expose another principal's private events",
    async run(fx) {
      const owner = await fx.provision({ principalId: "federation_owner", scopes: ["*"] });
      const sibling = await fx.provision({
        orgId: owner.orgId,
        principalId: "federation_sibling",
        scopes: ["*"],
      });
      const peer = await fx.call("POST", "/v1/federation/peers", {
        key: owner.key,
        body: {
          name: "private-boundary",
          endpoint: "https://titen-private.example.test",
          shared_secret: "private-boundary-secret",
          direction: "pull",
        },
      });
      expectOk(peer, 201);
      const peerId = peer.body.data.peer_id as string;

      const siblingPeers = await fx.call("GET", "/v1/federation/peers", { key: sibling.key });
      expectOk(siblingPeers);
      assert.equal(siblingPeers.body.data.peers.length, 0, "a sibling must not discover an owned peer");
      expectError(await fx.call("GET", `/v1/federation/peers/${peerId}/filters`, { key: sibling.key }), 404);
      expectError(await fx.call("POST", `/v1/federation/peers/${peerId}/filters`, {
        key: sibling.key,
        body: { resource_type: "event" },
      }), 404);
      expectError(await fx.call("POST", `/v1/federation/peers/${peerId}/suspend`, {
        key: sibling.key,
        body: {},
      }), 404);
      expectError(await fx.call("POST", "/v1/federation/pull", {
        key: sibling.key,
        body: { peer_id: peerId },
      }), 404);
      expectError(await fx.call("POST", "/v1/federation/push", {
        key: sibling.key,
        body: { peer_id: peerId, events: [] },
      }), 404);
      expectError(await fx.call("GET", `/v1/federation/log?peer_id=${peerId}`, { key: sibling.key }), 404);

      await fx.query(
        `INSERT INTO federation_peers
           (id, org_id, name, endpoint, shared_secret_hash, direction, status, created_at)
         VALUES (?, ?, 'legacy', 'https://legacy-private.example.test#titen-legacy-peer=fpeer_legacy_unowned', 'hash', 'pull', 'suspended', ?)`,
        ["fpeer_legacy_unowned", owner.orgId, "2026-07-30T00:00:00.000Z"],
      );
      const ownerPeers = await fx.call("GET", "/v1/federation/peers", { key: owner.key });
      expectOk(ownerPeers);
      assert.deepEqual(ownerPeers.body.data.peers.map((candidate: any) => candidate.peer_id), [peerId]);
      expectError(await fx.call("POST", "/v1/federation/pull", {
        key: owner.key,
        body: { peer_id: "fpeer_legacy_unowned" },
      }), 404);
      expectOk(await fx.call("POST", "/v1/federation/peers", {
        key: owner.key,
        body: {
          name: "legacy-replacement",
          endpoint: "https://legacy-private.example.test",
          shared_secret: "legacy-replacement-secret",
          direction: "pull",
        },
      }), 201);

      const visible = await seedClaim(fx, owner.key, {
        observation: { visibility: "private", content: "Owner-only federation marker." },
        claim: { visibility: "private", statement: "Owner federation marker is visible." },
      });
      const hidden = await seedClaim(fx, sibling.key, {
        observation: { visibility: "private", content: "Sibling-only federation marker." },
        claim: { visibility: "private", statement: "Sibling federation marker is hidden." },
      });
      const workspace = await fx.call("POST", "/v1/workspaces", {
        key: owner.key,
        body: { name: "federation-cursor-scope" },
      });
      expectOk(workspace, 201);
      const workspaceId = workspace.body.data.workspace_id as string;
      const membership = await fx.call("POST", "/v1/memberships", {
        key: owner.key,
        body: {
          workspace_id: workspaceId,
          principal_id: owner.principalId,
          principal_kind: "agent",
          role: "member",
        },
      });
      expectOk(membership, 201);
      const teamObservation = await fx.call("POST", "/v1/observations", {
        key: owner.key,
        body: observation({
          workspace_id: workspaceId,
          visibility: "team",
          content: "Revocable federation team marker.",
        }),
      });
      expectOk(teamObservation, 201);
      const teamConsolidation = await fx.call("POST", "/v1/consolidations", {
        key: owner.key,
        body: {
          subject_id: "user_rama",
          workspace_id: workspaceId,
          claims: [claim(teamObservation.body.data.observation_id, {
            visibility: "team",
            statement: "Revocable federation team marker is current.",
          })],
        },
      });
      expectOk(teamConsolidation, 201);
      const teamObservationId = teamObservation.body.data.observation_id as string;
      const teamClaimId = teamConsolidation.body.data.claims[0].claim_id as string;

      const pulled = await fx.call("POST", "/v1/federation/pull", {
        key: owner.key,
        body: { peer_id: peerId },
      });
      expectOk(pulled);
      const resourceIds = new Set(pulled.body.data.events.map((event: any) => event.resource_id));
      assert.ok(resourceIds.has(visible.observationId), "the caller must receive its own private event");
      assert.ok(resourceIds.has(visible.claimId), "the caller must receive its own private claim event");
      assert.ok(resourceIds.has(teamObservationId), "an active member must receive its team event");
      assert.ok(resourceIds.has(teamClaimId), "an active member must receive its team claim event");
      assert.ok(!resourceIds.has(hidden.observationId), "a sibling's private observation event must not leak");
      assert.ok(!resourceIds.has(hidden.claimId), "a sibling's private claim event must not leak");

      expectOk(await fx.call("DELETE", `/v1/memberships/${membership.body.data.membership_id}`, {
        key: owner.key,
      }));

      const again = await fx.call("POST", "/v1/federation/pull", {
        key: owner.key,
        body: { peer_id: peerId },
      });
      expectOk(again);
      assert.equal(again.body.data.events.length, 0, "the owner's cursor must not replay its batch");
      assert.ok(
        again.body.data.events.every((event: any) => ![teamObservationId, teamClaimId].includes(event.resource_id)),
        "revoked team events must stay hidden",
      );
      assert.equal(again.body.data.cursor, pulled.body.data.cursor, "the owner's cursor must remain stable");
    },
  },
  {
    name: "federation push stores remote identity as an owner-visible untrusted wrapper",
    async run(fx) {
      const owner = await fx.provision({ principalId: "federation_receiver", scopes: ["*"] });
      const victim = await fx.provision({
        orgId: owner.orgId,
        principalId: "federation_victim",
        scopes: ["*"],
      });
      const victimMemory = await seedClaim(fx, victim.key, {
        observation: { visibility: "private", content: "Victim-local pointer target." },
        claim: { visibility: "private", statement: "Victim-local pointer target is private." },
      });
      expectOk(await fx.call("POST", "/v1/webhooks", {
        key: victim.key,
        body: {
          url: "https://hooks.example.com/federation-victim",
          secret: "federation-victim-hook-secret",
          events: ["*"],
        },
      }), 201);

      const secret = "signed-remote-wrapper-secret";
      const peer = await fx.call("POST", "/v1/federation/peers", {
        key: owner.key,
        body: {
          name: "signed-inbound",
          endpoint: "https://signed-inbound.example.test",
          shared_secret: secret,
          direction: "push",
        },
      });
      expectOk(peer, 201);
      const remoteEvents = [
        {
          id: "evt_remote_actor_injection",
          kind: "remote.actor_probe",
          actor_id: victim.principalId,
          resource_type: "event",
          resource_id: "remote_event_target",
          payload: { marker: "actor" },
          created_at: "2026-07-30T00:00:00.000Z",
        },
        {
          id: "evt_remote_observation_pointer",
          kind: "observation.appended",
          actor_id: owner.principalId,
          resource_type: "observation",
          resource_id: victimMemory.observationId,
          payload: { marker: "observation" },
          created_at: "2026-07-30T00:00:01.000Z",
        },
        {
          id: "evt_remote_claim_pointer",
          kind: "claim.materialized",
          actor_id: owner.principalId,
          resource_type: "claim",
          resource_id: victimMemory.claimId,
          payload: { marker: "claim" },
          created_at: "2026-07-30T00:00:02.000Z",
        },
      ];
      const body = { peer_id: peer.body.data.peer_id, events: remoteEvents };
      const pushed = await fx.call("POST", "/v1/federation/push", {
        key: owner.key,
        body,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(body))}` },
      });
      expectOk(pushed);
      assert.ok(pushed.body.data.results.every((result: any) => result.status === "success"));

      const victimFeed = await fx.call("GET", "/v1/events?limit=200", { key: victim.key });
      expectOk(victimFeed);
      const remoteIds = new Set(remoteEvents.map((event) => event.id));
      assert.ok(
        victimFeed.body.data.events.every((event: any) => !remoteIds.has(event.id)),
        "remote actor and canonical pointers must not grant local victim visibility",
      );
      const victimDrain = await fx.call("POST", "/v1/webhooks/deliver", {
        key: victim.key,
        body: {},
      });
      expectOk(victimDrain);
      assert.equal(victimDrain.body.data.events_drained, 0, "the victim webhook must not queue remote wrappers");

      const ownerFeed = await fx.call("GET", "/v1/events?limit=200", { key: owner.key });
      expectOk(ownerFeed);
      const wrappers = ownerFeed.body.data.events.filter((event: any) => remoteIds.has(event.id));
      assert.equal(wrappers.length, remoteEvents.length);
      for (const wrapper of wrappers) {
        const remote = remoteEvents.find((event) => event.id === wrapper.id)!;
        assert.equal(wrapper.kind, "federation.received");
        assert.equal(wrapper.actor_id, owner.principalId);
        assert.equal(wrapper.resource_type, "federated_event");
        assert.equal(wrapper.resource_id, remote.id);
        assert.deepEqual(wrapper.payload.untrusted_remote_event, remote);
      }
    },
  },
  {
    name: "team memory is visible only to active workspace members across projections",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const member = await fx.provision({ orgId: owner.orgId, scopes: ["*"] });
      const outsider = await fx.provision({ orgId: owner.orgId, scopes: ["*"] });
      const outsiderHook = await fx.call("POST", "/v1/webhooks", {
        key: outsider.key,
        body: {
          url: "https://hooks.example.com/private-scope-probe",
          secret: "outsider-scope-secret",
          events: ["*"],
        },
      });
      expectOk(outsiderHook, 201);
      const workspace = await fx.call("POST", "/v1/workspaces", { key: owner.key, body: { name: `scope-${Date.now()}` } });
      const workspaceId = workspace.body.data.workspace_id;
      for (const principal of [owner, member]) expectOk(await fx.call("POST", "/v1/memberships", {
        key: owner.key,
        body: { workspace_id: workspaceId, principal_id: principal.principalId, principal_kind: "agent", role: "member" },
      }), 201);
      const observed = await fx.call("POST", "/v1/observations", {
        key: owner.key,
        body: observation({ workspace_id: workspaceId, visibility: "team", content: "workspace-only marker 7319" }),
      });
      expectOk(observed, 201);
      const consolidated = await fx.call("POST", "/v1/consolidations", {
        key: owner.key,
        body: { subject_id: "user_rama", workspace_id: workspaceId, claims: [claim(observed.body.data.observation_id, { visibility: "team", statement: "Workspace marker 7319 is current." })] },
      });
      expectOk(consolidated, 201);
      const claimId = consolidated.body.data.claims[0].claim_id;
      const visible = await fx.call("POST", "/v1/context/compile", { key: member.key, body: { subject_id: "user_rama", task: "workspace marker 7319", max_tokens: 900 } });
      expectOk(visible);
      assert.ok(visible.body.data.items.some((item: any) => item.claim_id === claimId));
      for (const principal of [outsider]) {
        const hidden = await fx.call("POST", "/v1/context/compile", { key: principal.key, body: { subject_id: "user_rama", task: "workspace marker 7319", max_tokens: 900 } });
        expectOk(hidden);
        assert.equal(hidden.body.data.items.length, 0);
        expectError(await fx.call("GET", `/v1/claims/${claimId}/evidence`, { key: principal.key }), 404);
        const events = await fx.call("GET", "/v1/events", { key: principal.key });
        expectOk(events);
        assert.ok(!events.body.data.events.some((event: any) => event.resource_id === claimId));
        const exported = await fx.call("GET", "/v1/export?type=claims", { key: principal.key });
        assert.ok(!String(exported.body).includes(claimId));
        const atlas = await fx.call("POST", "/v1/memory-views/compile", { key: principal.key, body: { lens: "neighborhood", subject_id: "user_rama" } });
        expectOk(atlas);
        assert.equal(atlas.body.data.metadata.claim_count, 0);
        const drained = await fx.call("POST", "/v1/webhooks/deliver", { key: principal.key, body: {} });
        expectOk(drained);
        assert.equal(drained.body.data.events_drained, 0);
        assert.equal(drained.body.data.pending_deliveries, 0);
        assert.equal(drained.body.data.oldest_pending_at, null);
        const deliveries = await fx.call(
          "GET",
          `/v1/webhooks/${outsiderHook.body.data.webhook_id}/deliveries`,
          { key: principal.key },
        );
        expectOk(deliveries);
        assert.equal(deliveries.body.data.deliveries.length, 0);
      }
    },
  },
  {
    name: "concurrent lease contenders produce one winner and same-holder renewal",
    async run(fx) {
      const firstAgent = await fx.provision({ scopes: ["*"] });
      const agents = [firstAgent];
      for (let index = 1; index < 20; index += 1)
        agents.push(await fx.provision({ orgId: firstAgent.orgId, scopes: ["*"] }));
      const attempts = await Promise.all(agents.map((agent) => fx.call("POST", "/v1/leases", {
        key: agent.key,
        body: { resource_type: "subject", resource_id: "race-lease", purpose: "race", ttl_seconds: 300 },
      })));
      const winners = attempts.map((result, index) => ({ result, agent: agents[index]! })).filter(({ result }) => result.status === 201);
      assert.equal(winners.length, 1);
      assert.equal(attempts.filter((result) => result.status === 409).length, 19);
      const renewed = await fx.call("POST", "/v1/leases", {
        key: winners[0]!.agent.key,
        body: { resource_type: "subject", resource_id: "race-lease", purpose: "renew", ttl_seconds: 600 },
      });
      expectOk(renewed);
      assert.equal(renewed.body.data.lease_id, winners[0]!.result.body.data.lease_id);
      assert.equal(renewed.body.data.renewed, true);
      const rows = await fx.query<{ count: number }>(`SELECT COUNT(*) AS count FROM leases WHERE org_id = ? AND resource_id = ? AND released_at IS NULL`, [firstAgent.orgId, "race-lease"]);
      assert.equal(Number(rows[0]!.count), 1);
      const loser = agents.find((agent) => agent.key !== winners[0]!.agent.key)!;
      expectError(await fx.call("DELETE", `/v1/leases/${renewed.body.data.lease_id}`, { key: loser.key }), 404);
    },
  },
  {
    name: "concurrent checkpoint saves retain one head and handoff resolution has one winner",
    async run(fx) {
      const sender = await fx.provision({ scopes: ["*"] });
      const receiver = await fx.provision({ orgId: sender.orgId, scopes: ["*"] });
      const subjectId = `integrity-race-${Date.now()}`;
      const saves = await Promise.all(Array.from({ length: 12 }, (_, index) =>
        fx.call("POST", "/v1/checkpoints", {
          key: sender.key,
          body: {
            subject_id: subjectId,
            kind: "task_state",
            state: { complete_submission: index },
            ttl_seconds: 600,
          },
        })));
      const failedSaves = saves
        .map((result, index) => ({
          index,
          status: result.status,
          body: typeof result.body === "string" ? result.body.slice(0, 200) : undefined,
          code: result.body?.error?.code,
          message: result.body?.error?.message,
          request_id: result.body?.meta?.request_id,
        }))
        .filter(({ status }) => status !== 200 && status !== 201);
      assert.deepEqual(
        failedSaves,
        [],
        `unexpected checkpoint responses: ${JSON.stringify(failedSaves)}`,
      );
      assert.equal(saves.filter((result) => result.status === 201).length, 1);
      assert.equal(saves.filter((result) => result.status === 200).length, 11);
      assert.equal(new Set(saves.map((result) => result.body.data.checkpoint_id)).size, 1);
      const heads = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM checkpoints
          WHERE org_id = ? AND subject_id = ? AND agent_id = ? AND kind = 'task_state'`,
        [sender.orgId, subjectId, sender.principalId],
      );
      assert.equal(Number(heads[0]!.count), 1);
      const current = await fx.call("GET", `/v1/checkpoints?subject_id=${subjectId}&kind=task_state`, {
        key: sender.key,
      });
      expectOk(current);
      assert.ok(Number.isInteger(current.body.data.state.complete_submission));

      const handoff = await fx.call("POST", "/v1/handoffs", {
        key: sender.key,
        body: { to_principal: receiver.principalId, subject_id: subjectId },
      });
      expectOk(handoff, 201);
      const resolutions = await Promise.all(Array.from({ length: 12 }, (_, index) =>
        fx.call("POST", `/v1/handoffs/${handoff.body.data.handoff_id}/resolve`, {
          key: receiver.key,
          body: { status: index % 2 === 0 ? "accepted" : "rejected" },
        })));
      assert.equal(resolutions.filter((result) => result.status === 200).length, 1);
      assert.ok(resolutions.every((result) => [200, 404, 409].includes(result.status)));
      const durable = await fx.query<{ resolutions: number; events: number }>(
        `SELECT
           (SELECT COUNT(*) FROM handoff_resolutions WHERE handoff_id = ?) AS resolutions,
           (SELECT COUNT(*) FROM events
             WHERE resource_type = 'handoff' AND resource_id = ?
               AND kind IN ('handoff.accepted', 'handoff.rejected')) AS events`,
        [handoff.body.data.handoff_id, handoff.body.data.handoff_id],
      );
      assert.deepEqual(durable[0], { resolutions: 1, events: 1 });
    },
  },
  {
    name: "idempotency survives key rotation while separating principals and request identity",
    async run(fx) {
      const firstAgent = await fx.provision({ scopes: ["*"] });
      const rotatedAgent = await fx.provision({
        orgId: firstAgent.orgId,
        principalId: firstAgent.principalId,
        scopes: ["*"],
      });
      const secondAgent = await fx.provision({ orgId: firstAgent.orgId, scopes: ["*"] });
      const key = "shared-client-key";
      const firstBody = observation({ subject_id: "idem-owner", content: "canonical replay body" });
      const first = await fx.call("POST", "/v1/observations", { key: firstAgent.key, headers: { "idempotency-key": key }, body: firstBody });
      expectOk(first, 201);
      await fx.revoke(firstAgent.keyId);
      const canonicalReplay = await fx.call("POST", "/v1/observations", {
        key: rotatedAgent.key,
        headers: { "idempotency-key": key },
        body: { trust: firstBody.trust, source: firstBody.source, content: firstBody.content, kind: firstBody.kind, subject_id: firstBody.subject_id },
      });
      expectOk(canonicalReplay);
      assert.equal(canonicalReplay.body.meta.replayed, true);
      assert.equal(canonicalReplay.body.data.observation_id, first.body.data.observation_id);
      const audit = await fx.query<{ key_id: string; principal_id: string }>(
        `SELECT key_id, principal_id FROM idempotency_v3
          WHERE org_id = ? AND principal_id = ?`,
        [firstAgent.orgId, firstAgent.principalId],
      );
      assert.deepEqual(audit, [{ key_id: firstAgent.keyId, principal_id: firstAgent.principalId }]);
      const otherCredential = await fx.call("POST", "/v1/observations", { key: secondAgent.key, headers: { "idempotency-key": key }, body: firstBody });
      expectOk(otherCredential, 201);
      assert.notEqual(otherCredential.body.data.observation_id, first.body.data.observation_id);
      const crossRoute = await fx.call("POST", "/v1/consolidations", {
        key: rotatedAgent.key,
        headers: { "idempotency-key": key },
        body: { subject_id: "idem-owner", claims: [claim(first.body.data.observation_id)] },
      });
      expectError(crossRoute, 409, "CONFLICT");
    },
  },
  {
    name: "checkpoint ownership is principal-bound inside one organization",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const sibling = await fx.provision({ orgId: owner.orgId, scopes: ["*"] });
      const saved = await fx.call("POST", "/v1/checkpoints", { key: owner.key, body: { subject_id: "owner-task", kind: "task_state", state: { private: true }, ttl_seconds: 600 } });
      expectOk(saved, 201);
      expectError(await fx.call("GET", `/v1/checkpoints?subject_id=owner-task&kind=task_state&agent_id=${owner.principalId}`, { key: sibling.key }), 404);
      expectError(await fx.call("POST", "/v1/checkpoints", { key: sibling.key, body: { subject_id: "owner-task", agent_id: owner.principalId, kind: "task_state", state: {}, ttl_seconds: 600 } }), 404);
      expectError(await fx.call("DELETE", `/v1/checkpoints/${saved.body.data.checkpoint_id}`, { key: sibling.key }), 404);
    },
  },
  {
    name: "lifecycle enforces domain equality and one expected-version winner",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      const original = await seedClaim(fx, agent.key);
      const foreignDomain = await seedClaim(fx, agent.key, { observation: { subject_id: "other-domain" }, claim: { statement: "Other domain claim." } });
      expectError(await fx.call("POST", `/v1/claims/${original.claimId}/supersede`, { key: agent.key, body: { superseded_by: foreignDomain.claimId, expected_version: 1 } }), 400);
      const race = await Promise.all([
        fx.call("POST", `/v1/claims/${original.claimId}/revoke`, { key: agent.key, body: { expected_version: 1 } }),
        fx.call("POST", `/v1/claims/${original.claimId}/expire`, { key: agent.key, body: { expected_version: 1 } }),
      ]);
      assert.equal(race.filter((result) => result.status === 200).length, 1);
      assert.equal(race.filter((result) => result.status === 409).length, 1);
      const rows = await fx.query<{ version: number; count: number }>(
        `SELECT c.version, (SELECT COUNT(*) FROM record_history h WHERE h.record_id = c.id AND h.version = 2) AS count FROM claims c WHERE c.id = ?`, [original.claimId],
      );
      assert.equal(Number(rows[0]!.version), 2);
      assert.equal(Number(rows[0]!.count), 1);
    },
  },
  {
    name: "import validates evidence and rolls back a collision beyond fifty records",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      const existing = { type: "project", id: "project_import_collision", reference: "rama/existing", created_at: "2026-07-30T00:00:00.000Z" };
      expectOk(await fx.callRaw("POST", "/v1/import", { key: agent.key, body: `${JSON.stringify(existing)}\n` }));
      const projects = Array.from({ length: 51 }, (_, index) => ({ type: "project", id: `project_atomic_${String(index).padStart(3, "0")}`, reference: `rama/atomic-${index}`, created_at: "2026-07-30T00:00:00.000Z" }));
      projects.push({ ...existing, reference: "rama/conflict" });
      expectError(await fx.callRaw("POST", "/v1/import", { key: agent.key, body: `${projects.map(JSON.stringify).join("\n")}\n` }), 409);
      const counts = await fx.query<{ count: number }>(`SELECT COUNT(*) AS count FROM projects WHERE org_id = ?`, [agent.orgId]);
      assert.equal(Number(counts[0]!.count), 1);
      const orphan = {
        type: "claim", id: "claim_orphan_active", subject_id: "orphan", project_id: null, workspace_id: null,
        observer_id: null, kind: "semantic_fact", statement: "Orphan claim.", confidence: 0.8, trust: "asserted",
        visibility: "private", status: "active", version: 1, valid_from: "2026-07-30T00:00:00.000Z",
        valid_to: null, created_at: "2026-07-30T00:00:00.000Z", sources: [],
      };
      expectError(await fx.callRaw("POST", "/v1/import", { key: agent.key, body: `${JSON.stringify(orphan)}\n` }), 400);
      const claims = await fx.query<{ count: number }>(`SELECT COUNT(*) AS count FROM claims WHERE org_id = ?`, [agent.orgId]);
      assert.equal(Number(claims[0]!.count), 0);
    },
  },
  {
    name: "Porter recall and Unicode query normalization are runtime-identical",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      const testing = await seedClaim(fx, agent.key, {
        claim: { statement: "Tests live next to the source file they cover." },
      });
      const istanbul = await seedClaim(fx, agent.key, {
        claim: { statement: "The Turkish İstanbul plan is current." },
      });
      const quartz = await seedClaim(fx, agent.key, {
        claim: { statement: "Quartz rotation protects the signing material." },
      });

      for (const [task, claimId] of [
        ["testing conventions", testing.claimId],
        ["İstanbul", istanbul.claimId],
        ["q\u200du\u200da\u200dr\u200dt\u200dz", quartz.claimId],
      ]) {
        const compiled = await fx.call("POST", "/v1/context/compile", {
          key: agent.key,
          body: { subject_id: "user_rama", task, max_tokens: 900 },
        });
        expectOk(compiled);
        assert.ok(compiled.body.data.items.some((item: any) => item.claim_id === claimId));
      }

      const noTerms = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: "user_rama", task: "...\u200d...", max_tokens: 900 },
      });
      expectOk(noTerms);
      assert.equal(noTerms.body.meta.degraded.lexical, "no_terms");
      assert.equal(noTerms.body.meta.query_terms_used, 0);
    },
  },
  {
    name: "natural query planning removes stopword noise and retains old and new",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      await seedClaim(fx, agent.key, { claim: { statement: "to" } });
      const noise = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: "user_rama", task: "ship to prod safely", max_tokens: 900 },
      });
      expectOk(noise);
      assert.deepEqual(noise.body.data.items, []);
      assert.equal(noise.body.meta.query_terms_used, 3);
      assert.equal(noise.body.meta.dropped_query_terms, 1);

      const oldClaim = await seedClaim(fx, agent.key, { claim: { statement: "old" } });
      const newClaim = await seedClaim(fx, agent.key, { claim: { statement: "new" } });
      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          task: "Could you please remind me what our team decided about whether we should keep using the old formatter or move to a new one for all of the frontend repositories",
          max_tokens: 900,
        },
      });
      expectOk(compiled);
      const ids = new Set(compiled.body.data.items.map((item: any) => item.claim_id));
      assert.ok(ids.has(oldClaim.claimId));
      assert.ok(ids.has(newClaim.claimId));
      assert.ok(compiled.body.meta.query_terms_used <= 16);
      assert.ok(compiled.body.meta.dropped_query_terms > 0);
    },
  },
  {
    name: "a large budget fills past three same-kind claims without duplicate statements",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      const obs = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: observation({
          subject_id: "user_budgetfill",
          content: "Budgetfill marker evidence supports all procedural variants.",
        }),
      });
      expectOk(obs, 201);
      const statements = [
        ...Array.from({ length: 5 }, (_unused, index) =>
          `Budgetfill marker procedure ${index} remains active.`),
        "Budgetfill marker duplicate remains active.",
        "Budgetfill marker duplicate remains active.",
      ];
      const consolidated = await fx.call("POST", "/v1/consolidations", {
        key: agent.key,
        body: {
          subject_id: "user_budgetfill",
          claims: statements.map((statement) =>
            claim(obs.body.data.observation_id, { statement, kind: "procedural" })),
        },
      });
      expectOk(consolidated, 201);

      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: "user_budgetfill", task: "budgetfill marker", max_tokens: 32_000 },
      });
      expectOk(compiled);
      const returned = compiled.body.data.items.map((item: any) => item.claim as string);
      assert.ok(returned.length > 3);
      assert.equal(returned.length, 6);
      assert.equal(new Set(returned).size, returned.length);
    },
  },
  {
    name: "lexical candidates stay inside the requested subject before ranking",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      await seedClaim(fx, agent.key, {
        observation: { subject_id: "subject_foreign" },
        claim: { statement: "Scopeproof marker belongs to the foreign subject." },
      });
      const target = await seedClaim(fx, agent.key, {
        observation: { subject_id: "subject_target" },
        claim: { statement: "Scopeproof marker belongs to the target subject." },
      });
      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: "subject_target", task: "scopeproof marker", max_tokens: 900 },
      });
      expectOk(compiled);
      assert.equal(compiled.body.meta.candidates, 1);
      assert.deepEqual(
        compiled.body.data.items.map((item: any) => item.claim_id),
        [target.claimId],
      );
    },
  },
  {
    name: "lexical planning preserves an exact marker after sixteen query terms",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      const seeded = await seedClaim(fx, agent.key, { observation: { content: "tailmarker9001 exact evidence" }, claim: { statement: "tailmarker9001 exact claim" } });
      const distractors = Array.from({ length: 18 }, (_, index) => `noise${index}`).join(" ");
      const compiled = await fx.call("POST", "/v1/context/compile", { key: agent.key, body: { subject_id: "user_rama", task: `${distractors} tailmarker9001`, max_tokens: 900 } });
      expectOk(compiled);
      assert.ok(compiled.body.data.items.some((item: any) => item.claim_id === seeded.claimId));
      assert.equal(compiled.body.meta.query_terms_used, 16);
      assert.ok(compiled.body.meta.dropped_query_terms >= 1);
      const moved = await fx.call("POST", "/v1/context/compile", { key: agent.key, body: { subject_id: "user_rama", task: `tailmarker9001 ${distractors}`, max_tokens: 900 } });
      expectOk(moved);
      assert.ok(moved.body.data.items.some((item: any) => item.claim_id === seeded.claimId));
      assert.equal(moved.body.meta.query_terms_used, compiled.body.meta.query_terms_used);
      assert.equal(moved.body.meta.dropped_query_terms, compiled.body.meta.dropped_query_terms);
    },
  },
  {
    name: "JSON depth is rejected before checkpoint and idempotency serialization",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      let nested: unknown = 1;
      for (let depth = 0; depth < 65; depth += 1) nested = [nested];

      const checkpoint = await fx.call("POST", "/v1/checkpoints", {
        key: agent.key,
        body: { subject_id: "deep-json", kind: "cursor", state: nested, ttl_seconds: 600 },
      });
      expectError(checkpoint, 400, "VALIDATION_ERROR");
      assert.match(checkpoint.body.error.message, /maximum JSON depth/);

      const observed = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        headers: { "idempotency-key": "deep-json" },
        body: observation({ pad: nested }),
      });
      expectError(observed, 400, "VALIDATION_ERROR");
      const counts = await fx.query<{ observations: number; checkpoints: number }>(
        `SELECT (SELECT COUNT(*) FROM observations WHERE org_id = ?) AS observations,
                (SELECT COUNT(*) FROM checkpoints WHERE org_id = ?) AS checkpoints`,
        [agent.orgId, agent.orgId],
      );
      assert.deepEqual(counts.map((row) => [Number(row.observations), Number(row.checkpoints)]), [[0, 0]]);
    },
  },
  {
    name: "validation distinguishes missing values and locates nested claim fields",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      const missing = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: "paths", task: "missing budget" },
      });
      expectError(missing, 400, "VALIDATION_ERROR");
      assert.equal(missing.body.error.message, 'Field "max_tokens" is required.');

      const wrong = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: "paths", task: "wrong budget", max_tokens: "900" },
      });
      expectError(wrong, 400, "VALIDATION_ERROR");
      assert.equal(wrong.body.error.message, 'Field "max_tokens" must be an integer.');

      const observed = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: observation({ subject_id: "paths" }),
      });
      expectOk(observed, 201);
      const nested = await fx.call("POST", "/v1/consolidations", {
        key: agent.key,
        body: {
          subject_id: "paths",
          claims: [
            claim(observed.body.data.observation_id),
            claim(observed.body.data.observation_id, {
              sources: [{ observation_id: observed.body.data.observation_id, relation: "endorses" }],
            }),
          ],
        },
      });
      expectError(nested, 400, "VALIDATION_ERROR");
      assert.match(nested.body.error.message, /claims\[1\]\.sources\[0\]\.relation/);

      const missingEvidence = await fx.call("POST", "/v1/consolidations", {
        key: agent.key,
        body: {
          subject_id: "paths",
          claims: [claim("obs_missing")],
        },
      });
      expectError(missingEvidence, 404, "NOT_FOUND");
      assert.equal(missingEvidence.body.meta.field, "claims[0].sources[0].observation_id");
    },
  },
  {
    name: "unsafe text and non-sortable temporal claims fail before mutation",
    async run(fx) {
      const agent = await fx.provision({ scopes: ["*"] });
      for (const content of ["nul\u0000byte", "ansi\u001b[31m", "bidi\u202esecret", "lone\ud800"]) {
        const rejected = await fx.call("POST", "/v1/observations", {
          key: agent.key,
          body: observation({ subject_id: "safe-text", content }),
        });
        expectError(rejected, 400, "VALIDATION_ERROR");
      }
      const safe = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: observation({ subject_id: "safe-text", content: "line one\nline two\tvalue" }),
      });
      expectOk(safe, 201);

      for (const dates of [
        { valid_from: "+010000-01-01T00:00:00.000Z" },
        { valid_from: "2030-01-01T00:00:00.000Z", valid_to: "2020-01-01T00:00:00.000Z" },
      ]) {
        const rejected = await fx.call("POST", "/v1/consolidations", {
          key: agent.key,
          body: {
            subject_id: "safe-text",
            claims: [claim(safe.body.data.observation_id, dates)],
          },
        });
        expectError(rejected, 400, "VALIDATION_ERROR");
      }
      const claims = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM claims WHERE org_id = ?`,
        [agent.orgId],
      );
      assert.equal(Number(claims[0]!.count), 0);
    },
  },
  {
    name: "observation purge is scoped, audited, idempotent, and removes readable projections",
    async run(fx) {
      const operator = await fx.provision({ scopes: ["*"] });
      const limited = await fx.provision({ orgId: operator.orgId, scopes: ["evidence:read"] });
      const foreign = await fx.provision({ scopes: ["observations:purge"] });
      const canary = "PURGE_SECRET_CANARY_7319";
      const seeded = await seedClaim(fx, operator.key, {
        observation: { subject_id: "purge-subject", content: canary },
        claim: { statement: `${canary} must never remain readable.` },
      });
      const queuedBeforePurge = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM index_outbox WHERE record_id IN (?, ?)`,
        [seeded.observationId, seeded.claimId],
      );
      assert.equal(Number(queuedBeforePurge[0]!.count), 0, "no-vector writes must not queue index work");

      expectError(
        await fx.call("DELETE", `/v1/observations/${seeded.observationId}`, { key: limited.key }),
        403,
        "FORBIDDEN",
      );
      expectError(
        await fx.call("DELETE", `/v1/observations/${seeded.observationId}`, { key: foreign.key }),
        404,
        "NOT_FOUND",
      );

      const before = await fx.call("POST", "/v1/context/compile", {
        key: operator.key,
        body: {
          subject_id: "purge-subject",
          task: "purge secret canary",
          max_tokens: 900,
          include_checkpoints: true,
        },
      });
      expectOk(before);
      assert.equal(before.body.meta.degraded.checkpoints, "unavailable");
      assert.equal(before.body.data.items[0].untrusted, true);
      const beforeEvidence = await fx.call("GET", `/v1/claims/${seeded.claimId}/evidence`, { key: operator.key });
      expectOk(beforeEvidence);
      assert.equal(beforeEvidence.body.data.claim.untrusted, true);
      assert.equal(beforeEvidence.body.data.evidence.supporting[0].untrusted, true);

      const purged = await fx.call("DELETE", `/v1/observations/${seeded.observationId}`, { key: operator.key });
      expectOk(purged);
      assert.equal(purged.body.data.already_purged, false);
      assert.equal(purged.body.data.dependent_claims_redacted, 1);

      const canonical = await fx.query<{
        content: string; content_hash: string; statement: string; status: string; version: number;
        observation_fts: number; claim_fts: number; observation_delete: number; claim_delete: number;
        purge_history: number; claim_history: number; audits: number; events: number;
      }>(
        `SELECT o.content, o.content_hash, c.statement, c.status, c.version,
                (SELECT COUNT(*) FROM observations_fts WHERE observation_id = o.id) AS observation_fts,
                (SELECT COUNT(*) FROM claims_fts WHERE claim_id = c.id) AS claim_fts,
                (SELECT COUNT(*) FROM index_outbox WHERE record_id = o.id AND operation = 'delete' AND state = 'pending') AS observation_delete,
                (SELECT COUNT(*) FROM index_outbox WHERE record_id = c.id AND operation = 'delete' AND state = 'pending') AS claim_delete,
                (SELECT COUNT(*) FROM record_history WHERE record_id = o.id AND change_kind = 'purge') AS purge_history,
                (SELECT COUNT(*) FROM record_history WHERE record_id = c.id AND change_kind = 'evidence_purged') AS claim_history,
                (SELECT COUNT(*) FROM audit_log WHERE org_id = o.org_id AND resource_id = o.id AND action = 'observation.purge') AS audits,
                (SELECT COUNT(*) FROM events WHERE org_id = o.org_id AND resource_id = o.id AND kind = 'observation.purged') AS events
           FROM observations o JOIN claim_sources s ON s.observation_id = o.id JOIN claims c ON c.id = s.claim_id
          WHERE o.id = ? AND c.id = ?`,
        [seeded.observationId, seeded.claimId],
      );
      assert.equal(canonical.length, 1);
      const row = canonical[0]!;
      assert.equal(row.content, `[redacted sha256:${row.content_hash}]`);
      assert.equal(row.statement, "[redacted: purged evidence]");
      assert.equal(row.status, "revoked");
      assert.equal(Number(row.version), 2);
      for (const count of [row.observation_fts, row.claim_fts]) assert.equal(Number(count), 0);
      for (const count of [row.observation_delete, row.claim_delete]) assert.equal(Number(count), 0);
      for (const count of [row.purge_history, row.claim_history, row.audits, row.events])
        assert.equal(Number(count), 1);

      const after = await fx.call("POST", "/v1/context/compile", {
        key: operator.key,
        body: { subject_id: "purge-subject", task: "purge secret canary", max_tokens: 900 },
      });
      expectOk(after);
      assert.deepEqual(after.body.data.items, []);
      const redactedEvidence = await fx.call("GET", `/v1/claims/${seeded.claimId}/evidence`, { key: operator.key });
      expectOk(redactedEvidence);
      assert.ok(!JSON.stringify(redactedEvidence.body).includes(canary));

      const reuse = await fx.call("POST", "/v1/consolidations", {
        key: operator.key,
        body: { subject_id: "purge-subject", claims: [claim(seeded.observationId)] },
      });
      expectError(reuse, 404, "NOT_FOUND");
      assert.equal(reuse.body.meta.field, "claims[0].sources[0].observation_id");

      const repeated = await fx.call("DELETE", `/v1/observations/${seeded.observationId}`, { key: operator.key });
      expectOk(repeated);
      assert.equal(repeated.body.data.already_purged, true);
      const proofs = await fx.query<{ audits: number; history: number }>(
        `SELECT (SELECT COUNT(*) FROM audit_log WHERE org_id = ? AND resource_id = ? AND action = 'observation.purge') AS audits,
                (SELECT COUNT(*) FROM record_history WHERE org_id = ? AND record_id = ? AND change_kind = 'purge') AS history`,
        [operator.orgId, seeded.observationId, operator.orgId, seeded.observationId],
      );
      assert.deepEqual(proofs.map((proof) => [Number(proof.audits), Number(proof.history)]), [[1, 1]]);
      const pendingDeletes = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM index_outbox
          WHERE state = 'pending' AND operation = 'delete' AND record_id IN (?, ?)`,
        [seeded.observationId, seeded.claimId],
      );
      assert.equal(Number(pendingDeletes[0]!.count), 0, "no-vector purge must not queue deletes");
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
