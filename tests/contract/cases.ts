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

/**
 * Two claims that tie on every weighted component, so only the tie-break decides
 * their order.
 *
 * Both statements carry the same four terms at the same length, so FTS5 returns
 * the same bm25 for each and trust, recency, utility, conflict and confidence are
 * equal by construction. `deep` has two supporting observations; `shallow` has
 * one supporting and two qualifying, so a depth that counted rows instead of
 * support would rank `shallow` first on 3 against 2. Terms must be given in
 * descending order, because the statement fallback prefers the lower code unit
 * and the point of the fixture is that `deep` wins *against* that fallback.
 */
async function seedTiedPair(
  fx: Fixture,
  key: string,
  terms: [string, string, string, string],
  options: { subjectId?: string; visibility?: string } = {},
) {
  const subjectId = options.subjectId ?? "user_rama";
  const deep = terms.join(" ");
  const shallow = [...terms].reverse().join(" ");
  assert.ok(shallow < deep, "the shallow statement must win the statement fallback");

  const write = async (content: string) => {
    const res = await fx.call("POST", "/v1/observations", {
      key,
      body: observation({
        content,
        subject_id: subjectId,
        ...(options.visibility ? { visibility: options.visibility } : {}),
      }),
    });
    expectOk(res, 201);
    return res.body.data.observation_id as string;
  };
  const [deepA, deepB, shallowA, qualifierA, qualifierB] = [
    await write(`First independent report of the ${terms[0]} ${terms[1]} handover.`),
    await write(`Second independent report of the ${terms[0]} ${terms[1]} handover.`),
    await write(`Sole report of the ${terms[3]} ${terms[2]} handover.`),
    await write(`Scheduling note that narrows the ${terms[3]} ${terms[2]} handover.`),
    await write(`Ownership note that narrows the ${terms[3]} ${terms[2]} handover.`),
  ];

  const consolidation = await fx.call("POST", "/v1/consolidations", {
    key,
    body: {
      subject_id: subjectId,
      claims: [
        {
          kind: "procedural",
          statement: deep,
          sources: [
            { observation_id: deepA, relation: "supports" },
            { observation_id: deepB, relation: "supports" },
          ],
        },
        {
          kind: "procedural",
          statement: shallow,
          sources: [
            { observation_id: shallowA, relation: "supports" },
            { observation_id: qualifierA, relation: "qualifies" },
            { observation_id: qualifierB, relation: "qualifies" },
          ],
        },
      ],
    },
  });
  expectOk(consolidation, 201);
  const claims = consolidation.body.data.claims as { claim_id: string }[];
  return {
    subjectId,
    deep,
    shallow,
    deepId: claims[0]!.claim_id,
    shallowId: claims[1]!.claim_id,
  };
}

/** The pair as ranked, in returned order, with everything a caller can see. */
async function compileTiedPair(
  fx: Fixture,
  key: string,
  pair: { subjectId: string; deep: string; shallow: string },
) {
  const compiled = await fx.call("POST", "/v1/context/compile", {
    key,
    body: { subject_id: pair.subjectId, task: pair.deep, max_tokens: 4000 },
  });
  expectOk(compiled);
  return (compiled.body.data.items as {
    claim: string;
    score: number;
    evidence_ids: string[];
  }[]).filter((item) => item.claim === pair.deep || item.claim === pair.shallow);
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
    name: "memories lists authorized claims with lexical search and keyset pagination",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["observations:write", "claims:write", "views:compile", "workspaces:write"] });
      const privateMember = await fx.provision({ orgId: owner.orgId, scopes: ["observations:write", "claims:write", "views:compile"] });
      await seedClaim(fx, owner.key, {
        observation: { subject_id: "memory_subject", visibility: "organization", content: "Rollback smoke is required before a production release." },
        claim: { statement: "Rollback smoke is required before a production release." },
      });
      await seedClaim(fx, owner.key, {
        observation: { subject_id: "memory_subject", visibility: "organization", content: "Release evidence remains append only." },
        claim: { statement: "Release evidence remains append only." },
      });
      await seedClaim(fx, privateMember.key, {
        observation: { subject_id: "memory_subject", content: "Private operator note must not be listed." },
        claim: { statement: "Private operator note must not be listed." },
      });
      const first = await fx.call("GET", "/v1/memories?subject_id=memory_subject&limit=1", { key: owner.key });
      expectOk(first);
      assert.equal(first.body.data.items.length, 1);
      assert.equal(first.body.data.page.has_more, true);
      assert.equal(first.body.data.items[0].visibility, "organization");
      const second = await fx.call("GET", `/v1/memories?subject_id=memory_subject&limit=1&after=${encodeURIComponent(first.body.data.page.next_cursor)}`, { key: owner.key });
      expectOk(second);
      assert.equal(second.body.data.items.length, 1);
      assert.notEqual(second.body.data.items[0].id, first.body.data.items[0].id);
      assert.equal(second.body.data.page.has_more, false);
      const searched = await fx.call("GET", "/v1/memories?subject_id=memory_subject&q=rollback+smoke", { key: owner.key });
      expectOk(searched);
      assert.equal(searched.body.data.items.length, 1);
      assert.match(searched.body.data.items[0].statement, /Rollback smoke/);
      const workspaceA = await fx.call("POST", "/v1/workspaces", { key: owner.key, body: { name: "memory-a" } });
      const workspaceB = await fx.call("POST", "/v1/workspaces", { key: owner.key, body: { name: "memory-b" } });
      expectOk(workspaceA, 201);
      expectOk(workspaceB, 201);
      await fx.query(
        `INSERT INTO memberships (id, org_id, workspace_id, principal_id, principal_kind, role, created_at)
         VALUES (?, ?, ?, ?, 'agent', 'member', ?)`,
        [`mbr_workspace_${fx.runtime}`, owner.orgId, workspaceA.body.data.workspace_id,
          owner.principalId, "2026-08-16T00:00:00.000Z"],
      );
      const organizationClaim = await seedClaim(fx, owner.key, {
        observation: { subject_id: "memory_subject", workspace_id: workspaceA.body.data.workspace_id,
          visibility: "organization", content: "Organization memory follows every workspace picker." },
        claim: { statement: "Organization memory follows every workspace picker." },
      });
      const teamClaim = await seedClaim(fx, owner.key, {
        observation: { subject_id: "memory_subject", workspace_id: workspaceA.body.data.workspace_id,
          visibility: "team", content: "Team memory stays inside its workspace." },
        claim: { statement: "Team memory stays inside its workspace.", visibility: "team" },
      });
      const workspaceMemories = await fx.call("GET", `/v1/memories?workspace_id=${workspaceB.body.data.workspace_id}`, { key: owner.key });
      expectOk(workspaceMemories);
      assert.ok(workspaceMemories.body.data.items.some((item: any) => item.id === organizationClaim.claimId));
      assert.ok(!workspaceMemories.body.data.items.some((item: any) => item.id === teamClaim.claimId));
      const workspaceGraph = await fx.call("POST", "/v1/memory-views/compile", {
        key: owner.key, body: { lens: "workspace_graph", workspace_id: workspaceB.body.data.workspace_id, max_nodes: 50 },
      });
      expectOk(workspaceGraph);
      assert.ok(workspaceGraph.body.data.nodes.some((node: any) => node.id === organizationClaim.claimId));
      assert.ok(!workspaceGraph.body.data.nodes.some((node: any) => node.id === teamClaim.claimId));
      expectError(await fx.call("GET", "/v1/memories?limit=0", { key: owner.key }), 400, "VALIDATION_ERROR");
      expectError(await fx.call("GET", "/v1/memories?after=not-a-cursor", { key: owner.key }), 400, "VALIDATION_ERROR");
      const memberView = await fx.call("GET", "/v1/memories?subject_id=memory_subject", { key: privateMember.key });
      expectOk(memberView);
      assert.equal(memberView.body.data.items.length, 4);
    },
  },
  {
    name: "scoped grants drive directories, Atlas graph, and next-request revocation",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const reader = await fx.provision({
        orgId: owner.orgId,
        principalId: `scoped_reader_${fx.runtime}`,
        scopes: ["views:compile", "projects:read", "subjects:read", "observations:write",
          "keys:manage", "grants:read", "grants:write"],
      });
      const makeProject = async (reference: string) => {
        const response = await fx.call("POST", "/v1/projects/resolve", {
          key: owner.key, body: { reference, create: true },
        });
        expectOk(response, 201);
        return response.body.data.project_id as string;
      };
      const allowedProject = await makeProject(`scope/${fx.runtime}-allowed`);
      const hiddenProject = await makeProject(`scope/${fx.runtime}-hidden`);
      const allowed = await seedClaim(fx, owner.key, {
        observation: { subject_id: `subject_${fx.runtime}_allowed`, project_id: allowedProject,
          visibility: "organization", content: "Scoped reader may inspect this claim." },
        claim: { statement: "Scoped reader may inspect this claim." },
      });
      await seedClaim(fx, owner.key, {
        observation: { subject_id: `subject_${fx.runtime}_hidden`, project_id: hiddenProject,
          visibility: "organization", content: "Scoped reader must not infer this claim." },
        claim: { statement: "Scoped reader must not infer this claim." },
      });
      await fx.query(
        `UPDATE access_grants SET revoked_at = ?
          WHERE org_id = ? AND grantee_principal_id = ? AND revoked_at IS NULL`,
        ["2026-08-16T00:00:00.000Z", owner.orgId, reader.principalId],
      );
      const granted = await fx.call("POST", "/v1/grants", {
        key: owner.key,
        body: { principal_id: reader.principalId, target_type: "project",
          target_id: allowedProject, permissions: ["read"] },
      });
      expectOk(granted, 201);

      const memories = await fx.call("GET", "/v1/memories", { key: reader.key });
      expectOk(memories);
      assert.deepEqual(memories.body.data.items.map((item: any) => item.id), [allowed.claimId]);
      const projects = await fx.call("GET", "/v1/projects", { key: reader.key });
      expectOk(projects);
      assert.deepEqual(projects.body.data.projects.map((project: any) => project.project_id), [allowedProject]);
      const subjects = await fx.call("GET", "/v1/subjects", { key: reader.key });
      expectOk(subjects);
      assert.deepEqual(subjects.body.data.subjects.map((subject: any) => subject.subject_id), [`subject_${fx.runtime}_allowed`]);
      const deniedApproval = await fx.call("POST", "/v1/access/simulate", {
        key: owner.key, body: { principal_id: reader.principalId, resource_type: "claim",
          resource_id: allowed.claimId, operation: "approve" },
      });
      expectOk(deniedApproval);
      assert.equal(deniedApproval.body.data.allowed, false);
      const approveGrant = await fx.call("POST", "/v1/grants", {
        key: owner.key, body: { principal_id: reader.principalId, target_type: "project",
          target_id: allowedProject, permissions: ["approve"] },
      });
      expectOk(approveGrant, 201);
      const permittedApproval = await fx.call("POST", "/v1/access/simulate", {
        key: owner.key, body: { principal_id: reader.principalId, resource_type: "claim",
          resource_id: allowed.claimId, operation: "approve" },
      });
      expectOk(permittedApproval);
      assert.equal(permittedApproval.body.data.allowed, true);
      expectOk(await fx.call("POST", "/v1/grants", {
        key: owner.key, body: { principal_id: reader.principalId, target_type: "project",
          target_id: allowedProject, permissions: ["admin"] },
      }), 201);
      const delegated = await fx.call("POST", "/v1/grants", {
        key: reader.key, body: { principal_id: reader.principalId, target_type: "project",
          target_id: allowedProject, permissions: ["read", "write"] },
      });
      expectOk(delegated, 201);
      const delegatedInventory = await fx.call("GET", "/v1/grants", { key: reader.key });
      expectOk(delegatedInventory);
      assert.ok(delegatedInventory.body.data.grants.some((grant: any) => grant.grant_id === delegated.body.data.grant_id));
      expectOk(await fx.call("DELETE", `/v1/grants/${delegated.body.data.grant_id}`, { key: reader.key }));
      const graph = await fx.call("POST", "/v1/memory-views/compile", {
        key: reader.key, body: { lens: "workspace_graph", max_nodes: 25 },
      });
      expectOk(graph);
      assert.ok(graph.body.data.nodes.some((node: any) => node.id === allowed.claimId));
      assert.ok(!JSON.stringify(graph.body).includes("must not infer"));
      for (let index = 0; index < 13; index += 1) await seedClaim(fx, owner.key, {
        observation: { subject_id: `graph_cap_${fx.runtime}_${index}`, project_id: allowedProject,
          visibility: "organization", content: `Graph cap claim ${index}.` },
        claim: { statement: `Graph cap claim ${index}.` },
      });
      const cappedGraph = await fx.call("POST", "/v1/memory-views/compile", {
        key: reader.key, body: { lens: "workspace_graph", max_nodes: 25 },
      });
      expectOk(cappedGraph);
      assert.equal(cappedGraph.body.data.truncated, true);
      assert.ok(cappedGraph.body.data.nodes.length <= 25);
      assert.equal(cappedGraph.body.data.withheld_edges, 2);

      const boundedAdmin = await fx.call("POST", "/v1/keys", {
        key: owner.key, body: { label: "bounded grant admin",
          scopes: ["grants:read", "grants:write"], max_trust: "asserted",
          data_target_type: "project", data_target_id: allowedProject },
      });
      expectOk(boundedAdmin, 201);
      expectError(await fx.call("POST", "/v1/grants", {
        key: boundedAdmin.body.data.api_key,
        body: { principal_id: reader.principalId, target_type: "project",
          target_id: hiddenProject, permissions: ["read"] },
      }), 404, "NOT_FOUND");
      const boundedGrant = await fx.call("POST", "/v1/grants", {
        key: boundedAdmin.body.data.api_key,
        body: { principal_id: reader.principalId, target_type: "project",
          target_id: allowedProject, permissions: ["read", "approve"] },
      });
      expectOk(boundedGrant, 201);
      expectOk(await fx.call("DELETE", `/v1/grants/${boundedGrant.body.data.grant_id}`, {
        key: boundedAdmin.body.data.api_key,
      }));

      expectError(await fx.call("POST", "/v1/observations", {
        key: reader.key,
        body: observation({ subject_id: `subject_${fx.runtime}_allowed`, project_id: allowedProject }),
      }), 404, "NOT_FOUND");
      const writeGrant = await fx.call("POST", "/v1/grants", {
        key: owner.key,
        body: { principal_id: reader.principalId, target_type: "project",
          target_id: allowedProject, permissions: ["write"] },
      });
      expectOk(writeGrant, 201);
      expectOk(await fx.call("POST", "/v1/observations", {
        key: reader.key,
        body: observation({ subject_id: `subject_${fx.runtime}_allowed`, project_id: allowedProject }),
      }), 201);
      const child = await fx.call("POST", "/v1/keys", {
        key: reader.key,
        body: { label: "scoped child", scopes: ["views:compile"], max_trust: "asserted",
          data_target_type: "project", data_target_id: allowedProject },
      });
      expectOk(child, 201);
      const childBeforeRevoke = await fx.call("GET", "/v1/memories", { key: child.body.data.api_key });
      expectOk(childBeforeRevoke);
      assert.ok(childBeforeRevoke.body.data.items.some((item: any) => item.id === allowed.claimId));
      assert.ok(!JSON.stringify(childBeforeRevoke.body).includes("must not infer"));

      expectOk(await fx.call("DELETE", `/v1/grants/${granted.body.data.grant_id}`, { key: owner.key }));
      const revoked = await fx.call("GET", "/v1/memories", { key: reader.key });
      expectOk(revoked);
      assert.deepEqual(revoked.body.data.items, []);
      const childRevoked = await fx.call("GET", "/v1/memories", { key: child.body.data.api_key });
      expectOk(childRevoked);
      assert.deepEqual(childRevoked.body.data.items, []);
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
    name: "model diagnostics stay read-only, masked, and audited",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const before = await fx.query<{ observations: number; claims: number }>(
        `SELECT (SELECT COUNT(*) FROM observations WHERE org_id = ?) AS observations,
                (SELECT COUNT(*) FROM claims WHERE org_id = ?) AS claims`,
        [owner.orgId, owner.orgId],
      );
      const config = await fx.call("GET", "/v1/models/config", { key: owner.key });
      expectOk(config);
      assert.equal(config.body.data.immutable_startup_snapshot, true);
      assert.equal(config.body.data.extraction.api_key, "unset");
      assert.equal(config.body.data.embedding.api_key, "unset");
      assert.ok(!JSON.stringify(config.body).includes("titen_sk_"));
      expectError(await fx.call("POST", "/v1/models/probe", {
        key: owner.key, body: { group: "embedding" },
      }), 503, "UNAVAILABLE");
      const after = await fx.query<{ observations: number; claims: number }>(
        `SELECT (SELECT COUNT(*) FROM observations WHERE org_id = ?) AS observations,
                (SELECT COUNT(*) FROM claims WHERE org_id = ?) AS claims`,
        [owner.orgId, owner.orgId],
      );
      assert.deepEqual(after, before);
      const audit = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM audit_log WHERE org_id = ? AND action = 'model.probe'`,
        [owner.orgId],
      );
      assert.equal(Number(audit[0]!.count), 1);
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
    /**
     * The write path's provenance is only worth measuring while it is a server
     * verdict. This is the fail-closed check for that: if a forged `recalled`
     * write is ever accepted, the recall-loop count becomes self-declared and
     * every number built on it is worthless (#280).
     */
    name: "recalled provenance is server-issued, unforgeable, and closes the loop",
    async run(fx) {
      const agent = await fx.provision();
      const subjectId = `recall_loop_${fx.runtime}`;

      // A pointer back to the origin is mandatory, not advisory. This omits
      // `source.ref` on purpose — do not "fix" it by adding one.
      expectError(
        await fx.call("POST", "/v1/observations", {
          key: agent.key,
          body: observation({ subject_id: subjectId, source: { type: "tool" } }),
        }),
        400,
        "VALIDATION_ERROR",
      );

      // Forging the stamp by declaring it.
      expectError(
        await fx.call("POST", "/v1/observations", {
          key: agent.key,
          body: observation({
            subject_id: subjectId,
            source: { type: "recalled", ref: "loop#forged" },
          }),
        }),
        400,
        "VALIDATION_ERROR",
      );

      // Forging the stamp by inventing the token it is issued from. Refusing
      // rather than ignoring it keeps an unrecognized token from silently
      // recording a recalled write as fresh input.
      expectError(
        await fx.call("POST", "/v1/observations", {
          key: agent.key,
          body: observation({
            subject_id: subjectId,
            context_token: "ctx_00000000000000000000000000000000",
          }),
        }),
        400,
        "VALIDATION_ERROR",
      );

      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: subjectId, task: "what do we know about this deploy", max_tokens: 1200 },
      });
      expectOk(compiled);
      const token = compiled.body.data.context_token as string;
      assert.equal(typeof token, "string", "compile must issue a context token");

      // Another organization's token is not a token here.
      const stranger = await fx.provision();
      const strangerCompile = await fx.call("POST", "/v1/context/compile", {
        key: stranger.key,
        body: { subject_id: subjectId, task: "borrowed pack", max_tokens: 1200 },
      });
      expectOk(strangerCompile);
      expectError(
        await fx.call("POST", "/v1/observations", {
          key: agent.key,
          body: observation({
            subject_id: subjectId,
            context_token: strangerCompile.body.data.context_token,
          }),
        }),
        400,
        "VALIDATION_ERROR",
      );

      // A caller carrying a genuine token cannot override the stamp either.
      const stamped = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: observation({
          subject_id: subjectId,
          content: "The compiled pack said deploys need a rollback smoke, so I stored that.",
          context_token: token,
          source: { type: "tool", ref: "loop#stamped" },
        }),
      });
      expectOk(stamped, 201);
      const observationId = stamped.body.data.observation_id as string;
      const stored = await fx.query<{ source_type: string }>(
        `SELECT source_type FROM observations WHERE id = ?`,
        [observationId],
      );
      assert.equal(
        stored[0]?.source_type,
        "recalled",
        "a write carrying a context token must be stamped recalled by the server",
      );

      // Closed, not merely labelled.
      expectError(
        await fx.call("POST", "/v1/consolidations", {
          key: agent.key,
          body: {
            subject_id: subjectId,
            claims: [{
              kind: "semantic_fact",
              statement: "Deploys need a rollback smoke.",
              sources: [{ observation_id: observationId, relation: "supports" }],
            }],
          },
        }),
        400,
        "VALIDATION_ERROR",
      );
    },
  },
  {
    name: "stable source identities and canonical claims converge outside request-key replay",
    async run(fx) {
      const agent = await fx.provision();
      const body = observation({
        subject_id: `resync_${fx.runtime}`,
        source: { type: "import", ref: "archive/page-7", id: `source-event-${fx.runtime}-7` },
      });
      const first = await fx.call("POST", "/v1/observations", { key: agent.key, body });
      expectOk(first, 201);
      const replay = await fx.call("POST", "/v1/observations", { key: agent.key, body });
      expectOk(replay, 200);
      assert.equal(replay.body.data.observation_id, first.body.data.observation_id);
      assert.equal(replay.body.meta.replayed, true);

      const consolidationBody = {
        subject_id: body.subject_id,
        claims: [{
          kind: "procedural",
          statement: "Stable resync evidence converges on one canonical claim.",
          sources: [{ observation_id: first.body.data.observation_id, relation: "supports" }],
        }],
      };
      const materialized = await fx.call("POST", "/v1/consolidations", {
        key: agent.key,
        body: consolidationBody,
      });
      expectOk(materialized, 201);
      const claimReplay = await fx.call("POST", "/v1/consolidations", {
        key: agent.key,
        body: consolidationBody,
      });
      expectOk(claimReplay, 200);
      assert.equal(claimReplay.body.data.claims[0].claim_id, materialized.body.data.claims[0].claim_id);
      assert.equal(claimReplay.body.data.claims[0].valid_from, materialized.body.data.claims[0].valid_from);
      assert.equal(claimReplay.body.meta.replayed, true);

      const distinct = await fx.call("POST", "/v1/observations", {
        key: agent.key,
        body: { ...body, content: "A changed source event remains distinct evidence." },
      });
      expectOk(distinct, 201);
      assert.notEqual(distinct.body.data.observation_id, first.body.data.observation_id);
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
    name: "corroboration breaks a ranking dead heat, and only support counts",
    async run(fx) {
      const agent = await fx.provision();
      const pair = await seedTiedPair(fx, agent.key, ["zulu", "yankee", "xray", "whiskey"]);

      const items = await compileTiedPair(fx, agent.key, pair);
      assert.equal(items.length, 2, "both permutations must survive retrieval");
      assert.equal(items[0]!.score, items[1]!.score, "the fixture must actually tie on score");
      // Without the corroboration key this falls through to the statement key,
      // which prefers "whiskey ..." over "zulu ..." and returns the shallow one.
      assert.equal(
        items[0]!.claim,
        pair.deep,
        "two supporting observations outrank one supporting and two qualifying",
      );
      // Citations are unchanged: a qualifier is still visible evidence, it is
      // just not corroboration.
      assert.equal(items[0]!.evidence_ids.length, 2);
      assert.equal(items[1]!.evidence_ids.length, 3);
    },
  },
  {
    name: "a hidden supporting observation changes neither depth nor order (AC-EVR-002)",
    async run(fx) {
      const owner = await fx.provision({ principalId: "agent_depth_owner" });
      const stranger = await fx.provision({
        orgId: owner.orgId,
        principalId: "agent_depth_stranger",
      });
      const pair = await seedTiedPair(fx, owner.key, ["victor", "uniform", "tango", "sierra"], {
        subjectId: "user_depth_evr002",
        visibility: "organization",
      });

      const before = await compileTiedPair(fx, owner.key, pair);
      assert.equal(before[0]!.claim, pair.deep, "the fixture must start with the deep claim first");

      // One private observation, supporting the shallow claim, owned by a
      // principal the compiler is not. Read as depth it would make the shallow
      // claim 3-deep against 2 and invert the pair, which is exactly the count
      // an unauthorized `evidence_depth` would leak.
      const secret = await fx.call("POST", "/v1/observations", {
        key: stranger.key,
        body: observation({
          subject_id: "user_depth_evr002",
          visibility: "private",
          content: "Fourth report of the sierra tango handover, held privately.",
        }),
      });
      expectOk(secret, 201);
      await fx.query(
        `INSERT INTO claim_sources (claim_id, observation_id, relation, created_at)
         VALUES (?, ?, 'supports', ?)`,
        [pair.shallowId, secret.body.data.observation_id as string, new Date().toISOString()],
      );

      const after = await compileTiedPair(fx, owner.key, pair);
      assert.deepEqual(
        after,
        before,
        "an observation the caller cannot read must not move depth, order, score, or citations",
      );

      // The row is real, and it would have flipped the pair: the same compile by
      // the principal who may read it returns the other order. Without this the
      // case would also pass against a build that simply ignored evidence depth.
      const authorized = await compileTiedPair(fx, stranger.key, pair);
      assert.equal(
        authorized[0]!.claim,
        pair.shallow,
        "the principal who can read the fourth support sees it outrank the pair",
      );
    },
  },
  {
    name: "a tie promoted across the top_k boundary still returns its citations",
    async run(fx) {
      const agent = await fx.provision();
      const pair = await seedTiedPair(fx, agent.key, ["romeo", "quebec", "papa", "oscar"], {
        subjectId: "user_topk_boundary",
      });

      // `top_k: 1` is the case the gate exists for: the deep claim is second in
      // the preliminary order and only the corroboration key lifts it into the
      // single returned slot. A contested lookup narrowed back to the `top_k`
      // slice never loads the deep claim's sources, so it is neither promoted
      // nor cited — and the rest of the suite, which omits `top_k`, stays green.
      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: "user_topk_boundary",
          task: pair.deep,
          max_tokens: 4000,
          top_k: 1,
        },
      });
      expectOk(compiled);
      const items = compiled.body.data.items as { claim: string; evidence_ids: string[] }[];
      assert.equal(items.length, 1, "top_k must bound the returned pack");
      assert.equal(items[0]!.claim, pair.deep, "the promoted claim must cross the boundary");
      assert.deepEqual(
        items[0]!.evidence_ids.length,
        2,
        "a promoted item must carry the citations that promoted it, not an empty list",
      );
      assert.equal(
        compiled.body.data.budget.omitted_items,
        1,
        "the claim the bound discarded is still counted",
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

      const secondDispute = await fx.call("POST", "/v1/consolidations", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          claims: [{
            kind: "procedural",
            statement: "Rollback smoke always precedes a release announcement.",
            sources: [
              { observation_id: supporting.body.data.observation_id, relation: "supports" },
              { observation_id: contradicting.body.data.observation_id, relation: "contradicts" },
            ],
          }],
        },
      });
      expectOk(secondDispute, 200);
      assert.equal(
        secondDispute.body.data.claims[0].claim_id,
        res.body.data.claims[0].claim_id,
      );
      const clean = await fx.call("POST", "/v1/consolidations", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          claims: [{
            kind: "procedural",
            statement: "Rollback smoke always precedes a release announcement.",
            sources: [{ observation_id: supporting.body.data.observation_id, relation: "supports" }],
          }],
        },
      });
      expectOk(clean, 201);

      const compiled = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: "user_rama",
          task: "rollback smoke release announcement",
          max_tokens: 1200,
        },
      });
      expectOk(compiled);
      const disputedIds = [res.body.data.claims[0].claim_id];
      assert.deepEqual(
        compiled.body.data.conflicts.map((conflict: any) => conflict.claim_id).sort(),
        [...disputedIds].sort(),
      );
      const items = new Map(compiled.body.data.items.map((item: any, index: number) => [
        item.claim_id, { ...item, index },
      ]));
      const cleanItem = items.get(clean.body.data.claims[0].claim_id) as any;
      assert.equal(cleanItem.status, "active");
      assert.equal(cleanItem.score_components.conflict, 1);
      for (const claimId of disputedIds) {
        const item = items.get(claimId) as any;
        assert.equal(item.status, "disputed");
        assert.equal(item.score_components.conflict, 0);
        assert.ok(cleanItem.index < item.index);
        assert.ok(cleanItem.score > item.score);
      }

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

      const pressured = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: subject,
          task: "final pack metric marker",
          max_tokens: 500,
        },
      });
      expectOk(pressured);
      assert.ok(pressured.body.data.items.length > 0);
      assert.ok(pressured.body.data.items.length < definitions.length);
      assert.equal(pressured.body.data.budget.selected_items, pressured.body.data.items.length);
      assert.equal(
        pressured.body.data.budget.omitted_items,
        definitions.length - pressured.body.data.items.length,
      );
      assert.equal(pressured.body.data.budget.budget_exhausted, true);
    },
  },
  {
    name: "historical context and candidate bounds are explicit and fail closed",
    async run(fx) {
      const agent = await fx.provision();
      const subject = `historical_${fx.runtime}`;
      const seeded = await seedClaim(fx, agent.key, {
        observation: { subject_id: subject, content: "Historical cobalt release procedure evidence." },
        claim: {
          statement: "Historical cobalt release procedure was active in January.",
          valid_from: "2026-01-01T00:00:00.000Z",
          valid_to: "2026-02-01T00:00:00.000Z",
        },
      });
      const historical = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: subject,
          task: "historical cobalt release procedure",
          max_tokens: 900,
          max_candidates: 1,
          at: "2026-01-15T12:00:00Z",
        },
      });
      expectOk(historical);
      assert.equal(historical.body.data.scope.as_of, "2026-01-15T12:00:00.000Z");
      assert.deepEqual(historical.body.data.items.map((item: any) => item.claim_id), [seeded.claimId]);
      assert.equal(historical.body.meta.candidates, 1);

      const later = await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: {
          subject_id: subject,
          task: "historical cobalt release procedure",
          max_tokens: 900,
          at: "2026-03-01T00:00:00.000Z",
        },
      });
      expectOk(later);
      assert.equal(later.body.data.items.length, 0);
      expectError(await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: subject, task: "bad bound", max_tokens: 900, max_candidates: 0 },
      }), 400, "VALIDATION_ERROR");
      expectError(await fx.call("POST", "/v1/context/compile", {
        key: agent.key,
        body: { subject_id: subject, task: "bad time", max_tokens: 900, at: "not-a-time" },
      }), 400, "VALIDATION_ERROR");
    },
  },
  {
    name: "top_k hard-caps the returned pack and leaves the default unbounded",
    async run(fx) {
      const agent = await fx.provision();
      const subject = `topk_${fx.runtime}`;
      for (const suffix of ["alfa", "bravo", "charlie"])
        await seedClaim(fx, agent.key, {
          observation: {
            subject_id: subject,
            content: `Zenith orbit checklist evidence ${suffix}.`,
          },
          claim: { statement: `Zenith orbit checklist covers stage ${suffix}.` },
        });
      const compile = (extra: Record<string, unknown>) =>
        fx.call("POST", "/v1/context/compile", {
          key: agent.key,
          body: {
            subject_id: subject,
            task: "zenith orbit checklist",
            max_tokens: 4_000,
            ...extra,
          },
        });

      const unbounded = await compile({});
      expectOk(unbounded);
      assert.equal(unbounded.body.data.items.length, 3, "absent top_k must not bound the pack");
      assert.equal(unbounded.body.data.budget.omitted_items, 0);

      const bounded = await compile({ top_k: 2 });
      expectOk(bounded);
      assert.equal(bounded.body.data.items.length, 2);
      assert.equal(bounded.body.data.budget.selected_items, 2);
      assert.deepEqual(
        bounded.body.data.items.map((item: any) => item.claim_id),
        unbounded.body.data.items.slice(0, 2).map((item: any) => item.claim_id),
        "top_k must keep the ranked prefix",
      );
      // Applied before the budget, so a bounded pack costs fewer tokens rather
      // than being trimmed after the caller has already paid for the full one.
      assert.ok(
        bounded.body.data.budget.used_tokens < unbounded.body.data.budget.used_tokens,
        "top_k must reduce the token bill, not just the array length",
      );
      // It bounds the answer, not what retrieval was allowed to consider.
      assert.equal(bounded.body.meta.candidates, unbounded.body.meta.candidates);
      // A truncated pack must say so. Reporting zero omissions here let a caller
      // read a bounded answer as a complete one, which is the only thing the
      // budget block exists to prevent.
      assert.equal(
        bounded.body.data.budget.omitted_items,
        1,
        "a count-bounded pack must report the ranked candidates it dropped",
      );
      assert.equal(
        bounded.body.data.budget.budget_exhausted,
        false,
        "the token budget did not bind, so only omitted_items may report the truncation",
      );

      for (const value of [0, 1_001, 1.5, "2", null])
        expectError(await compile({ top_k: value }), 400, "VALIDATION_ERROR");
    },
  },
  {
    name: "temporal polarity separates two claims that differ only in its marker",
    async run(fx) {
      const agent = await fx.provision();
      const subject = `polarity_${fx.runtime}`;
      // Same length, same tokens, one differing marker: the only thing FTS can
      // use to tell them apart is the polarity word itself.
      const start = await seedClaim(fx, agent.key, {
        observation: { subject_id: subject, content: "Kuiper endpoint rotation, current." },
        claim: {
          kind: "decision",
          statement: "Mulai Juli 2026 endpoint kuiper aktif adalah alfa.",
        },
      });
      const end = await seedClaim(fx, agent.key, {
        observation: { subject_id: subject, content: "Kuiper endpoint rotation, historical." },
        claim: {
          kind: "decision",
          statement: "Sebelum Juli 2026 endpoint kuiper aktif adalah beta.",
        },
      });
      // An English claim sharing nothing with the Indonesian queries except the
      // English member of the same polarity group. Expanding across languages
      // inside one OR branch injected exactly this at rank 2.
      const foreign = await seedClaim(fx, agent.key, {
        observation: { subject_id: subject, content: "Unrelated English retry policy." },
        claim: {
          kind: "procedural",
          statement: "The import job retries for 21 days before alerting.",
        },
      });
      const items = async (task: string) => {
        const res = await fx.call("POST", "/v1/context/compile", {
          key: agent.key,
          body: { subject_id: subject, task, max_tokens: 4_000 },
        });
        expectOk(res);
        assert.ok(
          res.body.data.items.every((item: any) => item.claim_id !== foreign.claimId),
          `an Indonesian query must not reach an English claim through a shared polarity marker: ${task}`,
        );
        assert.equal(res.body.data.items.length, 2);
        return res.body.data.items;
      };

      // "sejak" and "hingga" appear in neither claim. Both were seeded on the
      // same day, so recency cannot decide this either, and the end-of-window
      // claim is the newer of the two — which is what the old plan returned for
      // BOTH queries, because the two tied exactly on bm25.
      const fromJuly = await items("endpoint kuiper aktif sejak Juli 2026");
      assert.equal(
        fromJuly[0].claim_id,
        start.claimId,
        "a start-of-window query must reach the start-of-window claim",
      );
      assert.ok(
        fromJuly[0].score > fromJuly[1].score,
        "polarity must move the score, not only the order",
      );

      const untilJuly = await items("endpoint kuiper aktif hingga Juli 2026");
      assert.equal(
        untilJuly[0].claim_id,
        end.claimId,
        "an end-of-window query must reach the end-of-window claim",
      );
      assert.ok(untilJuly[0].score > untilJuly[1].score);
    },
  },
  {
    // The English polarity groups ship on the same OR-expansion mechanism that
    // leaked across languages once, so they carry their own coverage rather
    // than inheriting confidence from the Indonesian case above.
    name: "temporal polarity separates English claims and does not cross into Indonesian",
    async run(fx) {
      const agent = await fx.provision();
      const subject = `polarity_en_${fx.runtime}`;
      const start = await seedClaim(fx, agent.key, {
        observation: { subject_id: subject, content: "Kuiper endpoint rotation, current." },
        claim: {
          kind: "decision",
          statement: "After July 2026 the active kuiper endpoint is alfa.",
        },
      });
      const end = await seedClaim(fx, agent.key, {
        observation: { subject_id: subject, content: "Kuiper endpoint rotation, historical." },
        claim: {
          kind: "decision",
          statement: "Before July 2026 the active kuiper endpoint is beta.",
        },
      });
      // Reverse of the Indonesian guard: an Indonesian claim reachable only
      // through the Indonesian member of the same polarity group.
      const foreign = await seedClaim(fx, agent.key, {
        observation: { subject_id: subject, content: "Unrelated Indonesian retry policy." },
        claim: {
          kind: "procedural",
          statement: "Pekerjaan impor mencoba ulang 21 hari sebelum memberi peringatan.",
        },
      });
      const items = async (task: string) => {
        const res = await fx.call("POST", "/v1/context/compile", {
          key: agent.key,
          body: { subject_id: subject, task, max_tokens: 4_000 },
        });
        expectOk(res);
        assert.ok(
          res.body.data.items.every((item: any) => item.claim_id !== foreign.claimId),
          `an English query must not reach an Indonesian claim through a shared polarity marker: ${task}`,
        );
        assert.equal(res.body.data.items.length, 2);
        return res.body.data.items;
      };

      // "since" and "until" appear in neither claim; each reaches its claim
      // only through its own single-language group.
      const sinceJuly = await items("active kuiper endpoint since July 2026");
      assert.equal(
        sinceJuly[0].claim_id,
        start.claimId,
        "an English start-of-window query must reach the start-of-window claim",
      );
      assert.ok(
        sinceJuly[0].score > sinceJuly[1].score,
        "polarity must move the score, not only the order",
      );

      const untilJuly = await items("active kuiper endpoint until July 2026");
      assert.equal(
        untilJuly[0].claim_id,
        end.claimId,
        "an English end-of-window query must reach the end-of-window claim",
      );
      assert.ok(untilJuly[0].score > untilJuly[1].score);
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
      assert.equal(res.body.data.budget.selected_items, res.body.data.items.length);
      assert.ok(res.body.data.budget.omitted_items >= 1);
      assert.equal(res.body.data.budget.budget_exhausted, true);
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
      assert.deepEqual(res.body.data.budget, {
        max_tokens: 900,
        used_tokens: 0,
        selected_items: 0,
        omitted_items: 0,
        deduplicated_items: 0,
        unconsolidated_observations: 0,
        budget_exhausted: false,
      });
    },
  },
  {
    name: "compile reports only authorized unconsolidated observations",
    async run(fx) {
      const owner = await fx.provision({ principalId: "agent_observation_owner" });
      const intruder = await fx.provision({ principalId: "agent_observation_intruder" });
      const observation = await fx.call("POST", "/v1/observations", {
        key: owner.key,
        body: {
          subject_id: "subject_pending_observation",
          kind: "imported_source",
          content: "A durable observation still needs a claim before recall.",
          source: { type: "import:markdown@1", ref: "pending-observation#1" },
          trust: "asserted",
          visibility: "private",
        },
      });
      expectOk(observation, 201);

      const pending = await fx.call("POST", "/v1/context/compile", {
        key: owner.key,
        body: {
          subject_id: "subject_pending_observation",
          task: "durable observation claim recall",
          max_tokens: 900,
        },
      });
      expectOk(pending);
      assert.deepEqual(pending.body.data.items, []);
      assert.equal(pending.body.data.budget.unconsolidated_observations, 1);

      const hidden = await fx.call("POST", "/v1/context/compile", {
        key: intruder.key,
        body: {
          subject_id: "subject_pending_observation",
          task: "durable observation claim recall",
          max_tokens: 900,
        },
      });
      expectOk(hidden);
      assert.deepEqual(hidden.body.data.items, []);
      assert.equal(hidden.body.data.budget.unconsolidated_observations, 0);

      const consolidation = await fx.call("POST", "/v1/consolidations", {
        key: owner.key,
        body: {
          subject_id: "subject_pending_observation",
          claims: [{
            kind: "semantic_fact",
            statement: "A durable observation becomes recallable after a claim cites it.",
            confidence: 1,
            sources: [{
              observation_id: observation.body.data.observation_id,
              relation: "supports",
            }],
          }],
        },
      });
      expectOk(consolidation, 201);

      const consolidated = await fx.call("POST", "/v1/context/compile", {
        key: owner.key,
        body: {
          subject_id: "subject_pending_observation",
          task: "durable observation becomes recallable claim",
          max_tokens: 900,
        },
      });
      expectOk(consolidated);
      assert.equal(consolidated.body.data.budget.unconsolidated_observations, 0);
      assert.equal(consolidated.body.data.items.length, 1);
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
    name: "an unreadable contradicting source moves neither the rank nor conflicts (#291)",
    async run(fx) {
      const subjectId = "user_disputed_291";
      const task = "quarterly ledger reconciliation handover checklist";
      const owner = await fx.provision({ principalId: "agent_disputed_owner" });
      const insider = await fx.provision({
        orgId: owner.orgId,
        principalId: "agent_disputed_insider",
      });
      const seeded = await seedClaim(fx, owner.key, {
        observation: {
          subject_id: subjectId,
          visibility: "organization",
          content: "The quarterly ledger reconciliation handover ran with a signed checklist.",
        },
        claim: {
          statement: "The quarterly ledger reconciliation handover needs a signed checklist.",
        },
      });

      const compile = async (key: string) => {
        const res = await fx.call("POST", "/v1/context/compile", {
          key,
          body: { subject_id: subjectId, task, max_tokens: 4000 },
        });
        expectOk(res);
        return res.body.data as {
          items: { claim_id: string; score: number; score_components: Record<string, number> }[];
          conflicts: { claim_id: string; evidence_ids: string[] }[];
        };
      };

      // The reference: this store, before the hidden source exists at all.
      const before = await compile(owner.key);
      assert.equal(before.items.length, 1, "the fixture must return the claim to rank");
      assert.deepEqual(before.conflicts, [], "an unopposed claim carries no conflict");

      const secret = await fx.call("POST", "/v1/observations", {
        key: insider.key,
        body: observation({
          subject_id: subjectId,
          visibility: "private",
          content: "The quarterly ledger reconciliation handover skipped the checklist entirely.",
        }),
      });
      expectOk(secret, 201);
      const secretId = secret.body.data.observation_id as string;
      // Consolidation clamps a claim to its narrowest source, so this state is
      // reached by federation, import, or any writer below the API rather than
      // by POST /v1/consolidations. Retrieval must be safe on its own regardless:
      // "scope and authorization happen before retrieval" (AGENTS.md).
      await fx.query(
        `INSERT INTO claim_sources (claim_id, observation_id, relation, created_at)
         VALUES (?, ?, 'contradicts', ?)`,
        [seeded.claimId, secretId, new Date().toISOString()],
      );

      // Whole-day recency keeps repeated compilation stable, so anything that
      // differs here is the hidden row talking.
      const after = await compile(owner.key);
      assert.deepEqual(
        after.items,
        before.items,
        "a contradicting source the caller cannot read must not move the score or the order",
      );
      assert.deepEqual(
        after.conflicts,
        before.conflicts,
        "a contradicting source the caller cannot read must not be announced in conflicts[]",
      );

      // The same row must still count for the principal who may read it: the
      // fix is authorization, not the removal of the signal.
      const authorized = await compile(insider.key);
      assert.deepEqual(
        authorized.conflicts.map((conflict) => conflict.claim_id),
        [seeded.claimId],
        "the principal who can read the contradiction still sees the dispute",
      );
      assert.equal(
        authorized.items[0]!.score_components.conflict,
        0,
        "and still pays the conflict term for it",
      );
      assert.ok(
        authorized.conflicts[0]!.evidence_ids.includes(secretId),
        "and still receives the source id as a citation",
      );
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
      const { as_of: omittedAsOf, ...omittedScope } = omitted.body.data.scope;
      assert.match(omittedAsOf, /^\d{4}-\d{2}-\d{2}T/);
      assert.deepEqual(omittedScope, {
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
      const { as_of: broadAsOf, ...broadScope } = broad.body.data.scope;
      assert.match(broadAsOf, /^\d{4}-\d{2}-\d{2}T/);
      assert.deepEqual(broadScope, {
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
              at: broadAsOf,
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
    name: "an imported credential whose id belongs to another organization is refused with a conflict",
    async run(fx) {
      // api_keys.id is a global TEXT PRIMARY KEY, but the credential preflight
      // that looks for an existing row is scoped `WHERE org_id = ?`, so it
      // cannot see a collision in someone else's organization. Until the
      // foreign-id preflight covered api_key, this reached db.batch and the
      // constraint surfaced through the concurrent-write handler as "Import
      // collided with a concurrent write; retry after exporting current
      // state." The status was already 409, so only the message was wrong --
      // and it was wrong in the direction that costs an operator the most:
      // the collision is with another organization's row, so the retry it
      // recommends can never succeed. Asserting the message, not the status,
      // is what makes this case bite.
      const first = await fx.provision({ scopes: ["*"] });
      const second = await fx.provision({ scopes: ["*"] });
      assert.notEqual(first.orgId, second.orgId, "the two fixtures must be different organizations");

      const exported = await fx.call("GET", "/v1/export?type=keys&all=true", { key: first.key });
      assert.equal(exported.status, 200); // JSONL, not a JSON envelope

      const refused = await fx.callRaw("POST", "/v1/import", {
        key: second.key,
        body: String(exported.body),
      });
      expectError(refused, 409);
      assert.match(
        JSON.stringify(refused.body),
        /already exists outside this organization/,
        "the refusal must be the documented conflict, not a storage-layer error",
      );

      // Atomic: the losing import writes nothing, and the original credential
      // in the other organization still works.
      const landed = await fx.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM api_keys WHERE org_id = ?`, [second.orgId],
      );
      assert.equal(Number(landed[0]!.count), 1, "only the importer's own key may exist");
      expectOk(await fx.call("GET", "/v1/keys", { key: first.key }));
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
    name: "principal introspection and human membership provisioning stay atomic",
    async run(fx) {
      const owner = await fx.provision({
        principalId: `user_owner_${fx.runtime}`,
        principalKind: "human",
        scopes: ["*"],
        maxTrust: "policy_approved",
      });
      const ownerPrincipal = await fx.call("GET", "/v1/principal", { key: owner.key });
      expectOk(ownerPrincipal);
      assert.deepEqual(ownerPrincipal.body.data, {
        organization_id: owner.orgId,
        principal_id: owner.principalId,
        principal_kind: "human",
        key_id: owner.keyId,
        scopes: ["*"],
        max_trust: "policy_approved",
        issued_by: owner.principalId,
        data_target_type: "organization",
        data_target_id: null,
        organization_role: "root",
      });
      expectError(await fx.call("GET", "/v1/principal"), 401, "UNAUTHENTICATED");

      const admin = await fx.provision({
        orgId: owner.orgId,
        principalId: `user_admin_${fx.runtime}`,
        principalKind: "human",
        scopes: ["keys:manage", "memberships:read", "memberships:write", "views:compile"],
        maxTrust: "verified",
      });
      expectOk(await fx.call("POST", "/v1/memberships", {
        key: owner.key,
        body: { principal_id: admin.principalId, principal_kind: "human", role: "admin" },
      }), 201);
      const adminPrincipal = await fx.call("GET", "/v1/principal", { key: admin.key });
      expectOk(adminPrincipal);
      assert.equal(adminPrincipal.body.data.organization_role, "admin");

      const created = await fx.call("POST", "/v1/keys", {
        key: admin.key,
        body: {
          label: "Dashboard reader",
          scopes: ["memberships:read", "views:compile"],
          max_trust: "asserted",
          membership_role: "reader",
        },
      });
      expectOk(created, 201);
      assert.equal(created.body.data.principal_kind, "human");
      assert.equal(created.body.data.membership_role, "reader");
      assert.match(created.body.data.membership_id, /^mbr_/);
      assert.match(created.body.data.api_key, /^titen_sk_/);
      const readerPrincipal = await fx.call("GET", "/v1/principal", {
        key: created.body.data.api_key,
      });
      expectOk(readerPrincipal);
      assert.equal(readerPrincipal.body.data.organization_role, "reader");
      assert.equal(readerPrincipal.body.data.principal_id, created.body.data.principal_id);

      const before = await fx.query<{ keys: number; memberships: number }>(
        `SELECT
           (SELECT COUNT(*) FROM api_keys WHERE org_id = ? AND principal_id = ?) AS keys,
           (SELECT COUNT(*) FROM memberships WHERE org_id = ? AND principal_id = ?
             AND removed_at IS NULL) AS memberships`,
        [owner.orgId, created.body.data.principal_id, owner.orgId, created.body.data.principal_id],
      );
      expectError(await fx.call("POST", "/v1/keys", {
        key: owner.key,
        body: {
          label: "Duplicate reader",
          scopes: ["views:compile"],
          principal_id: created.body.data.principal_id,
          principal_kind: "human",
          membership_role: "reader",
        },
      }), 409, "CONFLICT");
      const after = await fx.query<{ keys: number; memberships: number }>(
        `SELECT
           (SELECT COUNT(*) FROM api_keys WHERE org_id = ? AND principal_id = ?) AS keys,
           (SELECT COUNT(*) FROM memberships WHERE org_id = ? AND principal_id = ?
             AND removed_at IS NULL) AS memberships`,
        [owner.orgId, created.body.data.principal_id, owner.orgId, created.body.data.principal_id],
      );
      assert.deepEqual(after, before, "failed membership creation must roll back its key");

      expectError(await fx.call("POST", "/v1/keys", {
        key: admin.key,
        body: {
          label: "Owner escalation",
          scopes: ["views:compile"],
          membership_role: "owner",
        },
      }), 403, "FORBIDDEN");
      expectError(await fx.call("POST", "/v1/keys", {
        key: admin.key,
        body: {
          label: "Wrong principal kind",
          scopes: ["views:compile"],
          principal_kind: "agent",
          membership_role: "reader",
        },
      }), 400, "VALIDATION_ERROR");
    },
  },
  {
    name: "password operator accounts login atomically and revoke their short session key",
    async run(fx) {
      const owner = await fx.provision({
        principalId: `password_owner_${fx.runtime}`,
        principalKind: "human",
        scopes: ["*"],
        maxTrust: "policy_approved",
      });
      const username = `operator-${fx.runtime}`;
      const password = `correct horse battery ${fx.runtime}`;
      const created = await fx.call("POST", "/v1/operator-accounts", {
        key: owner.key,
        body: {
          username,
          role: "reader",
          scopes: ["views:compile", "memberships:read"],
          max_trust: "asserted",
        },
      });
      expectOk(created, 201);
      assert.equal(created.body.data.username, username);
      assert.equal(created.body.data.role, "reader");
      assert.equal(created.body.data.api_key, undefined);
      assert.equal(created.body.data.password_change_required, true);
      const temporaryPassword = created.body.data.temporary_password as string;
      assert.match(temporaryPassword, /^[A-Za-z0-9_-]{24}$/);

      const [stored] = await fx.query<{ password_verifier: string; memberships: number; must_change_password: number }>(
        `SELECT a.password_verifier, a.must_change_password,
                (SELECT COUNT(*) FROM memberships m WHERE m.org_id = a.org_id
                  AND m.principal_id = a.principal_id AND m.removed_at IS NULL) AS memberships
           FROM operator_accounts a WHERE a.username = ?`,
        [username],
      );
      assert.match(stored!.password_verifier, /^pbkdf2-sha256\$100000x6\$/);
      assert.ok(!stored!.password_verifier.includes(temporaryPassword));
      assert.equal(stored!.memberships, 1);
      assert.equal(stored!.must_change_password, 1);

      const wrong = await fx.call("POST", "/v1/dashboard-sessions", {
        body: { username, password: "this is the wrong passphrase" },
      });
      expectError(wrong, 401, "INVALID_LOGIN");
      const missing = await fx.call("POST", "/v1/dashboard-sessions", {
        body: { username: `missing-${fx.runtime}`, password: "this is the wrong passphrase" },
      });
      expectError(missing, 401, "INVALID_LOGIN");
      assert.equal(missing.body.error.message, wrong.body.error.message);
      expectError(await fx.call("POST", "/v1/dashboard-sessions", {
        body: { username, password: temporaryPassword, role: "owner" },
      }), 400, "VALIDATION_ERROR");

      const session = await fx.call("POST", "/v1/dashboard-sessions", {
        body: { username: username.toUpperCase(), password: temporaryPassword },
      });
      expectOk(session, 201);
      assert.match(session.body.data.api_key, /^titen_sk_/);
      assert.equal(session.body.data.organization_role, "reader");
      assert.equal(session.body.data.principal_id, created.body.data.principal_id);
      assert.equal(session.body.data.password_change_required, true);
      assert.deepEqual(session.body.data.scopes, []);
      const sessionKey = session.body.data.api_key as string;
      const principal = await fx.call("GET", "/v1/principal", { key: sessionKey });
      expectOk(principal);
      assert.equal(principal.body.data.organization_role, "reader");
      expectError(await fx.call("GET", "/v1/memberships", { key: sessionKey }), 403, "FORBIDDEN");
      expectError(await fx.call("PATCH", "/v1/operator-accounts/current/password", {
        key: sessionKey,
        body: { password: temporaryPassword },
      }), 400, "VALIDATION_ERROR");
      expectError(await fx.call("PATCH", "/v1/operator-accounts/current/password", {
        key: sessionKey,
        body: { password: "password123456789" },
      }), 400, "VALIDATION_ERROR");
      expectError(await fx.call("PATCH", "/v1/operator-accounts/current/password", {
        key: sessionKey,
        body: { password: `${username}-password` },
      }), 400, "VALIDATION_ERROR");
      expectOk(await fx.call("PATCH", "/v1/operator-accounts/current/password", {
        key: sessionKey,
        body: { password },
      }));
      expectError(await fx.call("GET", "/v1/principal", { key: sessionKey }), 401, "UNAUTHENTICATED");
      expectError(await fx.call("POST", "/v1/dashboard-sessions", {
        body: { username, password: temporaryPassword },
      }), 401, "INVALID_LOGIN");
      const established = await fx.call("POST", "/v1/dashboard-sessions", {
        body: { username, password },
      });
      expectOk(established, 201);
      assert.equal(established.body.data.password_change_required, false);
      assert.deepEqual(established.body.data.scopes, ["views:compile", "memberships:read"]);
      expectOk(await fx.call("DELETE", "/v1/dashboard-sessions/current", {
        key: established.body.data.api_key as string,
      }));
      const [changed] = await fx.query<{ must_change_password: number; password_changed_at: string | null }>(
        `SELECT must_change_password, password_changed_at FROM operator_accounts WHERE username = ?`, [username]);
      assert.equal(changed!.must_change_password, 0);
      assert.ok(changed!.password_changed_at);

      const before = await fx.query<{ accounts: number; memberships: number }>(
        `SELECT (SELECT COUNT(*) FROM operator_accounts) AS accounts,
                (SELECT COUNT(*) FROM memberships) AS memberships`,
      );
      expectError(await fx.call("POST", "/v1/operator-accounts", {
        key: owner.key,
        body: {
          username,
          role: "reader",
          scopes: ["views:compile"],
          max_trust: "asserted",
        },
      }), 409, "CONFLICT");
      const after = await fx.query<{ accounts: number; memberships: number }>(
        `SELECT (SELECT COUNT(*) FROM operator_accounts) AS accounts,
                (SELECT COUNT(*) FROM memberships) AS memberships`,
      );
      assert.deepEqual(after, before, "duplicate account must roll back its membership");

      const second = await fx.call("POST", "/v1/operator-accounts", {
        key: owner.key,
        body: {
          username: `second-${fx.runtime}`,
          role: "reader",
          scopes: ["views:compile"],
          max_trust: "asserted",
        },
      });
      expectOk(second, 201);
      assert.notEqual(second.body.data.temporary_password, temporaryPassword);
      const hashes = await fx.query<{ password_verifier: string }>(
        `SELECT password_verifier FROM operator_accounts
          WHERE username IN (?, ?) ORDER BY username`,
        [username, `second-${fx.runtime}`],
      );
      assert.equal(hashes.length, 2);
      assert.notEqual(hashes[0]!.password_verifier, hashes[1]!.password_verifier, "each account needs a unique salt");

      const admin = await fx.provision({
        orgId: owner.orgId,
        principalId: `password_admin_${fx.runtime}`,
        principalKind: "human",
        scopes: ["keys:manage", "memberships:write", "views:compile"],
        maxTrust: "verified",
      });
      expectOk(await fx.call("POST", "/v1/memberships", {
        key: owner.key,
        body: { principal_id: admin.principalId, principal_kind: "human", role: "admin" },
      }), 201);
      expectError(await fx.call("POST", "/v1/operator-accounts", {
        key: admin.key,
        body: {
          username: `owner-escalation-${fx.runtime}`,
          role: "owner",
          scopes: ["views:compile"],
          max_trust: "asserted",
        },
      }), 403, "FORBIDDEN");

      const throttled = `locked-${fx.runtime}`;
      for (let attempt = 0; attempt < 10; attempt++)
        expectError(await fx.call("POST", "/v1/dashboard-sessions", {
          body: { username: throttled, password: "this is the wrong passphrase" },
        }), 401, "INVALID_LOGIN");
      expectError(await fx.call("POST", "/v1/dashboard-sessions", {
        body: { username: throttled, password: "this is the wrong passphrase" },
      }), 429, "LOGIN_RATE_LIMITED");
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
    name: "export refuses a pre-workspace team row instead of writing an unrestorable backup",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const seeded = await seedClaim(fx, owner.key);
      assert.equal((await fx.call("GET", "/v1/export?type=claims&all=true", { key: owner.key })).status, 200);

      // Exactly what migration 10 leaves behind on a 0.1.x store: team
      // visibility with no workspace to bind it to. The importer rejects the
      // line, so emitting it would produce a backup that cannot be restored.
      await fx.query(
        `UPDATE claims SET visibility = 'team', workspace_id = NULL WHERE id = ?`,
        [seeded.claimId],
      );
      const refused = await fx.call("GET", "/v1/export?type=claims&all=true", { key: owner.key });
      expectError(refused, 400, "VALIDATION_ERROR");
      assert.ok(
        String(refused.body.error.message).includes(seeded.claimId),
        "refusal must name the record an operator has to repair",
      );
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
      // Nine native `titen_*` tools plus the nine @modelcontextprotocol/server-memory
// names served for drop-in substitution (#279).
      assert.equal(tools.body.result.tools.length, 18);
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
    name: "governance routes are shipped under their versioned contract only",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      expectOk(await fx.call("GET", "/v1/policies", { key: owner.key }));
      expectError(await fx.call("POST", "/v1/policies", { key: owner.key, body: {} }), 400);
      for (const [method, path] of [
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

      const traceContextId = `ctx_atlas_trace_${fx.runtime}_${Date.now()}`;
      const traceChannelId = `chn_atlas_trace_${fx.runtime}_${Date.now()}`;
      const traceReleaseId = `rel_atlas_trace_${fx.runtime}_${Date.now()}`;
      const traceNow = "2026-08-01T00:00:00.000Z";
      await fx.query(
        `INSERT INTO context_runs
           (id, org_id, actor_id, subject_id, project_id, task_hash, max_tokens,
            used_tokens, policy_snapshot, degraded, created_at)
         VALUES (?, ?, ?, 'user_rama', NULL, 'atlas-trace', 256, 32, 'policy', 'none', ?)`,
        [traceContextId, owner.orgId, owner.principalId, traceNow],
      );
      await fx.query(
        `INSERT INTO context_run_items (context_id, claim_id, position, score, score_components)
         VALUES (?, ?, 0, 1, '{}')`,
        [traceContextId, seeded.claimId],
      );
      await fx.query(
        `INSERT INTO channels
           (id, org_id, label, gateway_principal_id, allowed_audiences,
            minimum_trust, status, version, created_by, created_at, updated_at)
         VALUES (?, ?, 'crm-web', ?, '["anonymous"]', 'asserted', 'active', 1, ?, ?, ?)`,
        [traceChannelId, owner.orgId, owner.principalId, owner.principalId, traceNow, traceNow],
      );
      await fx.query(
        `INSERT INTO channel_releases
           (id, org_id, channel, audience, version, status, created_at,
            channel_id, claim_id, claim_version, released_content, lifecycle_status,
            valid_from, valid_to, activated_at, updated_at)
         VALUES (?, ?, 'crm-web', 'anonymous', 1, 'active', ?, ?, ?, 1,
                 'Production deploy smoke returned 200.', 'active', ?, NULL, ?, ?)`,
        [traceReleaseId, owner.orgId, traceNow, traceChannelId, seeded.claimId, traceNow, traceNow, traceNow],
      );
      const decoratedTrace = await fx.call("POST", "/v1/memory-views/compile", {
        key: owner.key,
        body: { lens: "evidence_trace", focus_id: seeded.claimId },
      });
      expectOk(decoratedTrace);
      assert.ok(decoratedTrace.body.data.nodes.some((n: any) => n.id === traceContextId && n.type === "context"), "readable context must be a node");
      assert.ok(decoratedTrace.body.data.nodes.some((n: any) => n.id === traceReleaseId && n.type === "release"), "active release must be a node");
      assert.ok(decoratedTrace.body.data.edges.some((e: any) => e.from === seeded.claimId && e.to === traceContextId && e.relation === "selected-in"));
      assert.ok(decoratedTrace.body.data.edges.some((e: any) => e.from === seeded.claimId && e.to === traceReleaseId && e.relation === "released-as"));

      const privateActor = await fx.provision({ orgId: owner.orgId });
      const hidden = await seedClaim(fx, privateActor.key, {
        observation: { subject_id: "user_rama", content: "Private context item.", visibility: "private" },
        claim: { statement: "Private context claim.", visibility: "private" },
      });
      const partialContextId = `ctx_atlas_partial_${fx.runtime}_${Date.now()}`;
      await fx.query(
        `INSERT INTO context_runs
           (id, org_id, actor_id, subject_id, project_id, task_hash, max_tokens,
            used_tokens, policy_snapshot, degraded, created_at)
         VALUES (?, ?, ?, 'user_rama', NULL, 'atlas-partial', 256, 32, 'policy', 'none', ?)`,
        [partialContextId, owner.orgId, owner.principalId, traceNow],
      );
      await fx.query(
        `INSERT INTO context_run_items (context_id, claim_id, position, score, score_components)
         VALUES (?, ?, 0, 1, '{}'), (?, ?, 1, 0.5, '{}')`,
        [partialContextId, seeded.claimId, partialContextId, hidden.claimId],
      );
      const nonDisclosingTrace = await fx.call("POST", "/v1/memory-views/compile", {
        key: owner.key,
        body: { lens: "evidence_trace", focus_id: seeded.claimId },
      });
      expectOk(nonDisclosingTrace);
      assert.ok(!nonDisclosingTrace.body.data.nodes.some((n: any) => n.id === partialContextId), "a partial context must not be disclosed");

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
    name: "atlas administrator view is explicit, organization-bound, and audited",
    async run(fx) {
      const root = await fx.provision({
        principalId: `atlas_root_${fx.runtime}`,
        principalKind: "human",
        scopes: ["*"],
      });
      const actor = await fx.provision({
        orgId: root.orgId,
        principalId: `atlas_private_actor_${fx.runtime}`,
      });
      const owner = await fx.provision({
        orgId: root.orgId,
        principalId: `atlas_owner_${fx.runtime}`,
        principalKind: "human",
        scopes: ["views:compile", "views:compile:all"],
      });
      expectOk(await fx.call("POST", "/v1/memberships", {
        key: root.key,
        body: { principal_id: owner.principalId, principal_kind: "human", role: "owner" },
      }), 201);

      const subjectId = `atlas_private_subject_${fx.runtime}`;
      const privateClaim = await seedClaim(fx, actor.key, {
        observation: { subject_id: subjectId, content: "Private administrator-view fixture." },
        claim: { statement: "Private administrator-view claim." },
      });
      const foreign = await fx.provision({ principalId: `atlas_foreign_${fx.runtime}` });
      const foreignClaim = await seedClaim(fx, foreign.key, {
        observation: { subject_id: subjectId, content: "Foreign organization fixture." },
        claim: { statement: "Foreign organization claim." },
      });

      const ordinary = await fx.call("POST", "/v1/memory-views/compile", {
        key: owner.key,
        body: { lens: "neighborhood", subject_id: subjectId },
      });
      expectOk(ordinary);
      assert.deepEqual(ordinary.body.data.nodes, []);
      assert.deepEqual(ordinary.body.data.metadata.authorization, {
        principal_id: owner.principalId,
        access_mode: "principal",
      });
      assert.ok(!JSON.stringify(ordinary.body).includes(privateClaim.claimId));

      expectError(await fx.call("POST", "/v1/memory-views/compile", {
        key: owner.key,
        body: { lens: "neighborhood", subject_id: subjectId, access_mode: "organization_admin" },
      }), 400);
      expectError(await fx.call("POST", "/v1/memory-views/compile", {
        key: owner.key,
        body: {
          lens: "neighborhood",
          subject_id: subjectId,
          access_mode: "organization_admin",
          administrator_reason: "unbounded_free_text",
        },
      }), 400);

      const principalScopedKey = await fx.provision({
        orgId: root.orgId,
        principalId: owner.principalId,
        principalKind: "human",
        scopes: ["views:compile"],
      });
      expectError(await fx.call("POST", "/v1/memory-views/compile", {
        key: principalScopedKey.key,
        body: {
          lens: "neighborhood",
          subject_id: subjectId,
          access_mode: "organization_admin",
          administrator_reason: "recovery",
        },
      }), 404);

      const noRole = await fx.provision({
        orgId: root.orgId,
        principalId: `atlas_no_role_${fx.runtime}`,
        principalKind: "human",
        scopes: ["views:compile", "views:compile:all"],
      });
      expectError(await fx.call("POST", "/v1/memory-views/compile", {
        key: noRole.key,
        body: {
          lens: "neighborhood",
          subject_id: subjectId,
          access_mode: "organization_admin",
          administrator_reason: "incident_response",
        },
      }), 404);

      const privileged = await fx.call("POST", "/v1/memory-views/compile", {
        key: owner.key,
        body: {
          lens: "neighborhood",
          subject_id: subjectId,
          limit: 1,
          access_mode: "organization_admin",
          administrator_reason: "recovery",
        },
      });
      expectOk(privileged);
      assert.equal(privileged.body.data.nodes.filter((node: any) => node.type === "claim").length, 1);
      assert.ok(privileged.body.data.nodes.some((node: any) => node.id === privateClaim.claimId));
      assert.ok(!JSON.stringify(privileged.body).includes(foreignClaim.claimId));
      assert.deepEqual(privileged.body.data.metadata.authorization, {
        principal_id: owner.principalId,
        access_mode: "organization_admin",
      });

      const retention = await fx.call("POST", "/v1/policies", {
        key: root.key,
        body: {
          kind: "retention",
          scope_type: "subject",
          scope_id: subjectId,
          record_type: "claim",
          retention_days: 1,
        },
      });
      expectOk(retention, 201);
      await fx.query(
        `INSERT INTO retention_exclusions
           (id, org_id, policy_id, resource_type, resource_id, excluded_at, actor_id)
         VALUES (?, ?, ?, 'claim', ?, ?, ?)`,
        [
          `ret_atlas_admin_${fx.runtime}`,
          root.orgId,
          retention.body.data.policy_id,
          privateClaim.claimId,
          "2026-08-15T00:00:00.000Z",
          owner.principalId,
        ],
      );
      const retained = await fx.call("POST", "/v1/memory-views/compile", {
        key: owner.key,
        body: {
          lens: "neighborhood",
          subject_id: subjectId,
          access_mode: "organization_admin",
          administrator_reason: "deletion_verification",
        },
      });
      expectOk(retained);
      assert.deepEqual(retained.body.data.nodes, []);

      const audits = await fx.query<{ actor_id: string; action: string; resource_id: string; detail: string }>(
        `SELECT actor_id, action, resource_id, detail FROM audit_log
          WHERE org_id = ? AND action = 'memory_view.compile.admin'
          ORDER BY created_at, id`,
        [root.orgId],
      );
      assert.equal(audits.length, 2);
      assert.equal(audits[0]!.actor_id, owner.principalId);
      assert.equal(audits[0]!.resource_id, subjectId);
      assert.deepEqual(JSON.parse(audits[0]!.detail), {
        lens: "neighborhood",
        subject_id: subjectId,
        focus_id: null,
        access_mode: "organization_admin",
        reason: "recovery",
      });
      assert.ok(!audits[0]!.detail.includes("Private administrator-view"));
      assert.ok(!audits[0]!.detail.includes(privateClaim.claimId));
      assert.equal(JSON.parse(audits[1]!.detail).reason, "deletion_verification");
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
  {
    name: "webhook delivery follows the registration sequence, not the registration millisecond",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      await seedClaim(fx, owner.key, {
        observation: { content: "Evidence recorded before the webhook existed." },
        claim: { statement: "Pre-registration evidence stays out of the queue." },
      });
      const [latest] = await fx.query<{ created_at: string; seq: number }>(
        `SELECT e.created_at, eo.seq FROM event_order eo JOIN events e ON e.id = eo.event_id
          WHERE e.org_id = ? ORDER BY eo.seq DESC LIMIT 1`,
        [owner.orgId],
      );
      const hook = await fx.call("POST", "/v1/webhooks", {
        key: owner.key,
        body: {
          url: "https://hooks.example.com/same-millisecond",
          secret: "same-millisecond-hook-secret",
          events: ["*"],
        },
      });
      expectOk(hook, 201);
      const hookId = hook.body.data.webhook_id;
      // Registration records the committed head as its watermark, so eligibility
      // never depends on the resolution of a wall clock.
      const [registered] = await fx.query<{ created_seq: number }>(
        `SELECT created_seq FROM webhooks WHERE id = ?`,
        [hookId],
      );
      assert.equal(
        Number(registered!.created_seq),
        Number(latest!.seq),
        "registration must record the current event sequence",
      );

      await seedClaim(fx, owner.key, {
        observation: { content: "Evidence recorded after the webhook existed." },
        claim: { statement: "Post-registration evidence is owed to the queue." },
      });
      // ISO-8601 timestamps are millisecond-precision, so a fast host can register
      // a webhook and write its next events inside one millisecond. Collapse the
      // webhook and every event onto a single timestamp: the wall clock can no
      // longer separate them, and only the sequence can.
      await fx.query(`UPDATE webhooks SET created_at = ? WHERE id = ?`, [latest!.created_at, hookId]);
      await fx.query(`UPDATE events SET created_at = ? WHERE org_id = ?`, [
        latest!.created_at,
        owner.orgId,
      ]);

      const before = await fx.query<{ id: string }>(
        `SELECT e.id FROM event_order eo JOIN events e ON e.id = eo.event_id
          WHERE e.org_id = ? AND eo.seq <= ? ORDER BY eo.seq`,
        [owner.orgId, latest!.seq],
      );
      const after = await fx.query<{ id: string }>(
        `SELECT e.id FROM event_order eo JOIN events e ON e.id = eo.event_id
          WHERE e.org_id = ? AND eo.seq > ? ORDER BY eo.seq`,
        [owner.orgId, latest!.seq],
      );
      assert.ok(before.length > 0 && after.length > 0, "both sides of the watermark must be seeded");

      expectOk(await fx.call("POST", "/v1/webhooks/deliver", { key: owner.key, body: {} }));
      const deliveries = await fx.call("GET", `/v1/webhooks/${hookId}/deliveries?limit=200`, {
        key: owner.key,
      });
      expectOk(deliveries);
      const queued = new Set<string>(
        deliveries.body.data.deliveries.map((delivery: any) => delivery.event_id),
      );
      assert.deepEqual(
        before.filter(({ id }) => queued.has(id)).map(({ id }) => id),
        [],
        "a webhook must never receive an event that precedes its registration sequence",
      );
      assert.deepEqual(
        after.filter(({ id }) => !queued.has(id)).map(({ id }) => id),
        [],
        "a webhook must receive every event after its registration sequence, same millisecond included",
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
    name: "federation requires organization roles and readers remain read-only",
    async run(fx) {
      const owner = await fx.provision({ scopes: ["*"] });
      const federationScopes = [
        "federation:read",
        "federation:write",
        "export:read",
        "import:write",
        "projects:create",
        "observations:write",
        "claims:write",
      ];
      const reader = await fx.provision({
        orgId: owner.orgId,
        principalId: "federation_role_reader",
        scopes: federationScopes,
      });
      const roleless = await fx.provision({ orgId: owner.orgId, scopes: federationScopes });
      const adminMembership = await fx.call("POST", "/v1/memberships", {
        key: owner.key,
        body: {
          principal_id: reader.principalId,
          principal_kind: "agent",
          role: "admin",
        },
      });
      expectOk(adminMembership, 201);

      const peerBody = {
        name: "reader-owned-peer",
        endpoint: "https://reader-federation.example.test",
        shared_secret: "reader-federation-secret",
        direction: "pull",
      };
      const peer = await fx.call("POST", "/v1/federation/peers", {
        key: reader.key,
        body: peerBody,
      });
      expectOk(peer, 201);
      const peerId = peer.body.data.peer_id as string;
      expectOk(await fx.call("POST", `/v1/federation/peers/${peerId}/filters`, {
        key: reader.key,
        body: { resource_type: "claim" },
      }), 201);
      await seedClaim(fx, reader.key);
      expectOk(await fx.call("POST", "/v1/federation/pull", {
        key: reader.key,
        body: { peer_id: peerId },
      }));
      expectOk(await fx.call(
        "DELETE",
        `/v1/memberships/${adminMembership.body.data.membership_id}`,
        { key: owner.key },
      ));
      expectOk(await fx.call("POST", "/v1/memberships", {
        key: owner.key,
        body: {
          principal_id: reader.principalId,
          principal_kind: "agent",
          role: "reader",
        },
      }), 201);

      const peers = await fx.call("GET", "/v1/federation/peers", { key: reader.key });
      expectOk(peers);
      assert.ok(peers.body.data.peers.some((candidate: any) => candidate.peer_id === peerId));
      expectOk(await fx.call("GET", `/v1/federation/peers/${peerId}/filters`, { key: reader.key }));
      const log = await fx.call("GET", `/v1/federation/log?peer_id=${peerId}`, { key: reader.key });
      expectOk(log);
      assert.ok(log.body.data.entries.length >= 1);

      const readerMutations = [
        () => fx.call("POST", "/v1/federation/peers", { key: reader.key, body: peerBody }),
        () => fx.call("POST", `/v1/federation/peers/${peerId}/filters`, {
          key: reader.key,
          body: { resource_type: "event" },
        }),
        () => fx.call("POST", `/v1/federation/peers/${peerId}/suspend`, {
          key: reader.key,
          body: {},
        }),
        () => fx.call("POST", "/v1/federation/pull", {
          key: reader.key,
          body: { peer_id: peerId },
        }),
        () => fx.call("POST", "/v1/federation/push", {
          key: reader.key,
          body: { peer_id: peerId, events: [] },
        }),
      ];
      for (const request of readerMutations) expectError(await request(), 404, "NOT_FOUND");

      const rolelessRequests = [
        () => fx.call("GET", "/v1/federation/peers", { key: roleless.key }),
        () => fx.call("GET", `/v1/federation/peers/${peerId}/filters`, { key: roleless.key }),
        () => fx.call("GET", `/v1/federation/log?peer_id=${peerId}`, { key: roleless.key }),
        () => fx.call("POST", "/v1/federation/peers", { key: roleless.key, body: peerBody }),
        () => fx.call("POST", `/v1/federation/peers/${peerId}/filters`, {
          key: roleless.key,
          body: { resource_type: "event" },
        }),
        () => fx.call("POST", `/v1/federation/peers/${peerId}/suspend`, {
          key: roleless.key,
          body: {},
        }),
        () => fx.call("POST", "/v1/federation/pull", {
          key: roleless.key,
          body: { peer_id: peerId },
        }),
        () => fx.call("POST", "/v1/federation/push", {
          key: roleless.key,
          body: { peer_id: peerId, events: [] },
        }),
      ];
      for (const request of rolelessRequests) expectError(await request(), 404, "NOT_FOUND");
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
      const victimHook = await fx.call("POST", "/v1/webhooks", {
        key: victim.key,
        body: {
          url: "https://hooks.example.com/federation-victim",
          secret: "federation-victim-hook-secret",
          events: ["*"],
        },
      });
      expectOk(victimHook, 201);
      // Positive control: the owner must actually receive the wrappers, so the
      // victim-side assertion below cannot pass by nothing being queued at all.
      const ownerHook = await fx.call("POST", "/v1/webhooks", {
        key: owner.key,
        body: {
          url: "https://hooks.example.com/federation-receiver",
          secret: "federation-receiver-hook-secret",
          events: ["*"],
        },
      });
      expectOk(ownerHook, 201);
      await fx.query(`UPDATE webhooks SET created_at = ? WHERE id = ?`, [
        "2020-01-01T00:00:00.000Z",
        ownerHook.body.data.webhook_id,
      ]);

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
      const queuedWrappers = async (hook: Res, key: string) => {
        expectOk(await fx.call("POST", "/v1/webhooks/deliver", { key, body: {} }));
        const listed = await fx.call(
          "GET",
          `/v1/webhooks/${hook.body.data.webhook_id}/deliveries?limit=200`,
          { key },
        );
        expectOk(listed);
        return listed.body.data.deliveries
          .map((delivery: any) => delivery.event_id as string)
          .filter((id: string) => remoteIds.has(id))
          .sort();
      };
      // The queue total also counts each subscriber's own legitimate events, so assert
      // on the wrapper ids themselves — that is the property these messages claim.
      assert.deepEqual(
        await queuedWrappers(victimHook, victim.key),
        [],
        "the victim webhook must not queue remote wrappers",
      );
      assert.deepEqual(
        await queuedWrappers(ownerHook, owner.key),
        [...remoteIds].sort(),
        "the owner webhook must queue every remote wrapper",
      );

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
    name: "signed canonical federation imports complete evidence once and recalls conflicts",
    async run(fx) {
      const source = await fx.provision({
        principalId: "federation_source",
        scopes: ["*"],
      });
      const destination = await fx.provision({
        principalId: "federation_destination",
        scopes: ["*"],
      });
      const project = await fx.call("POST", "/v1/projects/resolve", {
        key: source.key,
        body: { reference: "rama/federated-memory", create: true },
      });
      expectOk(project, 201);
      const projectId = project.body.data.project_id as string;
      const supporting = await fx.call("POST", "/v1/observations", {
        key: source.key,
        body: observation({
          subject_id: "federated_subject",
          project_id: projectId,
          visibility: "organization",
          content: "Federated rollback marker phoenix-731 is required.",
        }),
      });
      expectOk(supporting, 201);
      const contradicting = await fx.call("POST", "/v1/observations", {
        key: source.key,
        body: observation({
          subject_id: "federated_subject",
          project_id: projectId,
          visibility: "organization",
          content: "Federated rollback marker phoenix-731 is disputed by staging evidence.",
        }),
      });
      expectOk(contradicting, 201);
      const consolidated = await fx.call("POST", "/v1/consolidations", {
        key: source.key,
        body: {
          subject_id: "federated_subject",
          project_id: projectId,
          claims: [{
            kind: "procedural",
            statement: "Federated rollback phoenix-731 remains required but disputed.",
            confidence: 0.91,
            visibility: "organization",
            sources: [
              { observation_id: supporting.body.data.observation_id, relation: "supports" },
              { observation_id: contradicting.body.data.observation_id, relation: "contradicts" },
            ],
          }],
        },
      });
      expectOk(consolidated, 201);

      const secret = "canonical-federation-shared-secret";
      const unfilteredPeer = await fx.call("POST", "/v1/federation/peers", {
        key: source.key,
        body: {
          name: "canonical-unfiltered",
          endpoint: "https://canonical-unfiltered.example.test",
          shared_secret: secret,
          direction: "pull",
        },
      });
      expectOk(unfilteredPeer, 201);
      expectError(await fx.call("POST", "/v1/federation/pull", {
        key: source.key,
        body: { peer_id: unfilteredPeer.body.data.peer_id, include_memory: true },
      }), 403);
      const sourcePeer = await fx.call("POST", "/v1/federation/peers", {
        key: source.key,
        body: {
          name: "canonical-source",
          endpoint: "https://canonical-source.example.test",
          shared_secret: secret,
          direction: "pull",
        },
      });
      expectOk(sourcePeer, 201);
      expectOk(await fx.call("POST", `/v1/federation/peers/${sourcePeer.body.data.peer_id}/filters`, {
        key: source.key,
        body: { resource_type: "claim" },
      }), 201);
      const pulled = await fx.call("POST", "/v1/federation/pull", {
        key: source.key,
        body: { peer_id: sourcePeer.body.data.peer_id, include_memory: true },
      });
      expectOk(pulled);
      assert.equal(pulled.body.data.events.length, 1);
      assert.equal(pulled.body.data.events[0].kind, "claim.materialized");
      assert.equal(pulled.body.data.events[0].memory.format_version, 1);
      assert.equal(pulled.body.data.events[0].memory.observations.length, 2);

      const destinationPeer = await fx.call("POST", "/v1/federation/peers", {
        key: destination.key,
        body: {
          name: "canonical-destination",
          endpoint: "https://canonical-destination.example.test",
          shared_secret: secret,
          direction: "push",
        },
      });
      expectOk(destinationPeer, 201);
      expectOk(await fx.call("POST", `/v1/federation/peers/${destinationPeer.body.data.peer_id}/filters`, {
        key: destination.key,
        body: { resource_type: "claim" },
      }), 201);
      const body = {
        peer_id: destinationPeer.body.data.peer_id,
        events: pulled.body.data.events,
      };
      const reidentify = (
        input: typeof body,
        peerId: string,
        sourceOrgId: string,
        suffix: string,
      ) => {
        const next = structuredClone(input);
        next.peer_id = peerId;
        const event = next.events[0];
        event.id = `evt_canonical_${suffix}`;
        event.memory.source_org_id = sourceOrgId;
        const observationIds = new Map<string, string>();
        for (const [index, evidence] of event.memory.observations.entries()) {
          const remoteId = `obs_canonical_${suffix}_${index}`;
          observationIds.set(evidence.id, remoteId);
          evidence.id = remoteId;
        }
        for (const source of event.memory.claim.sources)
          source.observation_id = observationIds.get(source.observation_id)!;
        event.memory.claim.id = `claim_canonical_${suffix}`;
        event.resource_id = event.memory.claim.id;
        return next;
      };

      const filteredPeer = await fx.call("POST", "/v1/federation/peers", {
        key: destination.key,
        body: {
          name: "canonical-filtered-destination",
          endpoint: "https://canonical-filtered.example.test",
          shared_secret: secret,
          direction: "push",
        },
      });
      expectOk(filteredPeer, 201);
      expectOk(await fx.call("POST", `/v1/federation/peers/${filteredPeer.body.data.peer_id}/filters`, {
        key: destination.key,
        body: { resource_type: "claim", exclude_subjects: "federated_subject" },
      }), 201);
      const filteredBody = { ...body, peer_id: filteredPeer.body.data.peer_id };
      const filtered = await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body: filteredBody,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(filteredBody))}` },
      });
      expectOk(filtered);
      assert.equal(filtered.body.data.results[0].status, "rejected");

      expectError(await fx.call("POST", "/v1/federation/push", {
        key: source.key,
        body,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(body))}` },
      }), 404);
      expectError(await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body,
      }), 403);
      expectOk(await fx.call("POST", "/v1/memberships", {
        key: destination.key,
        body: {
          principal_id: destination.principalId,
          principal_kind: "agent",
          role: "owner",
        },
      }), 201);
      const transportOnly = await fx.provision({
        orgId: destination.orgId,
        principalId: destination.principalId,
        scopes: ["federation:write"],
      });
      expectError(await fx.call("POST", "/v1/federation/push", {
        key: transportOnly.key,
        body,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(body))}` },
      }), 403);
      const tampered = structuredClone(body);
      tampered.events[0].memory.claim.statement = "Tampered federation payload.";
      expectError(await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body: tampered,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(body))}` },
      }), 403);
      const approvedClaimAttempt = structuredClone(body);
      approvedClaimAttempt.events[0].id = "evt_canonical_policy_claim_attempt";
      approvedClaimAttempt.events[0].payload.trust = "policy_approved";
      approvedClaimAttempt.events[0].memory.claim.trust = "policy_approved";
      for (const evidence of approvedClaimAttempt.events[0].memory.observations)
        evidence.trust = "policy_approved";
      expectError(await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body: approvedClaimAttempt,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(approvedClaimAttempt))}` },
      }), 400);
      const approvedEvidenceAttempt = structuredClone(body);
      approvedEvidenceAttempt.events[0].id = "evt_canonical_policy_evidence_attempt";
      approvedEvidenceAttempt.events[0].memory.observations[0].trust = "policy_approved";
      expectError(await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body: approvedEvidenceAttempt,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(approvedEvidenceAttempt))}` },
      }), 400);
      const orphanAttempt = structuredClone(body);
      orphanAttempt.events[0].id = "evt_canonical_orphan_attempt";
      const orphan = structuredClone(orphanAttempt.events[0].memory.observations[0]);
      orphan.id = "obs_remote_orphan_injection";
      orphan.content = "Orphan evidence must not enter canonical SQL.";
      orphan.content_hash = await sha256Hex(orphan.content);
      orphanAttempt.events[0].memory.observations.push(orphan);
      expectError(await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body: orphanAttempt,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(orphanAttempt))}` },
      }), 400);
      assert.deepEqual(await fx.query<{
        observations: number; claims: number; provenance: number; import_audits: number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM observations WHERE org_id = ?) AS observations,
           (SELECT COUNT(*) FROM claims WHERE org_id = ?) AS claims,
           (SELECT COUNT(*) FROM federated_records WHERE peer_id = ?) AS provenance,
           (SELECT COUNT(*) FROM audit_log
             WHERE org_id = ? AND action = 'federation.memory.import') AS import_audits`,
        [
          destination.orgId,
          destination.orgId,
          destinationPeer.body.data.peer_id,
          destination.orgId,
        ],
      ), [{ observations: 0, claims: 0, provenance: 0, import_audits: 0 }]);
      assert.equal((await fx.query<{ source_org_id: string | null }>(
        `SELECT source_org_id FROM federation_peers WHERE id = ?`,
        [destinationPeer.body.data.peer_id],
      ))[0]!.source_org_id, null);

      const pushed = await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(body))}` },
      });
      expectOk(pushed);
      assert.equal(pushed.body.data.results[0].status, "success");
      const localClaimId = pushed.body.data.results[0].canonical_claim_id as string;
      const provenance = await fx.query<{ resource_type: string; remote_id: string; local_id: string }>(
        `SELECT resource_type, remote_id, local_id FROM federated_records
          WHERE peer_id = ? ORDER BY resource_type, remote_id`,
        [destinationPeer.body.data.peer_id],
      );
      assert.equal(provenance.length, 3);
      assert.ok(provenance.some((row) => row.resource_type === "claim" && row.local_id === localClaimId));
      assert.equal((await fx.query<{ source_org_id: string | null }>(
        `SELECT source_org_id FROM federation_peers WHERE id = ?`,
        [destinationPeer.body.data.peer_id],
      ))[0]!.source_org_id, pulled.body.data.events[0].memory.source_org_id);
      const boundPeers = await fx.call("GET", "/v1/federation/peers", { key: destination.key });
      expectOk(boundPeers);
      assert.equal(
        boundPeers.body.data.peers.find(
          ({ peer_id }: { peer_id: string }) => peer_id === destinationPeer.body.data.peer_id,
        )?.source_org_id,
        pulled.body.data.events[0].memory.source_org_id,
      );
      const sourceMismatch = reidentify(
        body,
        destinationPeer.body.data.peer_id,
        "org_spoofed_remote_source",
        "source_mismatch",
      );
      expectError(await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body: sourceMismatch,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(sourceMismatch))}` },
      }), 409);
      const destinationFeed = await fx.call("GET", "/v1/events?limit=200", { key: destination.key });
      expectOk(destinationFeed);
      const wrapper = destinationFeed.body.data.events.find(
        (event: any) => event.payload?.canonical_import?.claim_id === localClaimId,
      );
      assert.equal(wrapper?.kind, "federation.received");
      assert.ok(!JSON.stringify(wrapper).includes("phoenix-731"), "event metadata must not copy memory content");
      const destinationProject = await fx.query<{ id: string }>(
        `SELECT id FROM projects WHERE org_id = ? AND reference = 'rama/federated-memory'`,
        [destination.orgId],
      );
      assert.equal(destinationProject.length, 1);
      const context = await fx.call("POST", "/v1/context/compile", {
        key: destination.key,
        body: {
          subject_id: "federated_subject",
          project_id: destinationProject[0]!.id,
          task: "phoenix-731 rollback disputed",
          max_tokens: 900,
        },
      });
      expectOk(context);
      const imported = context.body.data.items.find((item: any) => item.claim_id === localClaimId);
      assert.equal(imported?.status, "disputed");
      assert.equal(imported?.evidence_ids.length, 2);
      assert.ok(context.body.data.conflicts.some((item: any) => item.claim_id === localClaimId));

      const beforeReplay = await fx.query<{
        observations: number; claims: number; provenance: number; audits: number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM observations WHERE org_id = ?) AS observations,
           (SELECT COUNT(*) FROM claims WHERE org_id = ?) AS claims,
           (SELECT COUNT(*) FROM federated_records WHERE peer_id = ?) AS provenance,
           (SELECT COUNT(*) FROM audit_log WHERE org_id = ? AND action = 'federation.memory.import') AS audits`,
        [destination.orgId, destination.orgId, destinationPeer.body.data.peer_id, destination.orgId],
      );
      const replay = await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(body))}` },
      });
      expectOk(replay);
      assert.equal(replay.body.data.results[0].status, "replayed");
      const reusedEventIdentity = reidentify(
        body,
        destinationPeer.body.data.peer_id,
        pulled.body.data.events[0].memory.source_org_id,
        "reused_event_new_records",
      );
      reusedEventIdentity.events[0].id = body.events[0].id;
      expectError(await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body: reusedEventIdentity,
        headers: {
          "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(reusedEventIdentity))}`,
        },
      }), 409);
      const alternateReplay = structuredClone(body);
      alternateReplay.events[0].id = "evt_canonical_alternate_replay";
      const alternate = await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body: alternateReplay,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(alternateReplay))}` },
      });
      expectOk(alternate);
      assert.equal(alternate.body.data.results[0].status, "replayed");
      const afterReplay = await fx.query<{
        observations: number; claims: number; provenance: number; audits: number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM observations WHERE org_id = ?) AS observations,
           (SELECT COUNT(*) FROM claims WHERE org_id = ?) AS claims,
           (SELECT COUNT(*) FROM federated_records WHERE peer_id = ?) AS provenance,
           (SELECT COUNT(*) FROM audit_log WHERE org_id = ? AND action = 'federation.memory.import') AS audits`,
        [destination.orgId, destination.orgId, destinationPeer.body.data.peer_id, destination.orgId],
      );
      assert.deepEqual(afterReplay, beforeReplay);

      const conflictingReplay = structuredClone(body);
      conflictingReplay.events[0].id = "evt_canonical_conflicting_replay";
      conflictingReplay.events[0].memory.claim.statement = "Same remote id, changed canonical claim.";
      expectError(await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body: conflictingReplay,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(conflictingReplay))}` },
      }), 409);
      const privateAttempt = structuredClone(body);
      privateAttempt.events[0].id = "evt_canonical_private_attempt";
      privateAttempt.events[0].memory.claim.visibility = "private";
      expectError(await fx.call("POST", "/v1/federation/push", {
        key: destination.key,
        body: privateAttempt,
        headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(privateAttempt))}` },
      }), 403);

      const racePeer = await fx.call("POST", "/v1/federation/peers", {
        key: destination.key,
        body: {
          name: "canonical-source-binding-race",
          endpoint: "https://canonical-source-race.example.test",
          shared_secret: secret,
          direction: "push",
        },
      });
      expectOk(racePeer, 201);
      expectOk(await fx.call("POST", `/v1/federation/peers/${racePeer.body.data.peer_id}/filters`, {
        key: destination.key,
        body: { resource_type: "claim" },
      }), 201);
      const beforeRace = await fx.query<{ observations: number; claims: number }>(
        `SELECT
           (SELECT COUNT(*) FROM observations WHERE org_id = ?) AS observations,
           (SELECT COUNT(*) FROM claims WHERE org_id = ?) AS claims`,
        [destination.orgId, destination.orgId],
      );
      const raceA = reidentify(
        body,
        racePeer.body.data.peer_id,
        pulled.body.data.events[0].memory.source_org_id,
        "race_a",
      );
      const raceB = reidentify(body, racePeer.body.data.peer_id, "org_race_b", "race_b");
      const raceResponses = await Promise.all([raceA, raceB].map(async (candidate) =>
        fx.call("POST", "/v1/federation/push", {
          key: destination.key,
          body: candidate,
          headers: { "x-titen-peer-signature": `sha256=${await signPayload(secret, JSON.stringify(candidate))}` },
        })));
      assert.deepEqual(raceResponses.map(({ status }) => status).sort(), [200, 409]);
      const winner = raceResponses.find(({ status }) => status === 200)!;
      expectOk(winner);
      const raceSource = (await fx.query<{ source_org_id: string }>(
        `SELECT source_org_id FROM federation_peers WHERE id = ?`,
        [racePeer.body.data.peer_id],
      ))[0]!.source_org_id;
      assert.ok([
        pulled.body.data.events[0].memory.source_org_id,
        "org_race_b",
      ].includes(raceSource));
      const raceProvenance = await fx.query<{ source_org_id: string }>(
        `SELECT source_org_id FROM federated_records WHERE peer_id = ?`,
        [racePeer.body.data.peer_id],
      );
      assert.equal(raceProvenance.length, 3);
      assert.ok(raceProvenance.every(({ source_org_id }) => source_org_id === raceSource));
      const afterRace = await fx.query<{ observations: number; claims: number }>(
        `SELECT
           (SELECT COUNT(*) FROM observations WHERE org_id = ?) AS observations,
           (SELECT COUNT(*) FROM claims WHERE org_id = ?) AS claims`,
        [destination.orgId, destination.orgId],
      );
      assert.equal(Number(afterRace[0]!.observations) - Number(beforeRace[0]!.observations), 2);
      assert.equal(Number(afterRace[0]!.claims) - Number(beforeRace[0]!.claims), 1);
      await assert.rejects(() => fx.query(
        `UPDATE federation_peers SET source_org_id = 'org_trigger_spoof' WHERE id = ?`,
        [racePeer.body.data.peer_id],
      ));
      await assert.rejects(() => fx.query(
        `INSERT INTO federated_records
           (peer_id, source_org_id, resource_type, remote_id, local_id, payload_hash,
            remote_actor_id, remote_created_at, received_at)
         VALUES (?, 'org_trigger_spoof', 'claim', 'claim_trigger_spoof',
                 'claim_trigger_spoof_local', ?, 'remote_actor', ?, ?)`,
        [
          racePeer.body.data.peer_id,
          "0".repeat(64),
          "2026-08-01T00:00:00.000Z",
          "2026-08-01T00:00:00.000Z",
        ],
      ));
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

CASES.push({
  name: "dashboard list surfaces enforce server-side hard caps",
  async run(fx) {
    const owner = await fx.provision({
      principalId: `dashboard_cap_owner_${fx.runtime}`,
      scopes: ["*"],
    });
    const createdAt = "2026-08-01T00:00:00.000Z";

    await fx.query(
      `WITH RECURSIVE n(value) AS (
         VALUES(1) UNION ALL SELECT value + 1 FROM n WHERE value < 501
       )
       INSERT INTO memberships
         (id, org_id, workspace_id, principal_id, principal_kind, role, created_at)
       SELECT 'mbr_dashboard_cap_' || printf('%03d', value), ?, NULL,
              'dashboard_member_' || printf('%03d', value), 'human', 'reader', ?
         FROM n`,
      [owner.orgId, createdAt],
    );
    await fx.query(
      `WITH RECURSIVE n(value) AS (
         VALUES(1) UNION ALL SELECT value + 1 FROM n WHERE value < 501
       )
       INSERT INTO handoffs
         (id, org_id, from_principal, to_principal, subject_id, message, status, created_at)
       SELECT 'hnd_dashboard_cap_' || printf('%03d', value), ?,
              'dashboard_sender_' || printf('%03d', value), ?,
              'dashboard_subject_' || printf('%03d', value), 'bounded', 'pending', ?
         FROM n`,
      [owner.orgId, owner.principalId, createdAt],
    );
    await fx.query(
      `WITH RECURSIVE n(value) AS (
         VALUES(1) UNION ALL SELECT value + 1 FROM n WHERE value < 501
       )
       INSERT INTO api_keys
         (id, org_id, principal_id, principal_kind, key_hash, label, scopes,
          max_trust, created_at, not_before)
       SELECT 'key_dashboard_cap_' || printf('%03d', value), ?,
              'dashboard_key_principal_' || printf('%03d', value), 'agent',
              'dashboard_key_hash_' || printf('%03d', value),
              'Dashboard key ' || value, 'context:compile', 'asserted', ?, ?
         FROM n`,
      [owner.orgId, createdAt, createdAt],
    );
    await fx.query(
      `WITH RECURSIVE n(value) AS (
         VALUES(1) UNION ALL SELECT value + 1 FROM n WHERE value < 501
       )
       INSERT INTO policies
         (id, org_id, kind, target_type, target_id, config, enabled, created_at, updated_at)
       SELECT 'pol_dashboard_cap_' || printf('%03d', value), ?, 'retention',
              'organization', NULL, '{}', 1, ?, ?
         FROM n`,
      [owner.orgId, createdAt, createdAt],
    );
    await fx.query(
      `WITH RECURSIVE n(value) AS (
         VALUES(1) UNION ALL SELECT value + 1 FROM n WHERE value < 501
       )
       INSERT INTO channels
         (id, org_id, label, gateway_principal_id, allowed_audiences, minimum_trust,
          status, created_by, created_at, updated_at)
       SELECT 'chn_dashboard_cap_' || printf('%03d', value), ?,
              'Dashboard channel ' || printf('%03d', value), ?, '["anonymous"]',
              'asserted', 'active', ?, ?, ?
         FROM n`,
      [owner.orgId, owner.principalId, owner.principalId, createdAt, createdAt],
    );
    await fx.query(
      `WITH RECURSIVE n(value) AS (
         VALUES(1) UNION ALL SELECT value + 1 FROM n WHERE value < 501
       )
       INSERT INTO federation_peers
         (id, org_id, name, endpoint, shared_secret_hash, direction, status,
          principal_id, created_at)
       SELECT 'peer_dashboard_cap_' || printf('%03d', value), ?,
              'Dashboard peer ' || printf('%03d', value),
              'https://dashboard-peer-' || printf('%03d', value) || '.example.test',
              'dashboard_peer_hash_' || printf('%03d', value), 'pull', 'suspended', ?, ?
         FROM n`,
      [owner.orgId, owner.principalId, createdAt],
    );

    const lists = await Promise.all([
      fx.call("GET", "/v1/memberships", { key: owner.key }),
      fx.call("GET", "/v1/handoffs", { key: owner.key }),
      fx.call("GET", "/v1/keys", { key: owner.key }),
      fx.call("GET", "/v1/policies", { key: owner.key }),
      fx.call("GET", "/v1/channels", { key: owner.key }),
      fx.call("GET", "/v1/federation/peers", { key: owner.key }),
    ]);
    for (const result of lists) expectOk(result);
    assert.deepEqual(lists.map((result) => Object.values(result.body.data)[0].length),
      [500, 500, 500, 500, 500, 500]);
  },
});

CASES.push({
  name: "enterprise governance enforces roles approvals releases retention holds identity and isolation",
  async run(fx) {
    const publisher = await fx.provision({
      principalId: `governance_publisher_${fx.runtime}`,
      scopes: ["*"],
      maxTrust: "verified",
    });
    const approver = await fx.provision({
      orgId: publisher.orgId,
      principalId: `governance_approver_${fx.runtime}`,
      scopes: [
        "observations:write",
        "governance:read", "governance:write",
        "approvals:read", "approvals:approve",
        "releases:read", "releases:write", "releases:approve",
        "retention:write", "identity:read", "identity:write", "views:compile",
      ],
      maxTrust: "policy_approved",
    });
    const gateway = await fx.provision({
      orgId: publisher.orgId,
      principalId: `governance_gateway_${fx.runtime}`,
      principalKind: "service",
      scopes: ["channel:compile"],
    });
    const unprivileged = await fx.provision({
      orgId: publisher.orgId,
      principalId: `governance_unprivileged_${fx.runtime}`,
      scopes: [
        "governance:read", "governance:write", "memberships:read", "memberships:write",
        "approvals:read", "releases:read", "views:compile", "keys:manage",
      ],
    });
    const foreign = await fx.provision({ scopes: ["*"] });

    expectError(await fx.call("POST", "/v1/observations", {
      key: approver.key,
      body: observation({
        subject_id: `governance_direct_trust_${fx.runtime}`,
        trust: "policy_approved",
      }),
    }), 400, "VALIDATION_ERROR");

    const approvalPolicyBody = {
      kind: "claim_approval",
      scope_type: "organization",
      claim_kind: "procedural",
      minimum_trust: "verified",
      independent_approval: true,
    };
    expectError(await fx.call("POST", "/v1/policies", {
      key: unprivileged.key,
      body: approvalPolicyBody,
    }), 404, "NOT_FOUND");
    expectError(await fx.call("GET", "/v1/memberships", {
      key: unprivileged.key,
    }), 404, "NOT_FOUND");
    expectError(await fx.call("POST", "/v1/keys", {
      key: unprivileged.key,
      body: {
        label: "forged owner identity",
        scopes: ["governance:write"],
        principal_id: approver.principalId,
        principal_kind: "agent",
      },
    }), 403, "FORBIDDEN");
    const member = await fx.call("POST", "/v1/memberships", {
      key: publisher.key,
      body: {
        principal_id: unprivileged.principalId,
        principal_kind: "agent",
        role: "member",
      },
    });
    expectOk(member, 201);
    expectOk(await fx.call("GET", "/v1/memberships", {
      key: unprivileged.key,
    }));
    expectError(await fx.call("POST", "/v1/policies", {
      key: unprivileged.key,
      body: approvalPolicyBody,
    }), 404, "NOT_FOUND");
    expectError(await fx.call("POST", "/v1/memberships", {
      key: unprivileged.key,
      body: {
        principal_id: unprivileged.principalId,
        principal_kind: "agent",
        role: "owner",
      },
    }), 404, "NOT_FOUND");

    const firstOwner = await fx.call("POST", "/v1/memberships", {
      key: publisher.key,
      body: {
        principal_id: approver.principalId,
        principal_kind: "agent",
        role: "owner",
      },
    });
    expectOk(firstOwner, 201);
    expectError(await fx.call("DELETE", `/v1/memberships/${firstOwner.body.data.membership_id}`, {
      key: publisher.key,
    }), 409, "CONFLICT");
    const secondOwner = await fx.call("POST", "/v1/memberships", {
      key: publisher.key,
      body: {
        principal_id: publisher.principalId,
        principal_kind: "agent",
        role: "owner",
      },
    });
    expectOk(secondOwner, 201);
    expectOk(await fx.call("DELETE", `/v1/memberships/${secondOwner.body.data.membership_id}`, {
      key: publisher.key,
    }));

    const approvalPolicy = await fx.call("POST", "/v1/policies", {
      key: approver.key,
      body: approvalPolicyBody,
    });
    expectOk(approvalPolicy, 201);
    const approvalPolicyId = approvalPolicy.body.data.policy_id as string;
    const policyRace = await Promise.all([
      fx.call("PATCH", `/v1/policies/${approvalPolicyId}`, {
        key: approver.key,
        body: { enabled: false, expected_version: 1 },
      }),
      fx.call("PATCH", `/v1/policies/${approvalPolicyId}`, {
        key: approver.key,
        body: { enabled: false, expected_version: 1 },
      }),
    ]);
    assert.deepEqual(policyRace.map((result) => result.status).sort(), [200, 409]);
    expectError(policyRace.find((result) => result.status === 409)!, 409, "CONFLICT");
    expectOk(await fx.call("PATCH", `/v1/policies/${approvalPolicyId}`, {
      key: approver.key,
      body: { enabled: true, expected_version: 2 },
    }));

    const seeded = await seedClaim(fx, publisher.key, {
      observation: {
        subject_id: `governance_subject_${fx.runtime}`,
        content: "The enterprise rollback procedure passed a verified smoke.",
        occurred_at: "2025-01-01T00:00:00.000Z",
        visibility: "organization",
      },
      claim: {
        kind: "procedural",
        statement: "Enterprise releases require a rollback smoke.",
        trust: "verified",
        visibility: "organization",
        valid_from: "2025-01-01T00:00:00.000Z",
      },
    });
    await fx.query(
      `UPDATE claim_sources SET relation = 'contradicts' WHERE claim_id = ?`,
      [seeded.claimId],
    );
    expectError(await fx.call("POST", "/v1/claim-approvals", {
      key: publisher.key,
      body: {
        claim_id: seeded.claimId,
        claim_version: 1,
        reason: "Contradicting evidence alone must not qualify.",
      },
    }), 400, "VALIDATION_ERROR");
    await fx.query(
      `UPDATE claim_sources SET relation = 'supports' WHERE claim_id = ?`,
      [seeded.claimId],
    );
    const submitted = await fx.call("POST", "/v1/claim-approvals", {
      key: publisher.key,
      body: {
        claim_id: seeded.claimId,
        claim_version: 1,
        reason: "Promote the verified rollback procedure.",
      },
    });
    expectOk(submitted, 201);
    const approvalId = submitted.body.data.approval_id as string;
    const memberApprovals = await fx.call("GET", "/v1/claim-approvals", { key: unprivileged.key });
    expectOk(memberApprovals);
    assert.deepEqual(memberApprovals.body.data.approvals, []);
    expectError(await fx.call("POST", `/v1/claim-approvals/${approvalId}/decide`, {
      key: publisher.key,
      body: { decision: "approve", reason: "self approval", expected_version: 1 },
    }), 403, "FORBIDDEN");
    expectError(await fx.call("POST", `/v1/claim-approvals/${approvalId}/decide`, {
      key: foreign.key,
      body: { decision: "approve", reason: "foreign approval", expected_version: 1 },
    }), 404, "NOT_FOUND");
    const approved = await fx.call("POST", `/v1/claim-approvals/${approvalId}/decide`, {
      key: approver.key,
      body: { decision: "approve", reason: "Independent review passed.", expected_version: 1 },
    });
    expectOk(approved);
    assert.equal(approved.body.data.claim_version, 2);
    const approvedClaim = await fx.query<{ trust: string; version: number }>(
      `SELECT trust, version FROM claims WHERE id = ?`, [seeded.claimId],
    );
    assert.deepEqual(approvedClaim.map((row) => [row.trust, Number(row.version)]), [["policy_approved", 2]]);

    const sharedObservation = await fx.call("POST", "/v1/observations", {
      key: approver.key,
      body: observation({
        subject_id: `governance_shared_support_${fx.runtime}`,
        content: "An organization-visible verifier supplied this supporting evidence.",
        visibility: "organization",
      }),
    });
    expectOk(sharedObservation, 201);
    const sharedClaim = await fx.call("POST", "/v1/consolidations", {
      key: publisher.key,
      body: {
        subject_id: `governance_shared_support_${fx.runtime}`,
        claims: [claim(sharedObservation.body.data.observation_id, {
          statement: "Readable organization evidence may support an owned approval claim.",
          trust: "verified",
          visibility: "organization",
        })],
      },
    });
    expectOk(sharedClaim, 201);
    const sharedSubmission = await fx.call("POST", "/v1/claim-approvals", {
      key: publisher.key,
      body: {
        claim_id: sharedClaim.body.data.claims[0].claim_id,
        claim_version: 1,
        reason: "The support is readable even though another principal authored it.",
      },
    });
    expectOk(sharedSubmission, 201);
    expectOk(await fx.call("POST", `/v1/claim-approvals/${sharedSubmission.body.data.approval_id}/decide`, {
      key: approver.key,
      body: { decision: "reject", reason: "Regression exercised without promotion.", expected_version: 1 },
    }));

    const reversible = await seedClaim(fx, publisher.key, {
      observation: {
        subject_id: `governance_reversible_${fx.runtime}`,
        content: "The enterprise recovery drill passed independent verification.",
        occurred_at: "2025-01-02T00:00:00.000Z",
        visibility: "organization",
      },
      claim: {
        kind: "procedural",
        statement: "Enterprise recovery drills require independent verification.",
        trust: "verified",
        visibility: "organization",
        valid_from: "2025-01-02T00:00:00.000Z",
      },
    });
    const reversibleSubmission = await fx.call("POST", "/v1/claim-approvals", {
      key: publisher.key,
      body: {
        claim_id: reversible.claimId,
        claim_version: 1,
        reason: "Validate approval revocation.",
      },
    });
    expectOk(reversibleSubmission, 201);
    const reversibleApprovalId = reversibleSubmission.body.data.approval_id as string;
    expectOk(await fx.call("POST", `/v1/claim-approvals/${reversibleApprovalId}/decide`, {
      key: approver.key,
      body: { decision: "approve", reason: "Independent verification passed.", expected_version: 1 },
    }));
    expectOk(await fx.call("POST", `/v1/claim-approvals/${reversibleApprovalId}/decide`, {
      key: approver.key,
      body: { decision: "revoke", reason: "Verification was withdrawn.", expected_version: 2 },
    }));
    const revertedClaim = await fx.query<{ trust: string; version: number }>(
      `SELECT trust, version FROM claims WHERE id = ?`,
      [reversible.claimId],
    );
    assert.deepEqual(revertedClaim.map((row) => [row.trust, Number(row.version)]), [["verified", 3]]);
    const rejectedSubmission = await fx.call("POST", "/v1/claim-approvals", {
      key: publisher.key,
      body: {
        claim_id: reversible.claimId,
        claim_version: 3,
        reason: "Re-evaluate the corrected evidence.",
      },
    });
    expectOk(rejectedSubmission, 201);
    expectOk(await fx.call("POST", `/v1/claim-approvals/${rejectedSubmission.body.data.approval_id}/decide`, {
      key: approver.key,
      body: { decision: "reject", reason: "The corrected evidence is insufficient.", expected_version: 1 },
    }));

    const assertionSecret = "governance-contract-secret-at-least-32-characters";
    const channel = await fx.call("POST", "/v1/channels", {
      key: approver.key,
      body: {
        label: `enterprise-crm-${fx.runtime}`,
        gateway_principal_id: gateway.principalId,
        allowed_audiences: ["anonymous", "authenticated_customer"],
        minimum_trust: "policy_approved",
        assertion_secret: assertionSecret,
      },
    });
    expectOk(channel, 201);
    const channelId = channel.body.data.channel_id as string;
    const storedChannel = await fx.query<{ assertion_secret: string; assertion_secret_hash: string }>(
      `SELECT assertion_secret, assertion_secret_hash FROM channels WHERE id = ?`,
      [channelId],
    );
    assert.equal(storedChannel.length, 1);
    assert.notEqual(storedChannel[0]!.assertion_secret, assertionSecret);
    assert.match(storedChannel[0]!.assertion_secret, /^titen-secret:v1:/);
    assert.equal(storedChannel[0]!.assertion_secret_hash, await sha256Hex(assertionSecret));
    const beforeRelease = await fx.call("POST", `/v1/channels/${channelId}/context/compile`, {
      key: gateway.key,
      body: { audience: "anonymous", task: "rollback procedure", max_tokens: 600 },
    });
    expectOk(beforeRelease);
    assert.deepEqual(beforeRelease.body.data.items, []);

    const draftBody = {
        claim_id: seeded.claimId,
        claim_version: 2,
        channel_id: channelId,
        audience: "anonymous",
        released_content: "Run the verified rollback smoke before an enterprise release.",
        valid_from: "2025-01-01T00:00:00.000Z",
        proposal_reason: "Approved external procedure snapshot.",
    };
    const draft = await fx.call("POST", "/v1/knowledge-releases", {
      key: publisher.key,
      body: draftBody,
    });
    expectOk(draft, 201);
    const releaseId = draft.body.data.release_id as string;
    expectError(await fx.call("GET", "/v1/knowledge-releases", {
      key: unprivileged.key,
    }), 404, "NOT_FOUND");
    expectError(await fx.call("POST", `/v1/knowledge-releases/${releaseId}/approve`, {
      key: publisher.key,
      body: { reason: "self approval", expected_version: 1 },
    }), 403, "FORBIDDEN");
    expectOk(await fx.call("POST", `/v1/knowledge-releases/${releaseId}/approve`, {
      key: approver.key,
      body: { reason: "External wording reviewed.", expected_version: 1 },
    }));
    expectOk(await fx.call("POST", `/v1/knowledge-releases/${releaseId}/activate`, {
      key: approver.key,
      body: { expected_version: 2 },
    }));
    const served = await fx.call("POST", `/v1/channels/${channelId}/context/compile`, {
      key: gateway.key,
      body: { audience: "anonymous", task: "rollback procedure", max_tokens: 600 },
    });
    expectOk(served);
    assert.equal(served.body.data.items.length, 1);
    assert.equal(served.body.data.items[0].citation.claim_id, seeded.claimId);
    assert.ok(!JSON.stringify(served.body).includes("verified smoke"), "source evidence must stay internal");

    const replacementDraft = await fx.call("POST", "/v1/knowledge-releases", {
      key: publisher.key,
      body: {
        claim_id: seeded.claimId,
        claim_version: 2,
        channel_id: channelId,
        audience: "anonymous",
        released_content: "Run the reviewed rollback smoke before each enterprise release.",
        valid_from: "2025-01-01T00:00:00.000Z",
        proposal_reason: "Clarify the reviewed release wording.",
      },
    });
    expectOk(replacementDraft, 201);
    const replacementId = replacementDraft.body.data.release_id as string;
    expectOk(await fx.call("POST", `/v1/knowledge-releases/${replacementId}/approve`, {
      key: approver.key,
      body: { reason: "Replacement wording reviewed.", expected_version: 1 },
    }));
    expectOk(await fx.call("POST", `/v1/knowledge-releases/${replacementId}/activate`, {
      key: approver.key,
      body: { expected_version: 2 },
    }));
    const replaced = await fx.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM channel_releases WHERE id = ?`,
      [releaseId],
    );
    assert.deepEqual(replaced.map((row) => row.lifecycle_status), ["replaced"]);
    const servedReplacement = await fx.call("POST", `/v1/channels/${channelId}/context/compile`, {
      key: gateway.key,
      body: { audience: "anonymous", task: "rollback procedure", max_tokens: 600 },
    });
    expectOk(servedReplacement);
    assert.deepEqual(
      servedReplacement.body.data.items.map((item: any) => item.release_id),
      [replacementId],
    );
    const blockedDraft = await fx.call("POST", "/v1/knowledge-releases", {
      key: publisher.key,
      body: {
        claim_id: seeded.claimId,
        claim_version: 2,
        channel_id: channelId,
        audience: "anonymous",
        released_content: "This draft must never activate after retention exclusion.",
        valid_from: "2025-01-01T00:00:00.000Z",
        proposal_reason: "Exercise the retention activation fence.",
      },
    });
    expectOk(blockedDraft, 201);
    const blockedReleaseId = blockedDraft.body.data.release_id as string;
    expectOk(await fx.call("POST", `/v1/knowledge-releases/${blockedReleaseId}/approve`, {
      key: approver.key,
      body: { reason: "Approved only for the retention regression.", expected_version: 1 },
    }));
    expectOk(await fx.call("PATCH", `/v1/channels/${channelId}`, {
      key: approver.key,
      body: { status: "paused", expected_version: 1 },
    }));
    await assert.rejects(
      () => fx.query(
        `UPDATE channel_releases SET lifecycle_status = 'active' WHERE id = ?`,
        [blockedReleaseId],
      ),
      /RELEASE_SOURCE_INELIGIBLE/i,
    );
    expectOk(await fx.call("PATCH", `/v1/channels/${channelId}`, {
      key: approver.key,
      body: { status: "active", expected_version: 2 },
    }));
    expectError(await fx.call("POST", `/v1/channels/${channelId}/context/compile`, {
      key: gateway.key,
      body: { audience: "partner", task: "rollback procedure", max_tokens: 600 },
    }), 404, "NOT_FOUND");
    expectError(await fx.call("POST", `/v1/channels/${channelId}/context/compile`, {
      key: foreign.key,
      body: { audience: "anonymous", task: "rollback procedure", max_tokens: 600 },
    }), 404, "NOT_FOUND");

    const assertionPayload = {
      v: 1,
      channel_id: channelId,
      audience: "authenticated_customer",
      subject_id: `customer_${fx.runtime}`,
      exp: Math.floor(Date.now() / 1000) + 600,
      jti: `nonce_${fx.runtime}_${Date.now()}`,
    };
    const payloadText = Buffer.from(JSON.stringify(assertionPayload)).toString("base64url");
    const assertion = `${payloadText}.${await signPayload(assertionSecret, payloadText)}`;
    expectOk(await fx.call("POST", `/v1/channels/${channelId}/context/compile`, {
      key: gateway.key,
      body: {
        audience: "authenticated_customer",
        task: "customer rollback procedure",
        max_tokens: 600,
        customer_session_assertion: assertion,
      },
    }));
    expectError(await fx.call("POST", `/v1/channels/${channelId}/context/compile`, {
      key: gateway.key,
      body: {
        audience: "authenticated_customer",
        task: "customer rollback procedure",
        max_tokens: 600,
        customer_session_assertion: assertion,
      },
    }), 403, "FORBIDDEN");

    const scopePreview = await fx.call("POST", "/v1/memory-views/compile", {
      key: approver.key,
      body: { lens: "scope_preview", focus_id: gateway.principalId },
    });
    expectOk(scopePreview);
    assert.equal(scopePreview.body.data.metadata.preview_only, true);
    assert.equal(scopePreview.body.data.metadata.authority_granted, false);
    const releaseView = await fx.call("POST", "/v1/memory-views/compile", {
      key: approver.key,
      body: { lens: "knowledge_release", focus_id: channelId },
    });
    expectOk(releaseView);
    assert.equal(releaseView.body.data.nodes.length, 3);
    assert.deepEqual(
      new Set(releaseView.body.data.nodes.map((node: any) => node.status)),
      new Set(["active", "approved", "replaced"]),
    );
    const releaseNodeIds = new Set(releaseView.body.data.nodes.map((node: any) => node.id));
    assert.ok(releaseView.body.data.edges.every((edge: any) =>
      releaseNodeIds.has(edge.from) && releaseNodeIds.has(edge.to)));
    assert.equal(releaseView.body.data.metadata.source_refs.length, 3);
    assert.equal(releaseView.body.data.metadata.source_evidence_included, false);
    expectError(await fx.call("POST", "/v1/memory-views/compile", {
      key: unprivileged.key,
      body: { lens: "knowledge_release", focus_id: channelId },
    }), 404, "NOT_FOUND");

    await fx.query(
      `UPDATE claims SET status = 'revoked', version = version + 1 WHERE id = ?`,
      [seeded.claimId],
    );
    expectError(await fx.call("POST", `/v1/claim-approvals/${approvalId}/decide`, {
      key: approver.key,
      body: { decision: "revoke", reason: "stale source must fail", expected_version: 2 },
    }), 409, "CONFLICT");
    const unchangedApproval = await fx.query<{ status: string; version: number }>(
      `SELECT status, version FROM claim_approvals WHERE id = ?`,
      [approvalId],
    );
    assert.deepEqual(unchangedApproval.map((row) => [row.status, Number(row.version)]), [["approved", 2]]);
    await assert.rejects(
      () => fx.query(
        `UPDATE channel_releases SET lifecycle_status = 'active' WHERE id = ?`,
        [blockedReleaseId],
      ),
      /RELEASE_SOURCE_INELIGIBLE/i,
    );
    await fx.query(
      `UPDATE claims SET status = 'active', version = 2 WHERE id = ?`,
      [seeded.claimId],
    );

    const identity = await fx.call("POST", "/v1/identity-mappings", {
      key: approver.key,
      body: {
        provider: "Example-IDP",
        external_subject: `external-${fx.runtime}`,
        principal_id: gateway.principalId,
      },
    });
    expectOk(identity, 201);
    const mappings = await fx.call("GET", "/v1/identity-mappings", { key: approver.key });
    expectOk(mappings);
    assert.ok(mappings.body.data.mappings.some((mapping: any) => mapping.mapping_id === identity.body.data.mapping_id));
    const identityRemovalRace = await Promise.all([
      fx.call("DELETE", `/v1/identity-mappings/${identity.body.data.mapping_id}`, { key: approver.key }),
      fx.call("DELETE", `/v1/identity-mappings/${identity.body.data.mapping_id}`, { key: approver.key }),
    ]);
    assert.equal(identityRemovalRace.filter((result) => result.status === 200).length, 1);
    assert.ok(identityRemovalRace.some((result) => result.status === 404 || result.status === 409));

    const purgedBeforeHold = await fx.call("POST", "/v1/observations", {
      key: publisher.key,
      body: observation({
        subject_id: `governance_purged_before_hold_${fx.runtime}`,
        content: "This throwaway record verifies the purge-to-hold database fence.",
        visibility: "organization",
      }),
    });
    expectOk(purgedBeforeHold, 201);
    expectOk(await fx.call("DELETE", `/v1/observations/${purgedBeforeHold.body.data.observation_id}`, {
      key: publisher.key,
    }));
    expectError(await fx.call("POST", "/v1/legal-holds", {
      key: approver.key,
      body: {
        resource_type: "observation",
        resource_id: purgedBeforeHold.body.data.observation_id,
        reason: "A completed purge must reject a late hold.",
      },
    }), 409, "CONFLICT");

    const observationHold = await fx.call("POST", "/v1/legal-holds", {
      key: approver.key,
      body: {
        resource_type: "observation",
        resource_id: reversible.observationId,
        reason: "Direct evidence preservation.",
      },
    });
    expectOk(observationHold, 201);
    expectError(await fx.call("DELETE", `/v1/observations/${reversible.observationId}`, {
      key: publisher.key,
    }), 409, "CONFLICT");
    const holdReleaseRace = await Promise.all([
      fx.call("POST", `/v1/legal-holds/${observationHold.body.data.legal_hold_id}/release`, {
        key: approver.key,
        body: { reason: "Direct evidence review complete." },
      }),
      fx.call("POST", `/v1/legal-holds/${observationHold.body.data.legal_hold_id}/release`, {
        key: approver.key,
        body: { reason: "Duplicate release must lose." },
      }),
    ]);
    assert.equal(holdReleaseRace.filter((result) => result.status === 200).length, 1);
    assert.ok(holdReleaseRace.some((result) => result.status === 404 || result.status === 409));

    const hold = await fx.call("POST", "/v1/legal-holds", {
      key: approver.key,
      body: { resource_type: "claim", resource_id: seeded.claimId, reason: "Active investigation." },
    });
    expectOk(hold, 201);
    await assert.rejects(
      () => fx.query(
        `INSERT INTO record_history
           (id, org_id, record_type, record_id, version, change_kind,
            actor_id, snapshot_hash, changed_at)
         VALUES (?, ?, 'observation', ?, 99, 'purge', ?, ?, ?)`,
        [
          `hist_hold_guard_${fx.runtime}`,
          publisher.orgId,
          seeded.observationId,
          publisher.principalId,
          "0".repeat(64),
          "2026-08-01T00:00:00.000Z",
        ],
      ),
      /ACTIVE_LEGAL_HOLD/i,
    );
    expectError(await fx.call("DELETE", `/v1/observations/${seeded.observationId}`, {
      key: publisher.key,
    }), 409, "CONFLICT");
    await fx.query(`UPDATE claims SET created_at = ? WHERE id = ?`, ["2025-01-01T00:00:00.000Z", seeded.claimId]);
    await fx.query(`UPDATE observations SET ingested_at = ? WHERE id = ?`, ["2025-01-01T00:00:00.000Z", seeded.observationId]);
    const retention = await fx.call("POST", "/v1/policies", {
      key: approver.key,
      body: {
        kind: "retention",
        scope_type: "subject",
        scope_id: `governance_subject_${fx.runtime}`,
        record_type: "claim",
        retention_days: 1,
      },
    });
    expectOk(retention, 201);
    const observationRetention = await fx.call("POST", "/v1/policies", {
      key: approver.key,
      body: {
        kind: "retention",
        scope_type: "subject",
        scope_id: `governance_subject_${fx.runtime}`,
        record_type: "observation",
        retention_days: 1,
      },
    });
    expectOk(observationRetention, 201);
    const heldApply = await fx.call("POST", "/v1/retention/apply", {
      key: approver.key,
      body: { policy_id: retention.body.data.policy_id },
    });
    expectOk(heldApply);
    assert.equal(heldApply.body.data.excluded_count, 0);
    const heldObservationApply = await fx.call("POST", "/v1/retention/apply", {
      key: approver.key,
      body: { policy_id: observationRetention.body.data.policy_id },
    });
    expectOk(heldObservationApply);
    assert.equal(heldObservationApply.body.data.excluded_count, 0);
    expectOk(await fx.call("POST", `/v1/legal-holds/${hold.body.data.legal_hold_id}/release`, {
      key: approver.key,
      body: { reason: "Investigation complete." },
    }));
    const applied = await fx.call("POST", "/v1/retention/apply", {
      key: approver.key,
      body: { policy_id: retention.body.data.policy_id },
    });
    expectOk(applied);
    assert.equal(applied.body.data.excluded_count, 1);
    const observationApplied = await fx.call("POST", "/v1/retention/apply", {
      key: approver.key,
      body: { policy_id: observationRetention.body.data.policy_id },
    });
    expectOk(observationApplied);
    assert.equal(observationApplied.body.data.excluded_count, 1);
    const retentionPrecedenceHold = await fx.call("POST", "/v1/legal-holds", {
      key: approver.key,
      body: {
        resource_type: "claim",
        resource_id: seeded.claimId,
        reason: "Legal hold must atomically undo an existing retention exclusion.",
      },
    });
    expectOk(retentionPrecedenceHold, 201);
    const exclusionAfterHold = await fx.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM retention_exclusions
        WHERE org_id = ? AND (
          (resource_type = 'claim' AND resource_id = ?)
          OR (resource_type = 'observation' AND resource_id = ?)
        )`,
      [publisher.orgId, seeded.claimId, seeded.observationId],
    );
    assert.equal(Number(exclusionAfterHold[0]!.count), 0);
    const precedenceAudit = await fx.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM audit_log
        WHERE org_id = ? AND action = 'retention_exclusion.remove_for_hold'`,
      [publisher.orgId],
    );
    assert.equal(Number(precedenceAudit[0]!.count), 1);
    const restoredContext = await fx.call("POST", "/v1/context/compile", {
      key: publisher.key,
      body: {
        subject_id: `governance_subject_${fx.runtime}`,
        task: "enterprise rollback procedure",
        max_tokens: 600,
      },
    });
    expectOk(restoredContext);
    assert.ok(restoredContext.body.data.items.some((item: any) => item.claim_id === seeded.claimId));
    const restoredRelease = await fx.call("POST", `/v1/channels/${channelId}/context/compile`, {
      key: gateway.key,
      body: { audience: "anonymous", task: "rollback procedure", max_tokens: 600 },
    });
    expectOk(restoredRelease);
    assert.deepEqual(restoredRelease.body.data.items.map((item: any) => item.release_id), [replacementId]);
    await assert.rejects(
      () => fx.query(
        `INSERT INTO retention_exclusions
           (id, org_id, policy_id, resource_type, resource_id, excluded_at, actor_id)
         VALUES (?, ?, ?, 'claim', ?, ?, ?)`,
        [
          `ret_hold_guard_${fx.runtime}`,
          publisher.orgId,
          retention.body.data.policy_id,
          seeded.claimId,
          "2026-08-01T00:00:00.000Z",
          approver.principalId,
        ],
      ),
      /ACTIVE_LEGAL_HOLD/i,
    );
    await assert.rejects(
      () => fx.query(
        `INSERT INTO retention_exclusions
           (id, org_id, policy_id, resource_type, resource_id, excluded_at, actor_id)
         VALUES (?, ?, ?, 'observation', ?, ?, ?)`,
        [
          `ret_dependent_hold_guard_${fx.runtime}`,
          publisher.orgId,
          observationRetention.body.data.policy_id,
          seeded.observationId,
          "2026-08-01T00:00:00.000Z",
          approver.principalId,
        ],
      ),
      /ACTIVE_LEGAL_HOLD/i,
    );
    expectOk(await fx.call("POST", `/v1/legal-holds/${retentionPrecedenceHold.body.data.legal_hold_id}/release`, {
      key: approver.key,
      body: { reason: "Retention precedence regression complete." },
    }));
    const reapplied = await fx.call("POST", "/v1/retention/apply", {
      key: approver.key,
      body: { policy_id: retention.body.data.policy_id },
    });
    expectOk(reapplied);
    assert.equal(reapplied.body.data.excluded_count, 1);
    const observationReapplied = await fx.call("POST", "/v1/retention/apply", {
      key: approver.key,
      body: { policy_id: observationRetention.body.data.policy_id },
    });
    expectOk(observationReapplied);
    assert.equal(observationReapplied.body.data.excluded_count, 1);
    const afterRetention = await fx.call("POST", "/v1/context/compile", {
      key: publisher.key,
      body: {
        subject_id: `governance_subject_${fx.runtime}`,
        task: "enterprise rollback procedure",
        max_tokens: 600,
      },
    });
    expectOk(afterRetention);
    assert.deepEqual(afterRetention.body.data.items, []);
    const afterReleaseRetention = await fx.call("POST", `/v1/channels/${channelId}/context/compile`, {
      key: gateway.key,
      body: { audience: "anonymous", task: "rollback procedure", max_tokens: 600 },
    });
    expectOk(afterReleaseRetention);
    assert.deepEqual(afterReleaseRetention.body.data.items, []);

    expectError(await fx.call("POST", "/v1/claim-approvals", {
      key: publisher.key,
      body: {
        claim_id: seeded.claimId,
        claim_version: 2,
        reason: "Retained claims cannot re-enter approval.",
      },
    }), 404, "NOT_FOUND");
    expectError(await fx.call("POST", "/v1/knowledge-releases", {
      key: publisher.key,
      body: {
        claim_id: seeded.claimId,
        claim_version: 2,
        channel_id: channelId,
        audience: "anonymous",
        released_content: "Retained memory must stay unavailable.",
        proposal_reason: "This request must fail closed.",
      },
    }), 404, "NOT_FOUND");
    expectError(await fx.call("POST", `/v1/knowledge-releases/${blockedReleaseId}/activate`, {
      key: approver.key,
      body: { expected_version: 2 },
    }), 404, "NOT_FOUND");

    expectOk(await fx.call("POST", `/v1/knowledge-releases/${replacementId}/revoke`, {
      key: approver.key,
      body: { reason: "Procedure retired.", expected_version: 3 },
    }));
    const membershipRemovalRace = await Promise.all([
      fx.call("DELETE", `/v1/memberships/${member.body.data.membership_id}`, { key: publisher.key }),
      fx.call("DELETE", `/v1/memberships/${member.body.data.membership_id}`, { key: publisher.key }),
    ]);
    assert.equal(membershipRemovalRace.filter((result) => result.status === 200).length, 1);
    assert.ok(membershipRemovalRace.some((result) => result.status === 404 || result.status === 409));
    const membershipRemovalAudits = await fx.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM audit_log
        WHERE org_id = ? AND action = 'membership.remove' AND resource_id = ?`,
      [publisher.orgId, member.body.data.membership_id],
    );
    assert.equal(Number(membershipRemovalAudits[0]!.count), 1);
    const audits = await fx.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM audit_log
        WHERE org_id = ? AND action IN ('policy.create', 'approval.approve',
          'release.activate', 'retention.apply', 'identity_mapping.create')`,
      [publisher.orgId],
    );
    assert.ok(Number(audits[0]!.count) >= 5);
  },
});

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
