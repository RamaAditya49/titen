import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApp } from "../../src/core/app";
import type { Db } from "../../src/core/db";
import { sha256Hex } from "../../src/core/ids";
import {
  DERIVATION_SCHEMA,
  drainEnrichment,
  ENRICHMENT_LEASE_MS,
  REFLECTION_SCHEMA,
  scheduleReflections,
} from "../../src/core/enrichment";
import {
  ExtractionProviderError,
  type ExtractionCapability,
  type ExtractionRequest,
} from "../../src/core/extraction";
import {
  DEFAULT_SCOPES,
  clientVia,
  provisionWith,
} from "./harness";

interface FrozenCase {
  id: string;
  language: string;
  content: string;
  statement: string;
  query: string;
}

const frozen = JSON.parse(readFileSync(
  new URL("../fixtures/enrichment-multilingual.json", import.meta.url),
  "utf8",
)) as {
  version: number;
  derivation: FrozenCase[];
  reflection: { add_statement: string; link_relation: string };
};

function assertStrictObjects(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.type === "object") {
    assert.equal(record.additionalProperties, false);
    const properties = Object.keys((record.properties ?? {}) as Record<string, unknown>).sort();
    assert.deepEqual([...(record.required as string[] ?? [])].sort(), properties);
  }
  for (const nested of Object.values(record)) assertStrictObjects(nested);
}

function observationId(request: ExtractionRequest): string {
  return (request.input as any).observation.observation_id as string;
}

function observationContent(request: ExtractionRequest): string {
  return (request.input as any).observation.content as string;
}

function proposalFor(request: ExtractionRequest): unknown {
  if (request.lane === "reflection") {
    const premises = (request.input as any).premises as Array<{
      claim_id: string;
      statement: string;
    }>;
    if (premises.some((premise) => premise.statement.includes("REFLECT_ADD")))
      return {
        action: "add",
        claims: [{
          kind: "relationship",
          statement: frozen.reflection.add_statement,
          premise_ids: premises.map((premise) => premise.claim_id),
          valid_from: null,
          valid_to: null,
        }],
        links: null,
      };
    if (premises.length > 1)
      return {
        action: "link",
        claims: null,
        links: [{
          source_claim_id: premises[0]!.claim_id,
          target_claim_id: premises[1]!.claim_id,
          relation: frozen.reflection.link_relation,
        }],
      };
    return { action: "abstain", claims: null, links: null };
  }
  const content = observationContent(request);
  const id = observationId(request);
  if (content.includes("MISSING_FIELD")) return { action: "abstain" };
  if (content.includes("ABSTAIN")) return { action: "abstain", claims: null };
  if (content.includes("AUTHORITY_INJECTION"))
    return {
      action: "add",
      claims: [{
        kind: "semantic_fact",
        statement: "Unsafe authority output.",
        evidence_ids: [id],
        valid_from: null,
        valid_to: null,
        trust: "verified",
      }],
    };
  if (content.includes("FOREIGN_ID"))
    return {
      action: "add",
      claims: [{
        kind: "semantic_fact",
        statement: "Unsafe foreign source output.",
        evidence_ids: ["obs_foreign"],
        valid_from: null,
        valid_to: null,
      }],
    };
  if (content.includes("INVALID_TIME"))
    return {
      action: "add",
      claims: [{
        kind: "semantic_fact",
        statement: "Unsafe temporal output.",
        evidence_ids: [id],
        valid_from: "2026-08-02T00:00:00.000Z",
        valid_to: "2026-08-01T00:00:00.000Z",
      }],
    };
  if (content.includes("MALFORMED_TIME"))
    return {
      action: "add",
      claims: [{
        kind: "semantic_fact",
        statement: "A date without a time is not RFC3339 date-time.",
        evidence_ids: [id],
        valid_from: "2026-08-01",
        valid_to: null,
      }],
    };
  if (content.includes("DUPLICATE_OUTPUT"))
    return {
      action: "add",
      claims: [1, 2].map(() => ({
        kind: "semantic_fact",
        statement: "One proposal must not duplicate a semantic addition.",
        evidence_ids: [id],
        valid_from: null,
        valid_to: null,
      })),
    };
  const fixture = frozen.derivation.find((entry) => entry.content === content);
  return {
    action: "add",
    claims: [{
      kind: "semantic_fact",
      statement: fixture?.statement ?? content,
      evidence_ids: [id],
      valid_from: null,
      valid_to: null,
    }],
  };
}

/** Same P0 enrichment replay against either canonical SQL adapter. */
export async function assertEnrichmentContract(db: Db, runtime: string): Promise<void> {
  assert.equal(frozen.version, 1);
  assertStrictObjects(DERIVATION_SCHEMA);
  assertStrictObjects(REFLECTION_SCHEMA);
  let current = new Date("2026-07-31T08:00:00.000Z");
  let providerFailure: "typed" | "raw" | null = null;
  let hold: Promise<void> | undefined;
  let releaseHold: (() => void) | undefined;
  let held: (() => void) | undefined;
  let holdNext = false;
  let calls = 0;
  const modelRevision = "a".repeat(64);
  const providerIdentity = "https://models.example.test/v1";
  const capability: ExtractionCapability = {
    modelId: "frozen-sol",
    modelFingerprint: modelRevision,
    providerIdentity,
    async generate(request) {
      calls += 1;
      const pendingHold = holdNext ? hold : undefined;
      if (holdNext) {
        holdNext = false;
        held?.();
      }
      if (pendingHold) await pendingHold;
      if (providerFailure === "typed")
        throw new ExtractionProviderError("provider_unavailable", true);
      if (providerFailure === "raw")
        throw new Error("provider secret body must never persist");
      return proposalFor(request);
    },
  };
  const expectedModelFingerprint = await sha256Hex(JSON.stringify({
    provider: providerIdentity,
    model: capability.modelId,
    revision: modelRevision,
  }));

  const createClient = async () => {
    const principal = await provisionWith(db, {
      scopes: [
        ...DEFAULT_SCOPES,
        "observations:purge",
        "enrichment:write",
        "workspaces:write",
        "memberships:write",
      ],
    });
    const app = createApp({
      db,
      runtime,
      revision: "enrichment-contract",
      extraction: capability,
      now: () => current,
      backgroundRepair: { configured: true, staleAfterMs: 60_000 },
      migrationsReady: true,
      secretStorageReady: true,
    });
    return {
      ...principal,
      client: clientVia(app, "http://enrichment.test"),
    };
  };

  const primary = await createClient();
  const observe = async (
    target: Awaited<ReturnType<typeof createClient>>,
    subjectId: string,
    content: string,
    scope?: { workspaceId: string; visibility: "private" | "team" },
  ) => {
    const response = await target.client.call("POST", "/v1/observations", {
      key: target.key,
      body: {
        subject_id: subjectId,
        kind: "user_statement",
        content,
        visibility: scope?.visibility ?? "private",
        ...(scope ? { workspace_id: scope.workspaceId } : {}),
        source: { type: "contract_fixture" },
      },
    });
    assert.equal(response.status, 201);
    return response.body.data.observation_id as string;
  };

  for (const fixture of frozen.derivation)
    await observe(primary, `subject_${fixture.id}`, fixture.content);
  assert.equal(calls, 0, "canonical observation writes must not call the model");
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_jobs
      WHERE org_id = ? AND lane = 'derivation' AND state = 'pending'`,
    [primary.orgId],
  ))[0]!.count), frozen.derivation.length);
  const multilingual = await primary.client.call(
    "POST",
    "/v1/enrichment/drain?limit=10",
    { key: primary.key },
  );
  assert.equal(multilingual.status, 200);
  assert.equal(multilingual.body.data.added, frozen.derivation.length);

  for (const fixture of frozen.derivation) {
    const context = await primary.client.call("POST", "/v1/context/compile", {
      key: primary.key,
      body: {
        subject_id: `subject_${fixture.id}`,
        task: fixture.query,
        max_tokens: 800,
      },
    });
    assert.equal(context.status, 200);
    const item = context.body.data.items.find((entry: any) => entry.claim === fixture.statement);
    assert.ok(item, `${fixture.language} derived claim must be recallable`);
    const evidence = await primary.client.call(
      "GET",
      `/v1/claims/${item.claim_id}/evidence`,
      { key: primary.key },
    );
    assert.equal(evidence.status, 200);
    assert.equal(evidence.body.data.evidence.supporting.length, 1);
    assert.equal(evidence.body.data.claim.enrichment.lane, "derivation");
    assert.equal(evidence.body.data.claim.enrichment.model_fingerprint, expectedModelFingerprint);
  }

  const persisted = await db.all<Record<string, unknown>>(
    `SELECT * FROM enrichment_jobs
      WHERE org_id = ? ORDER BY created_at, id`,
    [primary.orgId],
  );
  assert.equal(persisted.length, frozen.derivation.length);
  for (const row of persisted) {
    const serialized = JSON.stringify(row);
    assert.ok(!frozen.derivation.some((fixture) => serialized.includes(fixture.content)));
    assert.doesNotMatch(serialized, /provider secret body/u);
    assert.doesNotMatch(serialized, /models\.example\.test/u);
    assert.equal(row.model_fingerprint, expectedModelFingerprint);
  }

  current = new Date(current.getTime() + 1_000);
  const abstainObservation = await observe(primary, "subject_abstain", "ABSTAIN no durable memory");
  const abstain = await primary.client.call("POST", "/v1/enrichment/drain?limit=10", {
    key: primary.key,
  });
  assert.equal(abstain.status, 200);
  const abstainJob = await db.all<{ state: string; result_ids: string; result_kind: string }>(
    `SELECT j.state, j.result_ids, c.result_kind
       FROM enrichment_jobs j JOIN enrichment_commits c ON c.job_id = j.id
      WHERE j.org_id = ? AND j.input_ids LIKE ?`,
    [primary.orgId, `%${abstainObservation}%`],
  );
  assert.deepEqual(abstainJob, [{ state: "done", result_ids: "[]", result_kind: "abstain" }]);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claims WHERE org_id = ? AND subject_id = 'subject_abstain'`,
    [primary.orgId],
  ))[0]!.count), 0);

  current = new Date(current.getTime() + 1_000);
  await observe(primary, "subject_reflect_add", "REFLECT_ADD rollback is required.");
  await observe(primary, "subject_reflect_add", "REFLECT_ADD approval is required.");
  await primary.client.call("POST", "/v1/enrichment/drain?limit=10", { key: primary.key });
  current = new Date(current.getTime() + 1_000);
  await primary.client.call("POST", "/v1/enrichment/drain?limit=10", { key: primary.key });
  const reflected = await db.all<{
    id: string;
    enrichment_job_id: string;
  }>(
    `SELECT id, enrichment_job_id FROM claims
      WHERE org_id = ? AND subject_id = 'subject_reflect_add'
        AND statement = ?`,
    [primary.orgId, frozen.reflection.add_statement],
  );
  assert.equal(reflected.length, 1, "one canonical premise set must produce one reflection claim");
  const derivedLinks = await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claim_links
      WHERE org_id = ? AND source_claim_id = ? AND relation = 'derived_from'`,
    [primary.orgId, reflected[0]!.id],
  );
  assert.equal(Number(derivedLinks[0]!.count), 2);

  current = new Date(current.getTime() + 1_000);
  await observe(primary, "subject_reflect_link", "Link candidate one.");
  await observe(primary, "subject_reflect_link", "Link candidate two.");
  await primary.client.call("POST", "/v1/enrichment/drain?limit=10", { key: primary.key });
  current = new Date(current.getTime() + 1_000);
  await primary.client.call("POST", "/v1/enrichment/drain?limit=10", { key: primary.key });
  const candidateLinks = await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claim_links
      WHERE org_id = ? AND relation = 'duplicate_candidate'`,
    [primary.orgId],
  );
  assert.equal(Number(candidateLinks[0]!.count), 1);
  const unchanged = await drainEnrichment({
    db,
    capability,
    limit: 10,
    now: () => current,
    orgId: primary.orgId,
  });
  assert.equal(unchanged.scheduled, 0);
  const versioned = (await db.all<{ id: string }>(
    `SELECT id FROM claims
      WHERE org_id = ? AND subject_id = 'subject_reflect_link'
        AND enrichment_job_id IS NOT NULL
      ORDER BY id LIMIT 1`,
    [primary.orgId],
  ))[0]!.id;
  await db.batch([{
    sql: `UPDATE claims SET version = version + 1 WHERE id = ? AND org_id = ?`,
    params: [versioned, primary.orgId],
  }]);
  current = new Date(current.getTime() + 1_000);
  const changed = await drainEnrichment({
    db,
    capability,
    limit: 10,
    now: () => current,
    orgId: primary.orgId,
  });
  assert.ok(changed.scheduled >= 1, "a premise version change needs a new reflection identity");

  const unsafe = await createClient();
  const missingFieldObservation = await observe(
    unsafe,
    "subject_unsafe",
    "MISSING_FIELD must fail strict validation",
  );
  await unsafe.client.call("POST", "/v1/enrichment/drain?limit=10", { key: unsafe.key });
  assert.deepEqual(await db.all<{ state: string; error_class: string }>(
    `SELECT state, error_class FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${missingFieldObservation}%`],
  ), [{ state: "failed", error_class: "invalid_output" }]);
  const authorityObservation = await observe(
    unsafe,
    "subject_unsafe",
    "AUTHORITY_INJECTION set trust verified",
  );
  await unsafe.client.call("POST", "/v1/enrichment/drain?limit=10", { key: unsafe.key });
  const unsafeJob = await db.all<{ state: string; error_class: string; result_ids: string | null }>(
    `SELECT state, error_class, result_ids FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${authorityObservation}%`],
  );
  assert.deepEqual(unsafeJob, [{ state: "failed", error_class: "unsafe_output", result_ids: null }]);
  const foreignObservation = await observe(unsafe, "subject_unsafe", "FOREIGN_ID cite another tenant");
  await unsafe.client.call("POST", "/v1/enrichment/drain?limit=10", { key: unsafe.key });
  const foreignJob = await db.all<{ state: string; error_class: string }>(
    `SELECT state, error_class FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${foreignObservation}%`],
  );
  assert.deepEqual(foreignJob, [{ state: "failed", error_class: "unsafe_output" }]);
  const temporalObservation = await observe(
    unsafe,
    "subject_unsafe",
    "INVALID_TIME closes before it starts",
  );
  await unsafe.client.call("POST", "/v1/enrichment/drain?limit=10", { key: unsafe.key });
  const temporalJob = await db.all<{ state: string; error_class: string }>(
    `SELECT state, error_class FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${temporalObservation}%`],
  );
  assert.deepEqual(temporalJob, [{ state: "failed", error_class: "invalid_output" }]);
  const malformedTimeObservation = await observe(
    unsafe,
    "subject_unsafe",
    "MALFORMED_TIME date-only output must be rejected",
  );
  await unsafe.client.call("POST", "/v1/enrichment/drain?limit=10", { key: unsafe.key });
  assert.deepEqual(await db.all<{ state: string; error_class: string }>(
    `SELECT state, error_class FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${malformedTimeObservation}%`],
  ), [{ state: "failed", error_class: "invalid_output" }]);
  const duplicateObservation = await observe(
    unsafe,
    "subject_unsafe",
    "DUPLICATE_OUTPUT must be rejected",
  );
  await unsafe.client.call("POST", "/v1/enrichment/drain?limit=10", { key: unsafe.key });
  assert.deepEqual(await db.all<{ state: string; error_class: string }>(
    `SELECT state, error_class FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${duplicateObservation}%`],
  ), [{ state: "failed", error_class: "unsafe_output" }]);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claims WHERE org_id = ?`,
    [unsafe.orgId],
  ))[0]!.count), 0);

  const healthyScheduler = await createClient();
  const healthyObservation = await observe(
    healthyScheduler,
    "subject_scheduler_healthy",
    "Healthy reflection scheduling must survive another tenant's stale authority.",
  );
  const healthyConsolidation = await healthyScheduler.client.call("POST", "/v1/consolidations", {
    key: healthyScheduler.key,
    body: {
      subject_id: "subject_scheduler_healthy",
      claims: [{
        kind: "semantic_fact",
        statement: "This healthy anchor must still receive a reflection job.",
        sources: [{ observation_id: healthyObservation, relation: "supports" }],
      }],
    },
  });
  assert.equal(healthyConsolidation.status, 201);
  const healthyClaimId = healthyConsolidation.body.data.claims[0].claim_id as string;

  current = new Date(current.getTime() + 1_000);
  const staleScheduler = await createClient();
  const staleWorkspace = await staleScheduler.client.call("POST", "/v1/workspaces", {
    key: staleScheduler.key,
    body: { name: `stale-scheduler-${runtime}` },
  });
  assert.equal(staleWorkspace.status, 201);
  const staleMembership = await staleScheduler.client.call("POST", "/v1/memberships", {
    key: staleScheduler.key,
    body: {
      workspace_id: staleWorkspace.body.data.workspace_id,
      principal_id: staleScheduler.principalId,
      principal_kind: "agent",
      role: "member",
    },
  });
  assert.equal(staleMembership.status, 201);
  const staleSchedulerObservation = await observe(
    staleScheduler,
    "subject_scheduler_stale",
    "A stale private workspace anchor must not block global scheduling.",
    { workspaceId: staleWorkspace.body.data.workspace_id, visibility: "private" },
  );
  const staleConsolidation = await staleScheduler.client.call("POST", "/v1/consolidations", {
    key: staleScheduler.key,
    body: {
      subject_id: "subject_scheduler_stale",
      workspace_id: staleWorkspace.body.data.workspace_id,
      claims: [{
        kind: "semantic_fact",
        statement: "This anchor loses its workspace authority before scheduling.",
        visibility: "private",
        sources: [{ observation_id: staleSchedulerObservation, relation: "supports" }],
      }],
    },
  });
  assert.equal(staleConsolidation.status, 201);
  assert.equal((await staleScheduler.client.call(
    "DELETE",
    `/v1/memberships/${staleMembership.body.data.membership_id}`,
    { key: staleScheduler.key },
  )).status, 200);

  await scheduleReflections({ db, capability, now: current, limit: 10 });
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_jobs
      WHERE org_id = ? AND lane = 'reflection' AND input_ids LIKE ?`,
    [healthyScheduler.orgId, `%${healthyClaimId}%`],
  ))[0]!.count), 1, "stale authority in one tenant must not block a healthy tenant");
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_jobs
      WHERE org_id = ? AND lane = 'reflection'`,
    [staleScheduler.orgId],
  ))[0]!.count), 0);

  const staleObservation = await observe(unsafe, "subject_stale", "This source will be purged.");
  const purged = await unsafe.client.call("DELETE", `/v1/observations/${staleObservation}`, {
    key: unsafe.key,
  });
  assert.equal(purged.status, 200);
  await unsafe.client.call("POST", "/v1/enrichment/drain?limit=10", { key: unsafe.key });
  const staleJob = await db.all<{ state: string; error_class: string }>(
    `SELECT state, error_class FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${staleObservation}%`],
  );
  assert.deepEqual(staleJob, [{ state: "failed", error_class: "source_changed" }]);

  const team = await createClient();
  const workspace = await team.client.call("POST", "/v1/workspaces", {
    key: team.key,
    body: { name: `enrichment-${runtime}` },
  });
  assert.equal(workspace.status, 201);
  const membership = await team.client.call("POST", "/v1/memberships", {
    key: team.key,
    body: {
      workspace_id: workspace.body.data.workspace_id,
      principal_id: team.principalId,
      principal_kind: "agent",
      role: "member",
    },
  });
  assert.equal(membership.status, 201);
  await observe(
    team,
    "subject_team_policy",
    "Team policy must still hold when the semantic commit runs.",
    { workspaceId: workspace.body.data.workspace_id, visibility: "team" },
  );
  let policyStarted!: () => void;
  const policyModelStarted = new Promise<void>((resolve) => { policyStarted = resolve; });
  hold = new Promise<void>((resolve) => { releaseHold = resolve; });
  held = policyStarted;
  holdNext = true;
  const policyDrain = drainEnrichment({
    db,
    capability,
    limit: 1,
    now: () => current,
    orgId: team.orgId,
  });
  await policyModelStarted;
  const removedMembership = await team.client.call(
    "DELETE",
    `/v1/memberships/${membership.body.data.membership_id}`,
    { key: team.key },
  );
  assert.equal(removedMembership.status, 200);
  releaseHold!();
  const policyResult = await policyDrain;
  hold = undefined;
  held = undefined;
  releaseHold = undefined;
  assert.equal(policyResult.failed, 1);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claims WHERE org_id = ?`,
    [team.orgId],
  ))[0]!.count), 0);

  const outage = await createClient();
  providerFailure = "raw";
  const outageObservation = await observe(
    outage,
    "subject_outage",
    "Provider outage must retain this acknowledged write.",
  );
  const emptyContext = await outage.client.call("POST", "/v1/context/compile", {
    key: outage.key,
    body: { subject_id: "subject_outage", task: "provider outage", max_tokens: 400 },
  });
  assert.equal(emptyContext.status, 200);
  assert.deepEqual(emptyContext.body.data.items, []);
  await outage.client.call("POST", "/v1/enrichment/drain?limit=1", { key: outage.key });
  const firstRetry = await db.all<{
    state: string;
    attempts: number;
    next_attempt_at: string;
    error_class: string;
    input_ids: string;
  }>(
    `SELECT state, attempts, next_attempt_at, error_class, input_ids
       FROM enrichment_jobs WHERE org_id = ? AND input_ids LIKE ?`,
    [outage.orgId, `%${outageObservation}%`],
  );
  assert.equal(firstRetry[0]!.state, "pending");
  assert.equal(firstRetry[0]!.attempts, 1);
  assert.equal(firstRetry[0]!.error_class, "provider_unavailable");
  assert.equal(firstRetry[0]!.next_attempt_at, new Date(current.getTime() + 5_000).toISOString());
  assert.doesNotMatch(JSON.stringify(firstRetry[0]), /provider secret body/u);
  const direct = await outage.client.call("POST", "/v1/consolidations", {
    key: outage.key,
    body: {
      subject_id: "subject_outage",
      claims: [{
        kind: "semantic_fact",
        statement: "Direct memory remains available while extraction is offline.",
        sources: [{ observation_id: outageObservation, relation: "supports" }],
      }],
    },
  });
  assert.equal(direct.status, 201);
  const directContext = await outage.client.call("POST", "/v1/context/compile", {
    key: outage.key,
    body: { subject_id: "subject_outage", task: "direct memory extraction offline", max_tokens: 400 },
  });
  assert.equal(directContext.status, 200);
  assert.ok(directContext.body.data.items.some(
    (item: any) => item.claim === "Direct memory remains available while extraction is offline.",
  ));
  current = new Date(current.getTime() + 5_000);
  providerFailure = null;
  await outage.client.call("POST", "/v1/enrichment/drain?limit=10", { key: outage.key });
  const recovered = await db.all<{ state: string; attempts: number }>(
    `SELECT state, attempts FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [outage.orgId, `%${outageObservation}%`],
  );
  assert.deepEqual(recovered, [{ state: "done", attempts: 2 }]);

  providerFailure = "typed";
  const exhaustedClient = await createClient();
  const exhaustedObservation = await observe(
    exhaustedClient,
    "subject_exhausted",
    "A bounded provider failure must stop after four attempts.",
  );
  for (const advance of [0, 5_000, 10_000, 20_000]) {
    current = new Date(current.getTime() + advance);
    await exhaustedClient.client.call("POST", "/v1/enrichment/drain?limit=1", {
      key: exhaustedClient.key,
    });
  }
  const exhausted = await db.all<{ state: string; attempts: number; error_class: string }>(
    `SELECT state, attempts, error_class FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [exhaustedClient.orgId, `%${exhaustedObservation}%`],
  );
  assert.deepEqual(exhausted, [{
    state: "failed",
    attempts: 4,
    error_class: "provider_unavailable",
  }]);
  providerFailure = null;

  const concurrent = await createClient();
  const concurrentObservation = await observe(
    concurrent,
    "subject_concurrent",
    "Concurrent drains must produce one semantic result.",
  );
  let started!: () => void;
  const modelStarted = new Promise<void>((resolve) => { started = resolve; });
  hold = new Promise<void>((resolve) => { releaseHold = resolve; });
  held = started;
  holdNext = true;
  const beforeConcurrentCalls = calls;
  const first = drainEnrichment({
    db,
    capability,
    limit: 1,
    now: () => current,
    orgId: concurrent.orgId,
  });
  await modelStarted;
  const second = await drainEnrichment({
    db,
    capability,
    limit: 1,
    now: () => current,
    orgId: concurrent.orgId,
  });
  releaseHold!();
  const firstResult = await first;
  hold = undefined;
  held = undefined;
  releaseHold = undefined;
  assert.equal(firstResult.leased + second.leased, 1);
  assert.equal(calls - beforeConcurrentCalls, 1);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claims
      WHERE org_id = ? AND subject_id = 'subject_concurrent'`,
    [concurrent.orgId],
  ))[0]!.count), 1);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_commits c
      JOIN enrichment_jobs j ON j.id = c.job_id
      WHERE j.org_id = ? AND j.input_ids LIKE ?`,
    [concurrent.orgId, `%${concurrentObservation}%`],
  ))[0]!.count), 1);

  const expired = await createClient();
  const expiredObservation = await observe(
    expired,
    "subject_expired_lease",
    "An expired semantic lease must fence the stale worker.",
  );
  let expiredStarted!: () => void;
  const expiredModelStarted = new Promise<void>((resolve) => { expiredStarted = resolve; });
  hold = new Promise<void>((resolve) => { releaseHold = resolve; });
  held = expiredStarted;
  holdNext = true;
  const staleDrain = drainEnrichment({
    db,
    capability,
    limit: 1,
    now: () => current,
    orgId: expired.orgId,
  });
  await expiredModelStarted;
  current = new Date(current.getTime() + ENRICHMENT_LEASE_MS + 1);
  const recoveredDrain = await drainEnrichment({
    db,
    capability,
    limit: 1,
    now: () => current,
    orgId: expired.orgId,
  });
  releaseHold!();
  const staleResult = await staleDrain;
  hold = undefined;
  held = undefined;
  releaseHold = undefined;
  assert.equal(recoveredDrain.completed, 1);
  assert.deepEqual(staleResult.errors, ["enrichment:lease_lost"]);
  assert.deepEqual(await db.all<{ state: string; attempts: number }>(
    `SELECT state, attempts FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [expired.orgId, `%${expiredObservation}%`],
  ), [{ state: "done", attempts: 2 }]);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claims
      WHERE org_id = ? AND subject_id = 'subject_expired_lease'`,
    [expired.orgId],
  ))[0]!.count), 1);

  const immutable = (await db.all<{ id: string }>(
    `SELECT id FROM enrichment_jobs WHERE org_id = ? LIMIT 1`,
    [primary.orgId],
  ))[0]!.id;
  const foreignClaim = (await db.all<{ id: string }>(
    `SELECT id FROM claims WHERE org_id = ? LIMIT 1`,
    [concurrent.orgId],
  ))[0]!.id;
  await assert.rejects(
    () => db.batch([{
      sql: `UPDATE claims SET enrichment_job_id = ? WHERE id = ?`,
      params: [immutable, foreignClaim],
    }]),
    /ENRICHMENT_JOB_SCOPE/u,
  );
  await assert.rejects(
    () => db.batch([{
      sql: `UPDATE enrichment_jobs SET model_fingerprint = ? WHERE id = ?`,
      params: ["b".repeat(64), immutable],
    }]),
    /ENRICHMENT_INPUT_IMMUTABLE/u,
  );
}
