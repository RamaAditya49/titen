import assert from "node:assert/strict";
import frozenData from "../fixtures/enrichment-multilingual.json";
import { createApp } from "../../src/core/app";
import type { Db } from "../../src/core/db";
import { sha256Hex } from "../../src/core/ids";
import type { VectorCapability } from "../../src/core/vectors";
import {
  derivationClaimKey,
  DERIVATION_SCHEMA,
  drainEnrichment,
  ENRICHMENT_LEASE_MS,
  ENRICHMENT_MAX_LINK_JOBS_PER_EXPORT_OWNER,
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
  fakeVectors,
  provisionWith,
} from "./harness";

interface FrozenCase {
  id: string;
  language: string;
  content: string;
  statement: string;
  query: string;
}

const frozen = frozenData as {
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
      status: string;
    }>;
    if (premises.some((premise) => premise.statement.includes("DISPUTED_REFLECTION_ADD"))) {
      const active = premises.find((premise) => premise.status === "active");
      const partial = premises.some((premise) => premise.statement.includes("PARTIAL"));
      return {
        action: "add",
        claims: [{
          kind: "semantic_fact",
          statement: "A model must not launder an unresolved dispute.",
          premise_ids: partial
            ? [active?.claim_id ?? premises[0]!.claim_id]
            : premises.map((premise) => premise.claim_id),
          valid_from: null,
          valid_to: null,
        }],
        links: null,
      };
    }
    const incomplete = premises.find((premise) =>
      /(?:PARTIAL|REORDERED|DUPLICATE|FOREIGN)_REFLECTION_ADD/.test(premise.statement));
    if (incomplete) {
      const ids = premises.map((premise) => premise.claim_id);
      const mode = incomplete.statement.match(
        /(PARTIAL|REORDERED|DUPLICATE|FOREIGN)_REFLECTION_ADD/,
      )![1];
      const premiseIds = mode === "PARTIAL"
        ? ids.slice(0, -1)
        : mode === "REORDERED"
          ? [...ids].reverse()
          : mode === "DUPLICATE"
            ? [ids[0]!, ids[0]!]
            : [ids[0]!, "claim_foreign"];
      return {
        action: "add",
        claims: [{
          kind: "semantic_fact",
          statement: "Incomplete reflection provenance must not commit.",
          premise_ids: premiseIds,
          valid_from: null,
          valid_to: null,
        }],
        links: null,
      };
    }
    if (premises.some((premise) => premise.statement.includes("REFLECTION_STATUS_DRIFT")))
      return {
        action: "add",
        claims: [{
          kind: "semantic_fact",
          statement: "A drifting premise must not commit.",
          premise_ids: premises.map((premise) => premise.claim_id),
          valid_from: null,
          valid_to: null,
        }],
        links: null,
      };
    if (premises.some((premise) => premise.statement.includes("PORTABILITY_CYCLE_ADD")))
      return {
        action: "add",
        claims: [{
          kind: "semantic_fact",
          statement: "Portable reflection cycle result.",
          premise_ids: premises.map((premise) => premise.claim_id),
          valid_from: null,
          valid_to: null,
        }],
        links: null,
      };
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
  if (content.includes("UNSUPPORTED_FUTURE"))
    return {
      action: "add",
      claims: [{
        kind: "semantic_fact",
        statement: "An unsupported future boundary must not commit.",
        evidence_ids: [id],
        valid_from: "2099-01-01T00:00:00.000Z",
        valid_to: null,
      }],
    };
  if (content.includes("EXPLICIT_FUTURE"))
    return {
      action: "add",
      claims: [{
        kind: "episodic_event",
        statement: "The cited maintenance window is explicitly scheduled.",
        evidence_ids: [id],
        valid_from: "2035-01-01T00:00:00.000Z",
        valid_to: "2035-01-02T00:00:00.000Z",
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
  if (content.includes("MALFORMED_CITED_TIME"))
    return {
      action: "add",
      claims: [{
        kind: "episodic_event",
        statement: "An invalid calendar token cannot authorize a normalized date.",
        evidence_ids: [id],
        valid_from: "2026-03-02T00:00:00.000Z",
        valid_to: null,
      }],
    };
  if (content.includes("OVERBOUND_OUTPUT"))
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
  if (content.includes("SEMANTIC_DUPLICATE"))
    return {
      action: "add",
      claims: [{
        kind: "semantic_fact",
        statement: "The deployment window is Friday at 09:00 UTC.",
        evidence_ids: [id],
        valid_from: null,
        valid_to: null,
      }],
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
  let concurrentDuplicateCalls = 0;
  const modelRevision = "a".repeat(64);
  const providerIdentity = "https://models.example.test/v1";
  const capability: ExtractionCapability = {
    modelId: "frozen-sol",
    modelFingerprint: modelRevision,
    providerIdentity,
    async generate(request) {
      calls += 1;
      if (
        request.lane === "derivation"
        && observationContent(request) === "Concurrent duplicate drains must produce one semantic result."
      ) concurrentDuplicateCalls += 1;
      const pendingHold = holdNext ? hold : undefined;
      if (holdNext) {
        holdNext = false;
        held?.();
      }
      if (pendingHold) await pendingHold;
      if (pendingHold && request.lane === "derivation"
        && observationContent(request).includes("STALE_INVALID_ONCE"))
        return { action: "abstain" };
      if (providerFailure === "typed")
        throw new ExtractionProviderError("provider_unavailable", true);
      if (providerFailure === "raw")
        throw new Error("provider secret body must never persist");
      if (request.lane === "derivation" && observationContent(request).includes("CYCLIC_OUTPUT")) {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        return cyclic;
      }
      if (request.lane === "derivation" && observationContent(request).includes("OVERSIZED_OUTPUT"))
        return { action: "abstain", claims: null, padding: "x".repeat(130 * 1024) };
      if (request.lane === "derivation" && observationContent(request).includes("HASH_MISMATCH"))
        return {
          action: "add",
          claims: [{
            kind: "semantic_fact",
            statement: "This getter-visible ADD must not escape its hashed JSON.",
            evidence_ids: [observationId(request)],
            valid_from: null,
            valid_to: null,
          }],
          toJSON() { return { action: "abstain", claims: null }; },
        };
      return proposalFor(request);
    },
  };
  const expectedModelFingerprint = await sha256Hex(JSON.stringify({
    provider: providerIdentity,
    model: capability.modelId,
    revision: modelRevision,
  }));

  const createClient = async (
    extraction: ExtractionCapability | null = capability,
    orgId?: string,
    vectors?: VectorCapability,
  ) => {
    const principal = await provisionWith(db, {
      orgId,
      scopes: [
        ...DEFAULT_SCOPES,
        "observations:purge",
        "enrichment:write",
        "export:read",
        "export:all",
        "import:write",
        "workspaces:write",
        "memberships:write",
      ],
    });
    const app = createApp({
      db,
      runtime,
      revision: "enrichment-contract",
      extraction: extraction ?? undefined,
      vectors,
      semanticPrepared: Boolean(vectors),
      now: () => current,
      backgroundRepair: { configured: true, staleAfterMs: 60_000 },
      migrationsReady: true,
      secretStorageReady: true,
    });
    return {
      ...principal,
      vectors,
      client: clientVia(app, "http://enrichment.test"),
    };
  };

  const primary = await createClient();
  const observe = async (
    target: Awaited<ReturnType<typeof createClient>>,
    subjectId: string,
    content: string,
    scope?: { workspaceId: string; visibility: "private" | "team" },
    occurredAt?: string,
  ) => {
    const response = await target.client.call("POST", "/v1/observations", {
      key: target.key,
      body: {
        subject_id: subjectId,
        kind: "user_statement",
        content,
        visibility: scope?.visibility ?? "private",
        ...(scope ? { workspace_id: scope.workspaceId } : {}),
        ...(occurredAt ? { occurred_at: occurredAt } : {}),
        source: { type: "contract_fixture" },
      },
    });
    assert.equal(response.status, 201);
    return response.body.data.observation_id as string;
  };
  const drainHttp = async (
    target: Awaited<ReturnType<typeof createClient>>,
    limit = 10,
  ) => ({
    status: 200,
    body: {
      data: await drainEnrichment({
        db,
        capability,
        limit,
        now: () => current,
        orgId: target.orgId,
        vectors: target.vectors,
      }),
    },
  });
  const portableRemapper = (
    observations: any[],
    claims: any[],
    suffix: string,
  ) => {
    const ids = [
      ...observations.map((row) => row.id),
      ...claims.flatMap((row) => [
        row.id,
        ...row.enrichments.flatMap((bundle: any) => [
          bundle.job.id,
          ...bundle.links.map((link: any) => link.id),
        ]),
      ]),
    ].sort((left, right) => right.length - left.length);
    const idMap = new Map(ids.map((id) => [id, `${id}_${suffix}`]));
    return {
      idMap,
      async remap(row: any) {
        let serialized = JSON.stringify(row);
        for (const [source, destination] of idMap)
          serialized = serialized.replaceAll(source, destination);
        const mapped = JSON.parse(serialized);
        for (const bundle of mapped.enrichments ?? [])
          bundle.job.input_hash = await sha256Hex(JSON.stringify({
            lane: bundle.job.lane,
            ids: bundle.job.input_ids,
          }));
        return mapped;
      },
    };
  };

  const invalidPrincipal = await provisionWith(db, {
    scopes: [...DEFAULT_SCOPES, "enrichment:write"],
  });
  const invalidCapability = {
    ...capability,
    modelFingerprint: "invalid",
  } as ExtractionCapability;
  const invalidClient = clientVia(createApp({
    db,
    runtime,
    revision: "invalid-enrichment-contract",
    extraction: invalidCapability,
    now: () => current,
    migrationsReady: true,
    secretStorageReady: true,
  }), "http://invalid-enrichment.test");
  const invalidReady = await invalidClient.call("GET", "/readyz");
  assert.equal(invalidReady.status, 503);
  assert.equal(invalidReady.body.meta.capabilities.extraction, "configured_error");
  const acceptedWithoutJob = await invalidClient.call("POST", "/v1/observations", {
    key: invalidPrincipal.key,
    body: {
      subject_id: "subject_capability_recovery",
      kind: "user_statement",
      content: "Corrected extraction startup must recover this canonical evidence.",
      source: { type: "contract_fixture" },
    },
  });
  assert.equal(acceptedWithoutJob.status, 201);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_jobs WHERE org_id = ?`,
    [invalidPrincipal.orgId],
  ))[0]!.count), 0);
  const correctedClient = clientVia(createApp({
    db,
    runtime,
    revision: "corrected-enrichment-contract",
    extraction: capability,
    now: () => current,
    migrationsReady: true,
    secretStorageReady: true,
  }), "http://corrected-enrichment.test");
  const capabilityRecovery = await correctedClient.call("POST", "/v1/enrichment/drain?limit=1", {
    key: invalidPrincipal.key,
  });
  assert.equal(capabilityRecovery.status, 200);
  assert.equal(capabilityRecovery.body.data.scheduled, 1);
  assert.equal(capabilityRecovery.body.data.completed, 1);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_jobs
      WHERE org_id = ? AND lane = 'derivation'`,
    [invalidPrincipal.orgId],
  ))[0]!.count), 1);
  await correctedClient.call("POST", "/v1/enrichment/drain?limit=1", {
    key: invalidPrincipal.key,
  });
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_jobs
      WHERE org_id = ? AND lane = 'derivation'`,
    [invalidPrincipal.orgId],
  ))[0]!.count), 1);

  const importedPrincipal = await provisionWith(db, {
    scopes: [...DEFAULT_SCOPES, "enrichment:write", "import:write"],
  });
  const importedClient = clientVia(createApp({
    db,
    runtime,
    extraction: capability,
    now: () => current,
    migrationsReady: true,
    secretStorageReady: true,
  }), "http://imported-enrichment-policy.test");
  const importedObservationId = `obs_imported_backfill_${runtime.replace(/[^a-z0-9]/giu, "_")}`;
  const importedContent = "A logical restore is provenance, not a new model instruction.";
  const importedSourceActor = `source_actor_${runtime.replace(/[^a-z0-9]/giu, "_")}`;
  const importedObservation = {
    type: "observation",
    id: importedObservationId,
    subject_id: "subject_imported_backfill",
    project_id: null,
    workspace_id: null,
    agent_id: null,
    run_id: null,
    actor_id: importedSourceActor,
    kind: "user_statement",
    content: importedContent,
    content_hash: await sha256Hex(importedContent),
    source_type: "logical_restore",
    source_ref: null,
    trust: "unverified",
    visibility: "private",
    occurred_at: null,
    ingested_at: current.toISOString(),
  };
  const importedBody = [
    {
      type: "titen.export.header",
      format_version: 3,
      record_type: "observations",
      org_id: "source_import_org",
    },
    {
      type: "titen.import.actor_map",
      source_org_id: "source_import_org",
      source_actor_id: importedSourceActor,
      destination_actor_id: importedPrincipal.principalId,
    },
    importedObservation,
  ].map(JSON.stringify).join("\n");
  assert.equal((await importedClient.callRaw("POST", "/v1/import", {
    key: importedPrincipal.key,
    body: `${importedBody}\n`,
  })).status, 200);
  const importedDrain = await importedClient.call("POST", "/v1/enrichment/drain?limit=1", {
    key: importedPrincipal.key,
  });
  assert.equal(importedDrain.status, 200);
  assert.equal(importedDrain.body.data.scheduled, 0,
    "logical imports must not become implicit model inputs");
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [importedPrincipal.orgId, `%${importedObservationId}%`],
  ))[0]!.count), 0);

  const mutablePrincipal = await provisionWith(db, {
    scopes: [...DEFAULT_SCOPES, "enrichment:write"],
  });
  let generatedAs = "";
  const mutableCapability: ExtractionCapability = {
    modelId: "frozen-at-startup",
    modelFingerprint: "9".repeat(64),
    async generate(request) {
      generatedAs = this.modelId;
      return proposalFor(request);
    },
  };
  const mutableClient = clientVia(createApp({
    db,
    runtime,
    extraction: mutableCapability,
    now: () => current,
    migrationsReady: true,
    secretStorageReady: true,
  }), "http://mutable-enrichment.test");
  mutableCapability.modelId = "mutated-after-startup";
  mutableCapability.modelFingerprint = "invalid";
  const mutableObservation = await mutableClient.call("POST", "/v1/observations", {
    key: mutablePrincipal.key,
    body: {
      subject_id: "subject_capability_snapshot",
      kind: "user_statement",
      content: "Capability provenance is frozen before traffic.",
      source: { type: "contract_fixture" },
    },
  });
  assert.equal(mutableObservation.status, 201);
  assert.equal((await mutableClient.call("POST", "/v1/enrichment/drain?limit=1", {
    key: mutablePrincipal.key,
  })).status, 200);
  assert.equal(generatedAs, "frozen-at-startup");
  assert.deepEqual(await db.all<{ model_id: string }>(
    `SELECT model_id FROM enrichment_jobs WHERE org_id = ?`,
    [mutablePrincipal.orgId],
  ), [{ model_id: "frozen-at-startup" }]);
  calls = 0;

  for (const fixture of frozen.derivation)
    await observe(primary, `subject_${fixture.id}`, fixture.content);
  assert.equal(calls, 0, "canonical observation writes must not call the model");
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_jobs
      WHERE org_id = ? AND lane = 'derivation' AND state = 'pending'`,
    [primary.orgId],
  ))[0]!.count), frozen.derivation.length);
  const multilingual = await drainHttp(primary);
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
    assert.match(String(row.output_hash), /^[a-f0-9]{64}$/u);
  }

  current = new Date(current.getTime() + 1_000);
  const abstainObservation = await observe(primary, "subject_abstain", "ABSTAIN no durable memory");
  const abstain = await drainHttp(primary);
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

  const duplicate = await createClient();
  const callsBeforeDuplicate = calls;
  await observe(duplicate, "subject_exact_duplicate", "Exact duplicate durable preference.");
  await observe(duplicate, "subject_exact_duplicate", "Exact duplicate durable preference.");
  await drainHttp(duplicate);
  assert.equal(calls - callsBeforeDuplicate, 1, "exact duplicates must reuse without a model call");
  const duplicateClaims = await db.all<{ id: string; version: number }>(
    `SELECT id, version FROM claims WHERE org_id = ? AND subject_id = 'subject_exact_duplicate'`,
    [duplicate.orgId],
  );
  assert.equal(duplicateClaims.length, 1);
  assert.equal(duplicateClaims[0]!.version, 2);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claim_sources WHERE claim_id = ?`,
    [duplicateClaims[0]!.id],
  ))[0]!.count), 2);
  const duplicateJobs = await db.all<{ result_kind: string; output_hash: string | null }>(
    `SELECT c.result_kind, j.output_hash
       FROM enrichment_jobs j JOIN enrichment_commits c ON c.job_id = j.id
      WHERE j.org_id = ? ORDER BY c.result_kind`,
    [duplicate.orgId],
  );
  assert.deepEqual(duplicateJobs.map(({ result_kind }) => result_kind), ["add", "reuse"]);
  assert.equal(duplicateJobs.filter(({ output_hash }) => output_hash === null).length, 1);
  assert.match(duplicateJobs.find(({ output_hash }) => output_hash)?.output_hash ?? "", /^[a-f0-9]{64}$/u);

  const semanticDuplicate = await createClient();
  await observe(
    semanticDuplicate,
    "subject_semantic_duplicate",
    "SEMANTIC_DUPLICATE first independently worded source.",
  );
  await observe(
    semanticDuplicate,
    "subject_semantic_duplicate",
    "SEMANTIC_DUPLICATE second independently worded source.",
  );
  let semanticStarted!: () => void;
  const semanticModelStarted = new Promise<void>((resolve) => { semanticStarted = resolve; });
  hold = new Promise<void>((resolve) => { releaseHold = resolve; });
  held = semanticStarted;
  holdNext = true;
  const semanticFirst = drainEnrichment({
    db,
    capability,
    limit: 1,
    now: () => current,
    orgId: semanticDuplicate.orgId,
  });
  await semanticModelStarted;
  const semanticSecond = await drainEnrichment({
    db,
    capability,
    limit: 1,
    now: () => current,
    orgId: semanticDuplicate.orgId,
  });
  releaseHold!();
  const semanticFirstResult = await semanticFirst;
  hold = undefined;
  held = undefined;
  releaseHold = undefined;
  assert.equal(semanticFirstResult.completed + semanticSecond.completed, 2);
  const semanticClaims = await db.all<{ id: string; version: number }>(
    `SELECT id, version FROM claims
      WHERE org_id = ? AND subject_id = 'subject_semantic_duplicate'`,
    [semanticDuplicate.orgId],
  );
  assert.equal(semanticClaims.length, 1);
  assert.equal(semanticClaims[0]!.version, 2);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claim_sources WHERE claim_id = ?`,
    [semanticClaims[0]!.id],
  ))[0]!.count), 2);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM observations WHERE org_id = ?`,
    [semanticDuplicate.orgId],
  ))[0]!.count), 2, "semantic convergence must never delete source evidence");
  assert.deepEqual((await db.all<{ result_kind: string; output_hash: string | null }>(
    `SELECT ec.result_kind, job.output_hash FROM enrichment_commits ec
      JOIN enrichment_jobs job ON job.id = ec.job_id
     WHERE job.org_id = ? ORDER BY ec.result_kind`,
    [semanticDuplicate.orgId],
  )).map((row) => [row.result_kind, Boolean(row.output_hash)]), [
    ["add", true],
    ["reuse", true],
  ]);
  const sameOrgPrincipal = await provisionWith(db, {
    orgId: semanticDuplicate.orgId,
    scopes: [...DEFAULT_SCOPES, "enrichment:write"],
  });
  const sameOrgActor = {
    ...sameOrgPrincipal,
    client: clientVia(createApp({
      db,
      runtime,
      extraction: capability,
      now: () => current,
      migrationsReady: true,
      secretStorageReady: true,
    }), "http://same-org-private-enrichment.test"),
  };
  await observe(
    sameOrgActor,
    "subject_semantic_duplicate",
    "SEMANTIC_DUPLICATE third source owned by another private principal.",
  );
  await drainHttp(sameOrgActor);
  assert.deepEqual((await db.all<{ actor_id: string; source_count: number }>(
    `SELECT c.actor_id,
            (SELECT COUNT(*) FROM claim_sources source WHERE source.claim_id = c.id) AS source_count
       FROM claims c
      WHERE c.org_id = ? AND c.subject_id = 'subject_semantic_duplicate'
      ORDER BY source_count`,
    [semanticDuplicate.orgId],
  )).map((row) => [row.actor_id, Number(row.source_count)]), [
    [sameOrgActor.principalId, 1],
    [semanticDuplicate.principalId, 2],
  ]);

  const saturatedSemantic = await createClient();
  for (let index = 0; index < 22; index += 1)
    await observe(
      saturatedSemantic,
      "subject_semantic_saturation",
      `SEMANTIC_DUPLICATE bounded source generation ${index}.`,
    );
  const saturatedDrain = await drainEnrichment({
    db,
    capability,
    limit: 50,
    now: () => current,
    orgId: saturatedSemantic.orgId,
  });
  assert.equal(saturatedDrain.completed, 22);
  const saturatedClaims = await db.all<{
    id: string;
    enrichment_key: string;
    enrichment_key_archived: number;
    source_count: number;
    version: number;
  }>(
    `SELECT c.id, c.enrichment_key, c.enrichment_key_archived, c.version,
            (SELECT COUNT(*) FROM claim_sources source
              WHERE source.claim_id = c.id) AS source_count
       FROM claims c
      WHERE c.org_id = ? AND c.subject_id = 'subject_semantic_saturation'
      ORDER BY source_count DESC`,
    [saturatedSemantic.orgId],
  );
  assert.deepEqual(saturatedClaims.map((row) => [
    Number(row.source_count),
    Number(row.version),
    Number(row.enrichment_key_archived),
  ]), [[20, 20, 1], [2, 2, 0]],
  "post-cap observations must fill one new generation instead of creating one-source claims");
  assert.equal(new Set(saturatedClaims.map(({ enrichment_key }) => enrichment_key)).size, 2);
  assert.ok(saturatedClaims.every(({ enrichment_key }) => /^[a-f0-9]{64}$/u.test(enrichment_key)));
  await assert.rejects(() => db.batch([{
    sql: `UPDATE claims SET enrichment_key = ? WHERE id = ? AND org_id = ?`,
    params: ["e".repeat(64), saturatedClaims[1]!.id, saturatedSemantic.orgId],
  }]), /ENRICHMENT_KEY_IMMUTABLE/u,
  "a not-yet-full generated claim cannot rotate its semantic key");
  await assert.rejects(() => db.batch([{
    sql: `UPDATE claims SET enrichment_key = ?, version = version + 1
           WHERE id = ? AND org_id = ?`,
    params: ["d".repeat(64), saturatedClaims[0]!.id, saturatedSemantic.orgId],
  }]), /ENRICHMENT_KEY_IMMUTABLE/u,
  "an archived full generation cannot rotate its key twice");
  const directKeyGuardId = `claim_direct_key_guard_${runtime.replace(/[^a-z0-9]/giu, "_")}`;
  await db.batch([{
    sql: `INSERT INTO claims
            (id, org_id, subject_id, project_id, workspace_id, observer_id,
             actor_id, kind, statement, confidence, trust, visibility, status,
             version, valid_from, valid_to, created_at, enrichment_job_id,
             enrichment_key)
          VALUES (?, ?, 'subject_direct_key_guard', NULL, NULL, NULL, ?,
                  'semantic_fact', 'Direct claims never own semantic enrichment keys.',
                  0.5, 'unverified', 'private', 'active', 1, ?, NULL, ?, NULL, NULL)`,
    params: [
      directKeyGuardId,
      saturatedSemantic.orgId,
      saturatedSemantic.principalId,
      current.toISOString(),
      current.toISOString(),
    ],
  }]);
  await assert.rejects(() => db.batch([{
    sql: `UPDATE claims SET enrichment_key = ? WHERE id = ? AND org_id = ?`,
    params: ["e".repeat(64), directKeyGuardId, saturatedSemantic.orgId],
  }]), /ENRICHMENT_KEY_IMMUTABLE/u,
  "a direct claim cannot acquire a generated semantic key");

  const exportedObservations = await duplicate.client.call("GET", "/v1/export?type=observations", {
    key: duplicate.key,
  });
  const exportedClaims = await duplicate.client.call("GET", "/v1/export?type=claims", {
    key: duplicate.key,
  });
  assert.equal(exportedObservations.status, 200);
  assert.equal(exportedClaims.status, 200);
  const observationRows = String(exportedObservations.body).trim().split("\n").map(JSON.parse);
  const claimRows = String(exportedClaims.body).trim().split("\n").map(JSON.parse);
  assert.equal(claimRows[0]!.format_version, 4);
  assert.equal(claimRows.length, 2);
  assert.match(claimRows[1]!.enrichment_job_id, /^enr_/u);
  assert.deepEqual(
    claimRows[1]!.enrichments.map((bundle: any) => bundle.commit.result_kind).sort(),
    ["add", "reuse"],
  );
  assert.ok(claimRows[1]!.enrichments.every((bundle: any) => Array.isArray(bundle.job.input_ids)));
  const portableAddJob = claimRows[1]!.enrichments.find(
    (bundle: any) => bundle.commit.result_kind === "add",
  ).job;
  await db.batch([{
    sql: `UPDATE enrichment_jobs SET result_ids = ? WHERE id = ? AND org_id = ?`,
    params: [JSON.stringify(["claim_missing_primary"]), portableAddJob.id, duplicate.orgId],
  }]);
  const corruptedPrimaryExport = await duplicate.client.call("GET", "/v1/export?type=claims", {
    key: duplicate.key,
  });
  assert.equal(corruptedPrimaryExport.status, 400,
    "export must reject a job that no longer owns its primary result");
  await db.batch([{
    sql: `UPDATE enrichment_jobs SET result_ids = ? WHERE id = ? AND org_id = ?`,
    params: [JSON.stringify([claimRows[1]!.id]), portableAddJob.id, duplicate.orgId],
  }]);
  const foreignEvidenceId = (await db.all<{ id: string }>(
    `SELECT id FROM observations WHERE org_id = ? ORDER BY id LIMIT 1`,
    [primary.orgId],
  ))[0]!.id;
  await db.batch([{
    sql: `INSERT INTO claim_sources
            (claim_id, observation_id, relation, created_at)
          VALUES (?, ?, 'contradicts', ?)`,
    params: [claimRows[1]!.id, foreignEvidenceId, current.toISOString()],
  }]);
  for (const scope of ["", "&all=true"]) {
    const corruptEvidenceExport = await duplicate.client.call(
      "GET",
      `/v1/export?type=claims${scope}`,
      { key: duplicate.key },
    );
    assert.equal(corruptEvidenceExport.status, 400,
      "claim export must reject an incomplete authorized evidence graph");
  }
  await db.batch([{
    sql: `DELETE FROM claim_sources
           WHERE claim_id = ? AND observation_id = ? AND relation = 'contradicts'`,
    params: [claimRows[1]!.id, foreignEvidenceId],
  }]);
  const exactReplay = await duplicate.client.callRaw("POST", "/v1/import", {
    key: duplicate.key,
    body: `${String(exportedObservations.body)}${String(exportedClaims.body)}`,
  });
  assert.equal(exactReplay.status, 200);
  assert.equal(exactReplay.body.data.inserted.enrichment, 0);

  const portableIds = [
    ...observationRows.slice(1).map((row) => row.id),
    claimRows[1]!.id,
    ...claimRows[1]!.enrichments.map((bundle: any) => bundle.job.id),
  ];
  const portableIdMap = new Map(portableIds.map((id) => [id, `${id}_restored`]));
  const remap = (row: any) => {
    let serialized = JSON.stringify(row);
    for (const [source, destination] of portableIdMap)
      serialized = serialized.replaceAll(source, destination);
    return JSON.parse(serialized);
  };
  const restoredObservations = [observationRows[0], ...observationRows.slice(1).map(remap)];
  const restoredClaim = remap(claimRows[1]);
  for (const bundle of restoredClaim.enrichments)
    bundle.job.input_hash = await sha256Hex(JSON.stringify({
      lane: bundle.job.lane,
      ids: bundle.job.input_ids,
    }));
  const restoredClaims = [claimRows[0], restoredClaim];
  const restoreTarget = await createClient();
  const actorMap = {
    type: "titen.import.actor_map",
    source_org_id: duplicate.orgId,
    source_actor_id: duplicate.principalId,
    destination_actor_id: restoreTarget.principalId,
  };
  const restoredBody = `${restoredObservations.map(JSON.stringify).join("\n")}\n${JSON.stringify(actorMap)}\n${restoredClaims.map(JSON.stringify).join("\n")}\n`;
  const missingPrimary = structuredClone(restoredClaim);
  missingPrimary.enrichments = [];
  const rejectedMissing = await restoreTarget.client.callRaw("POST", "/v1/import", {
    key: restoreTarget.key,
    body: `${restoredObservations.map(JSON.stringify).join("\n")}\n${JSON.stringify(actorMap)}\n${JSON.stringify(claimRows[0])}\n${JSON.stringify(missingPrimary)}\n`,
  });
  assert.equal(rejectedMissing.status, 400);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM observations WHERE id LIKE '%_restored'`,
  ))[0]!.count), 0, "an incomplete provenance bundle must write nothing");
  const unrelatedEvidence = structuredClone(restoredObservations[1]);
  unrelatedEvidence.id = `${unrelatedEvidence.id}_uncited`;
  unrelatedEvidence.content = "Same-domain evidence that no enrichment job cited.";
  unrelatedEvidence.content_hash = await sha256Hex(unrelatedEvidence.content);
  const wrongSourceClaim = structuredClone(restoredClaim);
  wrongSourceClaim.sources[0].observation_id = unrelatedEvidence.id;
  const rejectedWrongSource = await restoreTarget.client.callRaw("POST", "/v1/import", {
    key: restoreTarget.key,
    body: `${[...restoredObservations, unrelatedEvidence].map(JSON.stringify).join("\n")}\n${
      JSON.stringify(actorMap)
    }\n${JSON.stringify(claimRows[0])}\n${JSON.stringify(wrongSourceClaim)}\n`,
  });
  assert.equal(rejectedWrongSource.status, 400,
    "same-domain evidence cannot replace the exact cited source graph");
  const unsupportedFutureClaim = structuredClone(restoredClaim);
  unsupportedFutureClaim.valid_from = "2099-01-01T00:00:00.000Z";
  unsupportedFutureClaim.valid_to = null;
  unsupportedFutureClaim.enrichment_key = await derivationClaimKey({
    subjectId: unsupportedFutureClaim.subject_id,
    projectId: unsupportedFutureClaim.project_id,
    workspaceId: unsupportedFutureClaim.workspace_id,
    visibility: unsupportedFutureClaim.visibility,
    kind: unsupportedFutureClaim.kind,
    statement: unsupportedFutureClaim.statement,
    validFrom: unsupportedFutureClaim.valid_from,
    validTo: unsupportedFutureClaim.valid_to,
  });
  const rejectedUnsupportedFuture = await restoreTarget.client.callRaw("POST", "/v1/import", {
    key: restoreTarget.key,
    body: `${restoredObservations.map(JSON.stringify).join("\n")}\n${
      JSON.stringify(actorMap)
    }\n${JSON.stringify(claimRows[0])}\n${JSON.stringify(unsupportedFutureClaim)}\n`,
  });
  assert.equal(rejectedUnsupportedFuture.status, 400,
    "a recomputed semantic key cannot bypass cited temporal bounds");
  for (const invalidArchiveFlag of [null, "0"]) {
    const invalidArchiveClaim = structuredClone(restoredClaim);
    invalidArchiveClaim.enrichment_key_archived = invalidArchiveFlag;
    const rejectedArchiveFlag = await restoreTarget.client.callRaw("POST", "/v1/import", {
      key: restoreTarget.key,
      body: `${restoredObservations.map(JSON.stringify).join("\n")}\n${
        JSON.stringify(actorMap)
      }\n${JSON.stringify(claimRows[0])}\n${JSON.stringify(invalidArchiveClaim)}\n`,
    });
    assert.equal(rejectedArchiveFlag.status, 400,
      "v3 archive state must be the numeric 0/1 wire value");
  }
  const supersededWithoutReplacement = structuredClone(restoredClaim);
  supersededWithoutReplacement.status = "superseded";
  supersededWithoutReplacement.version += 1;
  supersededWithoutReplacement.superseded_by = null;
  const rejectedMissingReplacement = await restoreTarget.client.callRaw("POST", "/v1/import", {
    key: restoreTarget.key,
    body: `${restoredObservations.map(JSON.stringify).join("\n")}\n${
      JSON.stringify(actorMap)
    }\n${JSON.stringify(claimRows[0])}\n${JSON.stringify(supersededWithoutReplacement)}\n`,
  });
  assert.equal(rejectedMissingReplacement.status, 400,
    "superseded status and replacement must be present together");
  const restored = await restoreTarget.client.callRaw("POST", "/v1/import", {
    key: restoreTarget.key,
    body: restoredBody,
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.data.inserted.observation, 2);
  assert.equal(restored.body.data.inserted.claim, 1);
  assert.equal(restored.body.data.inserted.enrichment, 2);
  assert.equal(restored.body.data.inserted.enrichment_commit, 2);
  const restoredReplay = await restoreTarget.client.callRaw("POST", "/v1/import", {
    key: restoreTarget.key,
    body: restoredBody,
  });
  assert.equal(restoredReplay.status, 200);
  assert.equal(restoredReplay.body.data.inserted.enrichment, 0);
  const tampered = structuredClone(restoredClaim);
  tampered.enrichments.find((bundle: any) => bundle.commit.result_kind === "add").job.output_hash = "f".repeat(64);
  const rejectedTamper = await restoreTarget.client.callRaw("POST", "/v1/import", {
    key: restoreTarget.key,
    body: `${JSON.stringify(claimRows[0])}\n${JSON.stringify(actorMap)}\n${JSON.stringify(tampered)}\n`,
  });
  assert.equal(rejectedTamper.status, 409);

  const privateReplacementImporter = await createClient(capability, restoreTarget.orgId);
  await observe(
    privateReplacementImporter,
    "subject_private_replacement_probe",
    "A private replacement reference must remain fail-closed.",
  );
  await drainHttp(privateReplacementImporter);
  const privateObservationExport = await privateReplacementImporter.client.call(
    "GET",
    "/v1/export?type=observations",
    { key: privateReplacementImporter.key },
  );
  const privateClaimExport = await privateReplacementImporter.client.call(
    "GET",
    "/v1/export?type=claims",
    { key: privateReplacementImporter.key },
  );
  assert.equal(privateObservationExport.status, 200);
  assert.equal(privateClaimExport.status, 200);
  const privateObservationRows = String(privateObservationExport.body)
    .trim().split("\n").map(JSON.parse);
  const privateClaimRows = String(privateClaimExport.body)
    .trim().split("\n").map(JSON.parse);
  const privateRemapper = portableRemapper(
    privateObservationRows.slice(1),
    privateClaimRows.slice(1),
    "private_reference_probe",
  );
  const mappedPrivateObservations = await Promise.all(
    privateObservationRows.slice(1).map(privateRemapper.remap),
  );
  const mappedPrivateClaim = await privateRemapper.remap(privateClaimRows[1]);
  mappedPrivateClaim.status = "superseded";
  mappedPrivateClaim.version += 1;
  mappedPrivateClaim.superseded_by = portableIdMap.get(claimRows[1]!.id);
  const hiddenReplacementRejected = await privateReplacementImporter.client.callRaw(
    "POST",
    "/v1/import",
    {
      key: privateReplacementImporter.key,
      body: `${JSON.stringify(privateObservationRows[0])}\n${
        mappedPrivateObservations.map(JSON.stringify).join("\n")
      }\n${JSON.stringify(privateClaimRows[0])}\n${JSON.stringify(mappedPrivateClaim)}\n`,
    },
  );
  assert.equal(hiddenReplacementRejected.status, 422,
    "another principal's private replacement must be indistinguishable from an absent claim");
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM observations WHERE id = ?`,
    [mappedPrivateObservations[0]!.id],
  ))[0]!.count), 0, "hidden replacement rejection must remain atomic");

  const episodic = await createClient();
  const callsBeforeEpisodic = calls;
  await observe(
    episodic,
    "subject_episodic",
    "The same words can describe separate temporal evidence.",
    undefined,
    "2026-07-30T08:00:00.000Z",
  );
  await observe(
    episodic,
    "subject_episodic",
    "The same words can describe separate temporal evidence.",
    undefined,
    "2026-07-31T08:00:00.000Z",
  );
  await drainHttp(episodic);
  assert.equal(calls - callsBeforeEpisodic, 2);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claims WHERE org_id = ? AND subject_id = 'subject_episodic'`,
    [episodic.orgId],
  ))[0]!.count), 2);

  const implicitTemporal = await createClient();
  await observe(
    implicitTemporal,
    "subject_implicit_temporal",
    "Identical evidence ingested at different times stays temporally distinct.",
  );
  await drainHttp(implicitTemporal);
  current = new Date(current.getTime() + 86_400_000);
  await observe(
    implicitTemporal,
    "subject_implicit_temporal",
    "Identical evidence ingested at different times stays temporally distinct.",
  );
  await drainHttp(implicitTemporal);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claims
      WHERE org_id = ? AND subject_id = 'subject_implicit_temporal'`,
    [implicitTemporal.orgId],
  ))[0]!.count), 2);

  current = new Date(current.getTime() + 1_000);
  await observe(primary, "subject_reflect_add", "REFLECT_ADD rollback is required.");
  await observe(primary, "subject_reflect_add", "REFLECT_ADD approval is required.");
  await drainHttp(primary);
  current = new Date(current.getTime() + 1_000);
  await drainHttp(primary);
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

  const rejectIncompleteReflection = async (
    mode: "PARTIAL" | "REORDERED" | "DUPLICATE" | "FOREIGN",
  ) => {
    const target = await createClient();
    const marker = `${mode}_REFLECTION_ADD`;
    await observe(target, `subject_${marker}`, `${marker} first active premise.`);
    await observe(target, `subject_${marker}`, `${marker} second active premise.`);
    await drainHttp(target, 2);
    current = new Date(current.getTime() + 1_000);
    const rejected = await drainHttp(target, 1);
    assert.equal(rejected.body.data.failed, 1);
    assert.equal(rejected.body.data.added, 0);
    assert.deepEqual(await db.all<{ state: string; error_class: string }>(
      `SELECT state, error_class FROM enrichment_jobs
        WHERE org_id = ? AND lane = 'reflection'`,
      [target.orgId],
    ), [{ state: "failed", error_class: "unsafe_output" }]);
    assert.equal(Number((await db.all<{ count: number }>(
      `SELECT COUNT(*) AS count FROM claims
        WHERE org_id = ? AND statement = 'Incomplete reflection provenance must not commit.'`,
      [target.orgId],
    ))[0]!.count), 0);
    assert.equal(Number((await db.all<{ count: number }>(
      `SELECT COUNT(*) AS count FROM claim_links
        WHERE org_id = ? AND relation = 'derived_from'`,
      [target.orgId],
    ))[0]!.count), 0);
  };
  for (const mode of ["PARTIAL", "REORDERED", "DUPLICATE", "FOREIGN"] as const)
    await rejectIncompleteReflection(mode);

  const rejectDisputedReflection = async (marker: string) => {
    const target = await createClient();
    const supporting = await observe(target, `subject_${marker}`, `${marker} supporting evidence.`);
    const contradicting = await observe(target, `subject_${marker}`, `${marker} contradicting evidence.`);
    await drainHttp(target, 2);
    const consolidated = await target.client.call("POST", "/v1/consolidations", {
      key: target.key,
      body: {
        subject_id: `subject_${marker}`,
        claims: [{
          kind: "semantic_fact",
          statement: `${marker} unresolved canonical dispute.`,
          sources: [
            { observation_id: supporting, relation: "supports" },
            { observation_id: contradicting, relation: "contradicts" },
          ],
        }],
      },
    });
    assert.equal(consolidated.status, 201);
    assert.equal(consolidated.body.data.claims[0].status, "disputed");
    current = new Date(current.getTime() + 1_000);
    const rejected = await drainHttp(target, 1);
    assert.equal(rejected.body.data.failed, 1);
    assert.equal(rejected.body.data.added, 0);
    assert.deepEqual(await db.all<{ state: string; error_class: string }>(
      `SELECT state, error_class FROM enrichment_jobs
        WHERE org_id = ? AND lane = 'reflection'`,
      [target.orgId],
    ), [{ state: "failed", error_class: "unsafe_output" }]);
    assert.equal(Number((await db.all<{ count: number }>(
      `SELECT COUNT(*) AS count FROM claims
        WHERE org_id = ? AND statement = 'A model must not launder an unresolved dispute.'`,
      [target.orgId],
    ))[0]!.count), 0);
    assert.deepEqual(await db.all<{ relation: string }>(
      `SELECT relation FROM claim_sources WHERE claim_id = ? ORDER BY relation`,
      [consolidated.body.data.claims[0].claim_id],
    ), [{ relation: "contradicts" }, { relation: "supports" }]);
  };
  await rejectDisputedReflection("DISPUTED_REFLECTION_ADD_CITED");
  await rejectDisputedReflection("DISPUTED_REFLECTION_ADD_PARTIAL");

  const statusDrift = await createClient();
  await observe(
    statusDrift,
    "subject_reflection_status_drift",
    "REFLECTION_STATUS_DRIFT starts active.",
  );
  await drainHttp(statusDrift, 1);
  current = new Date(current.getTime() + 1_000);
  let driftStarted!: () => void;
  const driftModelStarted = new Promise<void>((resolve) => { driftStarted = resolve; });
  hold = new Promise<void>((resolve) => { releaseHold = resolve; });
  held = driftStarted;
  holdNext = true;
  const driftingDrain = drainEnrichment({
    db,
    capability,
    limit: 1,
    now: () => current,
    orgId: statusDrift.orgId,
  });
  await driftModelStarted;
  const driftingPremise = (await db.all<{ id: string; version: number }>(
    `SELECT id, version FROM claims
      WHERE org_id = ? AND subject_id = 'subject_reflection_status_drift'
        AND status = 'active'`,
    [statusDrift.orgId],
  ))[0]!;
  await db.batch([{
    sql: `UPDATE claims SET status = 'disputed', version = version + 1
           WHERE id = ? AND org_id = ? AND version = ?`,
    params: [driftingPremise.id, statusDrift.orgId, driftingPremise.version],
  }]);
  releaseHold!();
  const drifted = await driftingDrain;
  hold = undefined;
  held = undefined;
  releaseHold = undefined;
  assert.equal(drifted.failed, 1);
  assert.equal(drifted.added, 0);
  assert.deepEqual(await db.all<{ state: string; error_class: string }>(
    `SELECT state, error_class FROM enrichment_jobs
      WHERE org_id = ? AND lane = 'reflection'`,
    [statusDrift.orgId],
  ), [{ state: "failed", error_class: "source_changed" }]);

  current = new Date(current.getTime() + 1_000);
  await observe(primary, "subject_reflect_link", "Link candidate one.");
  await observe(primary, "subject_reflect_link", "Link candidate two.");
  await drainHttp(primary);
  current = new Date(current.getTime() + 1_000);
  await drainHttp(primary);
  const candidateLinks = await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claim_links
      WHERE org_id = ? AND relation = 'duplicate_candidate'`,
    [primary.orgId],
  );
  assert.equal(Number(candidateLinks[0]!.count), 1);
  const reflectedObservationExport = await primary.client.call("GET", "/v1/export?type=observations", {
    key: primary.key,
  });
  const reflectedClaimExport = await primary.client.call("GET", "/v1/export?type=claims", {
    key: primary.key,
  });
  assert.equal(reflectedObservationExport.status, 200);
  assert.equal(reflectedClaimExport.status, 200);
  const reflectedClaimLines = String(reflectedClaimExport.body).trim().split("\n").map(JSON.parse);
  const reflectedClaimHeader = reflectedClaimLines[0]!;
  const reflectedClaimRows = reflectedClaimLines.slice(1);
  const portableReflection = reflectedClaimRows.find((row) => row.id === reflected[0]!.id);
  assert.ok(portableReflection);
  const reflectionAddBundle = portableReflection.enrichments.find(
    (bundle: any) => bundle.job.id === reflected[0]!.enrichment_job_id,
  );
  assert.equal(reflectionAddBundle.commit.result_kind, "add");
  assert.equal(reflectionAddBundle.links.length, 2);
  assert.ok(reflectionAddBundle.links.every((link: any) => link.relation === "derived_from"));
  const duplicateReflectionInputs = structuredClone(portableReflection);
  const duplicateReflectionBundle = duplicateReflectionInputs.enrichments.find(
    (bundle: any) => bundle.job.id === reflected[0]!.enrichment_job_id,
  );
  duplicateReflectionBundle.job.input_ids[1] = structuredClone(
    duplicateReflectionBundle.job.input_ids[0],
  );
  duplicateReflectionBundle.job.input_hash = await sha256Hex(JSON.stringify({
    lane: duplicateReflectionBundle.job.lane,
    ids: duplicateReflectionBundle.job.input_ids,
  }));
  const duplicateReflectionRejected = await primary.client.callRaw("POST", "/v1/import", {
    key: primary.key,
    body: `${JSON.stringify(reflectedClaimHeader)}\n${JSON.stringify(duplicateReflectionInputs)}\n`,
  });
  assert.equal(duplicateReflectionRejected.status, 400,
    "reflection provenance cannot repeat a premise id");
  const nestedReflection = structuredClone(portableReflection);
  const nestedBundle = nestedReflection.enrichments.find(
    (bundle: any) => bundle.job.id === reflected[0]!.enrichment_job_id,
  );
  nestedBundle.job.input_ids = [{ id: nestedReflection.id, version: nestedReflection.version }];
  nestedBundle.job.input_hash = await sha256Hex(JSON.stringify({
    lane: nestedBundle.job.lane,
    ids: nestedBundle.job.input_ids,
  }));
  const nestedReflectionRejected = await primary.client.callRaw("POST", "/v1/import", {
    key: primary.key,
    body: `${JSON.stringify(reflectedClaimHeader)}\n${JSON.stringify(nestedReflection)}\n`,
  });
  assert.equal(nestedReflectionRejected.status, 400,
    "a reflection-generated claim cannot become another reflection premise");
  const linkBundles = reflectedClaimRows.flatMap((row) => row.enrichments)
    .filter((bundle: any) => bundle.commit.result_kind === "link");
  assert.equal(linkBundles.length, 1, "a link-only job must have one deterministic owner claim");
  assert.deepEqual(
    linkBundles[0]!.job.result_ids,
    linkBundles[0]!.links.map((link: any) => link.id),
  );
  await db.batch([{
    sql: `UPDATE enrichment_jobs SET result_ids = ? WHERE id = ? AND org_id = ?`,
    params: [JSON.stringify(["link_missing_result"]), linkBundles[0]!.job.id, primary.orgId],
  }]);
  const corruptedLinkExport = await primary.client.call("GET", "/v1/export?type=claims", {
    key: primary.key,
  });
  assert.equal(corruptedLinkExport.status, 400,
    "export must reject LINK result ids that differ from its durable links");
  await db.batch([{
    sql: `UPDATE enrichment_jobs SET result_ids = ? WHERE id = ? AND org_id = ?`,
    params: [
      JSON.stringify(linkBundles[0]!.links.map((link: any) => link.id)),
      linkBundles[0]!.job.id,
      primary.orgId,
    ],
  }]);

  const boundedLinks = await createClient();
  await observe(boundedLinks, "subject_bounded_links", "Bounded link candidate one.");
  await observe(boundedLinks, "subject_bounded_links", "Bounded link candidate two.");
  await drainHttp(boundedLinks);
  current = new Date(current.getTime() + 1_000);
  await drainHttp(boundedLinks);
  const boundedPremise = (await db.all<{ id: string }>(
    `SELECT id FROM claims
      WHERE org_id = ? AND subject_id = 'subject_bounded_links'
      ORDER BY id LIMIT 1`,
    [boundedLinks.orgId],
  ))[0]!.id;
  for (let index = 1; index < ENRICHMENT_MAX_LINK_JOBS_PER_EXPORT_OWNER + 3; index += 1) {
    await db.batch([{
      sql: `UPDATE claims SET version = version + 1 WHERE id = ? AND org_id = ?`,
      params: [boundedPremise, boundedLinks.orgId],
    }]);
    current = new Date(current.getTime() + 1_000);
    await drainEnrichment({
      db,
      capability,
      limit: 1,
      now: () => current,
      orgId: boundedLinks.orgId,
    });
  }
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(DISTINCT job.id) AS count FROM enrichment_jobs job
      JOIN enrichment_commits ec ON ec.job_id = job.id
     WHERE job.org_id = ? AND job.subject_id = 'subject_bounded_links'
       AND ec.result_kind = 'link'`,
    [boundedLinks.orgId],
  ))[0]!.count), ENRICHMENT_MAX_LINK_JOBS_PER_EXPORT_OWNER);
  assert.ok(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_jobs job
      JOIN enrichment_commits ec ON ec.job_id = job.id
     WHERE job.org_id = ? AND job.subject_id = 'subject_bounded_links'
       AND ec.result_kind = 'abstain'`,
    [boundedLinks.orgId],
  ))[0]!.count) >= 2, "overflow LINK snapshots must commit as bounded abstentions");
  const boundedLinkExport = await boundedLinks.client.call("GET", "/v1/export?type=claims", {
    key: boundedLinks.key,
  });
  assert.equal(boundedLinkExport.status, 200,
    "the maximum retained LINK history must remain one portable page");
  const reflectedReplay = await primary.client.callRaw("POST", "/v1/import", {
    key: primary.key,
    body: `${String(reflectedObservationExport.body)}${String(reflectedClaimExport.body)}`,
  });
  assert.equal(reflectedReplay.status, 200);
  assert.equal(reflectedReplay.body.data.inserted.enrichment, 0);

  const lifecycle = await createClient();
  const lifecycleFirst = await observe(
    lifecycle,
    "subject_reflection_lifecycle",
    "REFLECT_ADD lifecycle source one.",
  );
  await observe(
    lifecycle,
    "subject_reflection_lifecycle",
    "REFLECT_ADD lifecycle source two.",
  );
  await drainHttp(lifecycle);
  current = new Date(current.getTime() + 1_000);
  await drainHttp(lifecycle);
  const lifecycleResult = (await db.all<{ id: string }>(
    `SELECT id FROM claims
      WHERE org_id = ? AND subject_id = 'subject_reflection_lifecycle'
        AND statement = ?`,
    [lifecycle.orgId, frozen.reflection.add_statement],
  ))[0]!.id;
  const lifecycleLinkFirst = await observe(
    lifecycle,
    "subject_link_lifecycle",
    "Lifecycle link candidate one.",
  );
  await observe(
    lifecycle,
    "subject_link_lifecycle",
    "Lifecycle link candidate two.",
  );
  await drainHttp(lifecycle);
  current = new Date(current.getTime() + 1_000);
  await drainHttp(lifecycle);
  const lifecycleLink = (await db.all<{ id: string; job_id: string }>(
    `SELECT link.id, link.job_id FROM claim_links link
      JOIN enrichment_jobs job ON job.id = link.job_id
     WHERE job.org_id = ? AND job.subject_id = 'subject_link_lifecycle'
       AND job.lane = 'reflection' AND link.relation = 'duplicate_candidate'`,
    [lifecycle.orgId],
  ))[0]!;
  assert.equal((await lifecycle.client.call(
    "DELETE",
    `/v1/observations/${lifecycleFirst}`,
    { key: lifecycle.key },
  )).status, 200);
  assert.equal((await lifecycle.client.call(
    "DELETE",
    `/v1/observations/${lifecycleLinkFirst}`,
    { key: lifecycle.key },
  )).status, 200);
  const lifecycleOrdinaryClaimExport = await lifecycle.client.call(
    "GET",
    "/v1/export?type=claims",
    { key: lifecycle.key },
  );
  assert.equal(lifecycleOrdinaryClaimExport.status, 200);
  const lifecycleOrdinaryClaims = String(lifecycleOrdinaryClaimExport.body)
    .trim().split("\n").slice(1).map(JSON.parse);
  assert.ok(lifecycleOrdinaryClaims.some((claim) => claim.id === lifecycleResult),
    "authorized logical export must retain non-current reflection provenance");
  assert.ok(lifecycleOrdinaryClaims.some((claim) => claim.enrichments.some(
    (bundle: any) => bundle.job.id === lifecycleLink.job_id,
  )), "authorized logical export must retain historical LINK provenance");
  const lifecycleObservationExport = await lifecycle.client.call(
    "GET",
    "/v1/export?type=observations&all=true",
    { key: lifecycle.key },
  );
  const lifecycleClaimExport = await lifecycle.client.call(
    "GET",
    "/v1/export?type=claims&all=true",
    { key: lifecycle.key },
  );
  assert.equal(lifecycleObservationExport.status, 200);
  assert.equal(lifecycleClaimExport.status, 200);
  const lifecycleObservationRows = String(lifecycleObservationExport.body)
    .trim().split("\n").map(JSON.parse);
  const lifecycleClaimRows = String(lifecycleClaimExport.body)
    .trim().split("\n").map(JSON.parse);
  assert.equal(lifecycleClaimRows.find((row) => row.id === lifecycleResult)!.status, "revoked");
  const lifecycleIds = [
    ...lifecycleObservationRows.slice(1).map((row) => row.id),
    ...lifecycleClaimRows.slice(1).flatMap((row) => [
      row.id,
      ...row.enrichments.flatMap((bundle: any) => [
        bundle.job.id,
        ...bundle.links.map((link: any) => link.id),
      ]),
    ]),
  ].sort((left, right) => right.length - left.length);
  const lifecycleIdMap = new Map(lifecycleIds.map((id) => [id, `${id}_lifecycle_restore`]));
  const remapLifecycle = (row: any) => {
    let serialized = JSON.stringify(row);
    for (const [source, destination] of lifecycleIdMap)
      serialized = serialized.replaceAll(source, destination);
    return JSON.parse(serialized);
  };
  const lifecycleRestoredObservations = [
    lifecycleObservationRows[0],
    ...lifecycleObservationRows.slice(1).map(remapLifecycle),
  ];
  const lifecycleRestoredClaims = [
    lifecycleClaimRows[0],
    ...lifecycleClaimRows.slice(1).map(remapLifecycle),
  ];
  for (const claim of lifecycleRestoredClaims.slice(1)) for (const bundle of claim.enrichments)
    bundle.job.input_hash = await sha256Hex(JSON.stringify({
      lane: bundle.job.lane,
      ids: bundle.job.input_ids,
    }));
  const lifecycleRestoreTarget = await createClient();
  const lifecycleActorMap = {
    type: "titen.import.actor_map",
    source_org_id: lifecycle.orgId,
    source_actor_id: lifecycle.principalId,
    destination_actor_id: lifecycleRestoreTarget.principalId,
  };
  const lifecycleTamperedClaims = structuredClone(lifecycleRestoredClaims);
  const lifecycleLinkBundle = lifecycleTamperedClaims.slice(1)
    .flatMap((claim) => claim.enrichments)
    .find((bundle: any) => bundle.commit.result_kind === "link");
  const activeLifecycleInput = lifecycleLinkBundle.job.input_ids
    .map((input: any) => lifecycleTamperedClaims.find((claim) => claim.id === input.id))
    .find((claim: any) => claim?.status === "active");
  activeLifecycleInput.version += 1;
  const lifecycleTamperRejected = await lifecycleRestoreTarget.client.callRaw("POST", "/v1/import", {
    key: lifecycleRestoreTarget.key,
    body: `${lifecycleRestoredObservations.map(JSON.stringify).join("\n")}\n${
      JSON.stringify(lifecycleActorMap)
    }\n${lifecycleTamperedClaims.map(JSON.stringify).join("\n")}\n`,
  });
  assert.equal(lifecycleTamperRejected.status, 400,
    "an active premise cannot masquerade as a historical higher version");
  const lifecycleRestored = await lifecycleRestoreTarget.client.callRaw("POST", "/v1/import", {
    key: lifecycleRestoreTarget.key,
    body: `${lifecycleRestoredObservations.map(JSON.stringify).join("\n")}\n${
      JSON.stringify(lifecycleActorMap)
    }\n${lifecycleRestoredClaims.map(JSON.stringify).join("\n")}\n`,
  });
  assert.equal(lifecycleRestored.status, 200, JSON.stringify(lifecycleRestored.body));
  const restoredLifecycleResult = lifecycleIdMap.get(lifecycleResult)!;
  assert.deepEqual(await db.all<{ status: string; version: number }>(
    `SELECT status, version FROM claims WHERE id = ? AND org_id = ?`,
    [restoredLifecycleResult, lifecycleRestoreTarget.orgId],
  ), [{ status: "revoked", version: 2 }]);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claims_fts WHERE claim_id = ?`,
    [restoredLifecycleResult],
  ))[0]!.count), 0, "revoked generated memory must not re-enter FTS");
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claim_links
      WHERE id = ? AND job_id = ? AND org_id = ?`,
    [
      lifecycleIdMap.get(lifecycleLink.id),
      lifecycleIdMap.get(lifecycleLink.job_id),
      lifecycleRestoreTarget.orgId,
    ],
  ))[0]!.count), 1, "historical LINK provenance must survive lifecycle restore");

  const pagedRestoreTarget = await createClient();
  const pagedIdMap = new Map(lifecycleIds.map((id) => [id, `${id}_paged_restore`]));
  const remapPaged = (row: any) => {
    let serialized = JSON.stringify(row);
    for (const [source, destination] of pagedIdMap)
      serialized = serialized.replaceAll(source, destination);
    return JSON.parse(serialized);
  };
  const pagedActorMap = {
    ...lifecycleActorMap,
    destination_actor_id: pagedRestoreTarget.principalId,
  };
  const importPaged = async (type: "observations" | "claims") => {
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await lifecycle.client.call(
        "GET",
        `/v1/export?type=${type}&all=true&limit=1${
          cursor ? `&after=${encodeURIComponent(cursor)}` : ""
        }`,
        { key: lifecycle.key },
      );
      assert.equal(page.status, 200);
      const lines = typeof page.body === "string"
        ? page.body.trim().split("\n").map(JSON.parse)
        : [page.body];
      const header = lines[0]!;
      const records = lines.slice(1).map(remapPaged);
      for (const claim of type === "claims" ? records : []) for (const bundle of claim.enrichments)
        bundle.job.input_hash = await sha256Hex(JSON.stringify({
          lane: bundle.job.lane,
          ids: bundle.job.input_ids,
        }));
      if (records.length) {
        const importedPage = await pagedRestoreTarget.client.callRaw("POST", "/v1/import", {
          key: pagedRestoreTarget.key,
          body: `${JSON.stringify(header)}\n${JSON.stringify(pagedActorMap)}\n${
            records.map(JSON.stringify).join("\n")
          }\n`,
        });
        assert.equal(importedPage.status, 200, JSON.stringify(importedPage.body));
      }
      pages += 1;
      cursor = header.next_cursor;
    } while (cursor !== null && pages < 50);
    assert.equal(cursor, null, `${type} cursor must terminate`);
    return pages;
  };
  assert.ok(await importPaged("observations") >= 2);
  assert.ok(await importPaged("claims") >= 3);
  assert.deepEqual(await db.all<{ status: string }>(
    `SELECT status FROM claims WHERE id = ? AND org_id = ?`,
    [pagedIdMap.get(lifecycleResult), pagedRestoreTarget.orgId],
  ), [{ status: "revoked" }]);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claim_links
      WHERE id = ? AND job_id = ? AND org_id = ?`,
    [
      pagedIdMap.get(lifecycleLink.id),
      pagedIdMap.get(lifecycleLink.job_id),
      pagedRestoreTarget.orgId,
    ],
  ))[0]!.count), 1, "limit=1 paging must preserve deterministic LINK ownership");

  const orderedSupersession = await createClient();
  await observe(
    orderedSupersession,
    "subject_portable_supersession",
    "Portable supersession original.",
  );
  await observe(
    orderedSupersession,
    "subject_portable_supersession",
    "Portable supersession replacement.",
  );
  await drainHttp(orderedSupersession);
  const orderedClaims = await db.all<{ id: string }>(
    `SELECT id FROM claims
      WHERE org_id = ? AND subject_id = 'subject_portable_supersession'
      ORDER BY id`,
    [orderedSupersession.orgId],
  );
  assert.equal(orderedClaims.length, 2);
  const [lexicalOriginal, lexicalReplacement] = orderedClaims;
  assert.equal((await orderedSupersession.client.call(
    "POST",
    `/v1/claims/${lexicalOriginal!.id}/supersede`,
    {
      key: orderedSupersession.key,
      body: { superseded_by: lexicalReplacement!.id, expected_version: 1 },
    },
  )).status, 200);
  const orderedFirst = await orderedSupersession.client.call(
    "GET",
    "/v1/export?type=claims&all=true&limit=1",
    { key: orderedSupersession.key },
  );
  assert.equal(orderedFirst.status, 200);
  const orderedFirstLines = String(orderedFirst.body).trim().split("\n").map(JSON.parse);
  assert.equal(orderedFirstLines[1]!.id, lexicalReplacement!.id,
    "the replacement must precede a lexically earlier dependent claim");
  const orderedSecond = await orderedSupersession.client.call(
    "GET",
    `/v1/export?type=claims&all=true&limit=1&after=${
      encodeURIComponent(orderedFirstLines[0]!.next_cursor)
    }`,
    { key: orderedSupersession.key },
  );
  assert.equal(orderedSecond.status, 200);
  const orderedSecondLines = String(orderedSecond.body).trim().split("\n").map(JSON.parse);
  assert.equal(orderedSecondLines[1]!.id, lexicalOriginal!.id);
  const unavailableCursor = await orderedSupersession.client.call(
    "GET",
    "/v1/export?type=claims&all=true&limit=1&after=0%3Amissing-claim",
    { key: orderedSupersession.key },
  );
  assert.equal(unavailableCursor.status, 400,
    "an unavailable exact claim cursor must not restart at page one");

  const orderedObservationExport = await orderedSupersession.client.call(
    "GET",
    "/v1/export?type=observations&all=true",
    { key: orderedSupersession.key },
  );
  assert.equal(orderedObservationExport.status, 200);
  const orderedObservationLines = String(orderedObservationExport.body)
    .trim().split("\n").map(JSON.parse);
  const orderedClaimRecords = [orderedFirstLines[1], orderedSecondLines[1]];
  const orderedRemapper = portableRemapper(
    orderedObservationLines.slice(1),
    orderedClaimRecords,
    "ordered_restore",
  );
  const orderedRestore = await createClient();
  const orderedActorMap = {
    type: "titen.import.actor_map",
    source_org_id: orderedSupersession.orgId,
    source_actor_id: orderedSupersession.principalId,
    destination_actor_id: orderedRestore.principalId,
  };
  const mappedOrderedObservations = await Promise.all(
    orderedObservationLines.slice(1).map(orderedRemapper.remap),
  );
  const orderedObservationsImported = await orderedRestore.client.callRaw("POST", "/v1/import", {
    key: orderedRestore.key,
    body: `${JSON.stringify(orderedObservationLines[0])}\n${JSON.stringify(orderedActorMap)}\n${
      mappedOrderedObservations.map(JSON.stringify).join("\n")
    }\n`,
  });
  assert.equal(orderedObservationsImported.status, 200, JSON.stringify(orderedObservationsImported.body));
  for (const [header, record] of [
    [orderedFirstLines[0], orderedFirstLines[1]],
    [orderedSecondLines[0], orderedSecondLines[1]],
  ] as const) {
    const mapped = await orderedRemapper.remap(record);
    const imported = await orderedRestore.client.callRaw("POST", "/v1/import", {
      key: orderedRestore.key,
      body: `${JSON.stringify(header)}\n${JSON.stringify(orderedActorMap)}\n${JSON.stringify(mapped)}\n`,
    });
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
  }
  assert.deepEqual(await db.all<{ status: string; superseded_by: string }>(
    `SELECT status, superseded_by FROM claims WHERE id = ? AND org_id = ?`,
    [orderedRemapper.idMap.get(lexicalOriginal!.id), orderedRestore.orgId],
  ), [{
    status: "superseded",
    superseded_by: orderedRemapper.idMap.get(lexicalReplacement!.id)!,
  }]);

  const portableCycle = await createClient();
  await observe(
    portableCycle,
    "subject_portable_cycle",
    "PORTABILITY_CYCLE_ADD source.",
  );
  await drainHttp(portableCycle);
  current = new Date(current.getTime() + 1_000);
  await drainHttp(portableCycle);
  const cycleClaims = await db.all<{ id: string; statement: string }>(
    `SELECT id, statement FROM claims
      WHERE org_id = ? AND subject_id = 'subject_portable_cycle'`,
    [portableCycle.orgId],
  );
  const cyclePremise = cycleClaims.find(({ statement }) => statement.includes("PORTABILITY_CYCLE_ADD"))!;
  const cycleResult = cycleClaims.find(({ statement }) => statement === "Portable reflection cycle result.")!;
  assert.ok(cyclePremise && cycleResult);
  assert.equal((await portableCycle.client.call(
    "POST",
    `/v1/claims/${cyclePremise.id}/supersede`,
    {
      key: portableCycle.key,
      body: { superseded_by: cycleResult.id, expected_version: 1 },
    },
  )).status, 200);
  assert.deepEqual(await db.all<{ status: string; version: number }>(
    `SELECT status, version FROM claims WHERE id = ? AND org_id = ?`,
    [cycleResult.id, portableCycle.orgId],
  ), [{ status: "revoked", version: 2 }],
  "superseding a premise must atomically revoke its current reflection result");
  const splitCycle = await portableCycle.client.call(
    "GET",
    "/v1/export?type=claims&all=true&limit=1",
    { key: portableCycle.key },
  );
  assert.equal(splitCycle.status, 400);
  assert.match(JSON.stringify(splitCycle.body), /requires limit at least 2/u);
  const completeCycle = await portableCycle.client.call(
    "GET",
    "/v1/export?type=claims&all=true&limit=2",
    { key: portableCycle.key },
  );
  assert.equal(completeCycle.status, 200);
  const completeCycleLines = String(completeCycle.body).trim().split("\n").map(JSON.parse);
  assert.deepEqual(
    new Set(completeCycleLines.slice(1).map((row) => row.id)),
    new Set([cyclePremise.id, cycleResult.id]),
  );
  const cycleTail = await portableCycle.client.call(
    "GET",
    `/v1/export?type=claims&all=true&limit=2&after=${
      encodeURIComponent(completeCycleLines[0]!.next_cursor)
    }`,
    { key: portableCycle.key },
  );
  assert.equal(cycleTail.status, 200);
  const cycleTailHeader = typeof cycleTail.body === "string"
    ? JSON.parse(cycleTail.body.trim().split("\n")[0]!)
    : cycleTail.body;
  assert.equal(cycleTailHeader.count, 0);
  assert.equal(cycleTailHeader.next_cursor, null);

  const cycleObservationExport = await portableCycle.client.call(
    "GET",
    "/v1/export?type=observations&all=true",
    { key: portableCycle.key },
  );
  assert.equal(cycleObservationExport.status, 200);
  const cycleObservationLines = String(cycleObservationExport.body)
    .trim().split("\n").map(JSON.parse);
  const cycleClaimRecords = completeCycleLines.slice(1);
  const cycleRemapper = portableRemapper(
    cycleObservationLines.slice(1),
    cycleClaimRecords,
    "cycle_restore",
  );
  const cycleRestore = await createClient();
  const cycleActorMap = {
    type: "titen.import.actor_map",
    source_org_id: portableCycle.orgId,
    source_actor_id: portableCycle.principalId,
    destination_actor_id: cycleRestore.principalId,
  };
  const mappedCycleObservations = await Promise.all(
    cycleObservationLines.slice(1).map(cycleRemapper.remap),
  );
  const cycleObservationsImported = await cycleRestore.client.callRaw("POST", "/v1/import", {
    key: cycleRestore.key,
    body: `${JSON.stringify(cycleObservationLines[0])}\n${JSON.stringify(cycleActorMap)}\n${
      mappedCycleObservations.map(JSON.stringify).join("\n")
    }\n`,
  });
  assert.equal(cycleObservationsImported.status, 200, JSON.stringify(cycleObservationsImported.body));
  const mappedCycleClaims = await Promise.all(cycleClaimRecords.map(cycleRemapper.remap));
  const cycleClaimsImported = await cycleRestore.client.callRaw("POST", "/v1/import", {
    key: cycleRestore.key,
    body: `${JSON.stringify(completeCycleLines[0])}\n${JSON.stringify(cycleActorMap)}\n${
      mappedCycleClaims.map(JSON.stringify).join("\n")
    }\n`,
  });
  assert.equal(cycleClaimsImported.status, 200, JSON.stringify(cycleClaimsImported.body));
  assert.deepEqual(await db.all<{ status: string; superseded_by: string }>(
    `SELECT status, superseded_by FROM claims WHERE id = ? AND org_id = ?`,
    [cycleRemapper.idMap.get(cyclePremise.id), cycleRestore.orgId],
  ), [{
    status: "superseded",
    superseded_by: cycleRemapper.idMap.get(cycleResult.id)!,
  }]);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_jobs
      WHERE id = ? AND org_id = ? AND state = 'done'`,
    [
      cycleRemapper.idMap.get(
        cycleClaimRecords.find((row) => row.id === cycleResult.id)!.enrichment_job_id,
      ),
      cycleRestore.orgId,
    ],
  ))[0]!.count), 1, "the reflection provenance must round-trip with its SCC");

  for (const operation of ["revoke", "expire"] as const) {
    const propagationVectors = operation === "revoke" ? fakeVectors() : undefined;
    const lifecyclePropagation = await createClient(capability, undefined, propagationVectors);
    await observe(
      lifecyclePropagation,
      `subject_reflection_${operation}_propagation`,
      `PORTABILITY_CYCLE_ADD ${operation} propagation source.`,
    );
    await drainHttp(lifecyclePropagation);
    current = new Date(current.getTime() + 1_000);
    await drainHttp(lifecyclePropagation);
    const propagatedClaims = await db.all<{ id: string; statement: string }>(
      `SELECT id, statement FROM claims WHERE org_id = ? AND subject_id = ?`,
      [lifecyclePropagation.orgId, `subject_reflection_${operation}_propagation`],
    );
    const propagatedPremise = propagatedClaims.find(({ statement }) =>
      statement.includes("PORTABILITY_CYCLE_ADD"))!;
    const propagatedResult = propagatedClaims.find(({ statement }) =>
      statement === "Portable reflection cycle result.")!;
    const transitioned = await lifecyclePropagation.client.call(
      "POST",
      `/v1/claims/${propagatedPremise.id}/${operation}`,
      { key: lifecyclePropagation.key, body: { expected_version: 1 } },
    );
    assert.equal(transitioned.status, 200);
    assert.deepEqual(await db.all<{ status: string }>(
      `SELECT status FROM claims WHERE id = ? AND org_id = ?`,
      [propagatedResult.id, lifecyclePropagation.orgId],
    ), [{ status: "revoked" }],
    `${operation} of a premise must revoke its current reflection result`);
    assert.equal(Number((await db.all<{ count: number }>(
      `SELECT COUNT(*) AS count FROM claims_fts WHERE claim_id = ?`,
      [propagatedResult.id],
    ))[0]!.count), 0, "a revoked reflection result must leave FTS immediately");
    if (propagationVectors) assert.deepEqual(await db.all<{
      operation: string;
      state: string;
    }>(
      `SELECT operation, state FROM index_outbox
        WHERE org_id = ? AND record_type = 'claim' AND record_id = ?
        ORDER BY operation`,
      [lifecyclePropagation.orgId, propagatedResult.id],
    ), [
      { operation: "delete", state: "pending" },
      { operation: "upsert", state: "done" },
    ], "vector projection cleanup must replace a pending upsert with delete work");
    const propagatedObservationExport = await lifecyclePropagation.client.call(
      "GET",
      "/v1/export?type=observations&all=true",
      { key: lifecyclePropagation.key },
    );
    const propagatedClaimExport = await lifecyclePropagation.client.call(
      "GET",
      "/v1/export?type=claims&all=true",
      { key: lifecyclePropagation.key },
    );
    assert.equal(propagatedObservationExport.status, 200);
    assert.equal(propagatedClaimExport.status, 200);
    const selfReplay = await lifecyclePropagation.client.callRaw("POST", "/v1/import", {
      key: lifecyclePropagation.key,
      body: `${String(propagatedObservationExport.body)}${String(propagatedClaimExport.body)}`,
    });
    assert.equal(selfReplay.status, 200, JSON.stringify(selfReplay.body));
    assert.equal(selfReplay.body.data.inserted.enrichment, 0);
  }

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
  await drainHttp(unsafe);
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
  await drainHttp(unsafe);
  const unsafeJob = await db.all<{
    state: string;
    error_class: string;
    output_hash: string;
    result_ids: string | null;
  }>(
    `SELECT state, error_class, output_hash, result_ids FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${authorityObservation}%`],
  );
  assert.equal(unsafeJob[0]!.state, "failed");
  assert.equal(unsafeJob[0]!.error_class, "unsafe_output");
  assert.match(unsafeJob[0]!.output_hash, /^[a-f0-9]{64}$/u);
  assert.equal(unsafeJob[0]!.result_ids, null);
  const foreignObservation = await observe(unsafe, "subject_unsafe", "FOREIGN_ID cite another tenant");
  await drainHttp(unsafe);
  const foreignJob = await db.all<{ state: string; error_class: string }>(
    `SELECT state, error_class FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${foreignObservation}%`],
  );
  assert.deepEqual(foreignJob, [{ state: "failed", error_class: "unsafe_output" }]);
  const unsupportedFutureObservation = await observe(
    unsafe,
    "subject_unsafe",
    "UNSUPPORTED_FUTURE old evidence cannot invent a 2099 boundary",
    undefined,
    "2026-07-31T08:00:00.000Z",
  );
  await drainHttp(unsafe);
  const unsupportedFutureJob = await db.all<{ state: string; error_class: string; output_hash: string }>(
    `SELECT state, error_class, output_hash FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${unsupportedFutureObservation}%`],
  );
  assert.equal(unsupportedFutureJob[0]!.state, "failed");
  assert.equal(unsupportedFutureJob[0]!.error_class, "unsafe_output");
  assert.match(unsupportedFutureJob[0]!.output_hash, /^[a-f0-9]{64}$/u);
  const explicitFutureObservation = await observe(
    unsafe,
    "subject_explicit_future",
    "EXPLICIT_FUTURE window 2035-01-01T07:00:00+07:00 to 2035-01-02T07:00:00+07:00",
    undefined,
    "2026-07-31T08:00:00.000Z",
  );
  await drainHttp(unsafe);
  assert.deepEqual(await db.all<{ valid_from: string; valid_to: string }>(
    `SELECT valid_from, valid_to FROM claims
      WHERE org_id = ? AND subject_id = 'subject_explicit_future'`,
    [unsafe.orgId],
  ), [{
    valid_from: "2035-01-01T00:00:00.000Z",
    valid_to: "2035-01-02T00:00:00.000Z",
  }]);
  const temporalObservation = await observe(
    unsafe,
    "subject_unsafe",
    "INVALID_TIME closes before it starts",
  );
  await drainHttp(unsafe);
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
  await drainHttp(unsafe);
  assert.deepEqual(await db.all<{ state: string; error_class: string }>(
    `SELECT state, error_class FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${malformedTimeObservation}%`],
  ), [{ state: "failed", error_class: "invalid_output" }]);
  const malformedCitedTimeObservation = await observe(
    unsafe,
    "subject_unsafe",
    "MALFORMED_CITED_TIME 2026-02-30T00:00:00Z must not normalize into support.",
  );
  await drainHttp(unsafe);
  const malformedCitedTimeJob = (await db.all<{
    state: string;
    error_class: string;
    output_hash: string;
  }>(
    `SELECT state, error_class, output_hash FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${malformedCitedTimeObservation}%`],
  ))[0]!;
  assert.deepEqual(
    { state: malformedCitedTimeJob.state, error_class: malformedCitedTimeJob.error_class },
    { state: "failed", error_class: "unsafe_output" },
  );
  assert.match(malformedCitedTimeJob.output_hash, /^[a-f0-9]{64}$/u);
  const duplicateObservation = await observe(
    unsafe,
    "subject_unsafe",
    "OVERBOUND_OUTPUT must be rejected",
  );
  await drainHttp(unsafe);
  assert.deepEqual(await db.all<{ state: string; error_class: string }>(
    `SELECT state, error_class FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${duplicateObservation}%`],
  ), [{ state: "failed", error_class: "invalid_output" }]);
  const cyclicObservation = await observe(unsafe, "subject_unsafe", "CYCLIC_OUTPUT");
  await drainHttp(unsafe);
  assert.deepEqual(await db.all<{ state: string; error_class: string; output_hash: string | null }>(
    `SELECT state, error_class, output_hash FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${cyclicObservation}%`],
  ), [{ state: "failed", error_class: "invalid_output", output_hash: null }]);
  const oversizedObservation = await observe(unsafe, "subject_unsafe", "OVERSIZED_OUTPUT");
  await drainHttp(unsafe);
  const oversizedJob = (await db.all<{
    state: string;
    error_class: string;
    output_hash: string;
  }>(
    `SELECT state, error_class, output_hash FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [unsafe.orgId, `%${oversizedObservation}%`],
  ))[0]!;
  assert.deepEqual(
    { state: oversizedJob.state, error_class: oversizedJob.error_class },
    { state: "failed", error_class: "invalid_output" },
  );
  assert.match(oversizedJob.output_hash, /^[a-f0-9]{64}$/u,
    "serializable oversized output must retain its deterministic hash");
  const hashBoundObservation = await observe(unsafe, "subject_hash_bound", "HASH_MISMATCH");
  await drainHttp(unsafe);
  assert.deepEqual(await db.all<{ result_kind: string }>(
    `SELECT ec.result_kind FROM enrichment_jobs job
      JOIN enrichment_commits ec ON ec.job_id = job.id
     WHERE job.org_id = ? AND job.input_ids LIKE ?`,
    [unsafe.orgId, `%${hashBoundObservation}%`],
  ), [{ result_kind: "abstain" }]);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claims
      WHERE org_id = ? AND subject_id = 'subject_hash_bound'`,
    [unsafe.orgId],
  ))[0]!.count), 0);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claims WHERE org_id = ?`,
    [unsafe.orgId],
  ))[0]!.count), 1);

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
    { workspaceId: staleWorkspace.body.data.workspace_id, visibility: "team" },
  );
  const staleConsolidation = await staleScheduler.client.call("POST", "/v1/consolidations", {
    key: staleScheduler.key,
    body: {
      subject_id: "subject_scheduler_stale",
      workspace_id: staleWorkspace.body.data.workspace_id,
      claims: [{
        kind: "semantic_fact",
        statement: "This anchor loses its workspace authority before scheduling.",
        visibility: "team",
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

  let staleAuthorityEmbedCalls = 0;
  const staleAuthoritySeen: string[] = [];
  await scheduleReflections({
    db,
    capability,
    now: current,
    limit: 10,
    orgId: staleScheduler.orgId,
    vectors: {
      embedder: {
        dimensions: 1,
        model: "fixture-vector",
        async embed(statements) {
          staleAuthorityEmbedCalls += 1;
          staleAuthoritySeen.push(...statements);
          return statements.map(() => new Float32Array([1]));
        },
      },
      store: {
        async upsert() {},
        async remove() {},
        async query() { return []; },
      },
    },
  });
  assert.equal(staleAuthorityEmbedCalls, 0,
    "a stale private anchor must not spend an embedding call");
  assert.deepEqual(staleAuthoritySeen, []);
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

  const relatedScheduler = await createClient();
  const relatedSubject = `related_${runtime.replace(/[^a-z0-9]/gu, "_")}`;
  const lexicalOldId = `${relatedSubject}_lexical_old`;
  const semanticOldId = `${relatedSubject}_semantic_old`;
  const relatedRows = [
    { id: lexicalOldId, statement: "Rare quasar rollback procedure", offset: 0 },
    { id: semanticOldId, statement: "Semantically close but lexically separate", offset: 1 },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `${relatedSubject}_noise_${index}`,
      statement: index === 7 ? "Quasar rollback reminder" : `Unrelated recent noise ${index}`,
      offset: index + 2,
    })),
  ];
  const relatedStatements: Array<{ sql: string; params: Array<string | number | null> }> = [];
  for (const row of relatedRows) {
    const at = new Date(current.getTime() + row.offset).toISOString();
    relatedStatements.push({
      sql: `INSERT INTO claims
              (id, org_id, subject_id, project_id, workspace_id, observer_id,
               actor_id, kind, statement, confidence, trust, visibility, status,
               version, valid_from, valid_to, created_at, enrichment_job_id,
               enrichment_key)
            VALUES (?, ?, ?, NULL, NULL, NULL, ?, 'semantic_fact', ?, 0.8,
                    'asserted', 'private', 'active', 1, ?, NULL, ?, NULL, NULL)`,
      params: [
        row.id,
        relatedScheduler.orgId,
        relatedSubject,
        relatedScheduler.principalId,
        row.statement,
        at,
        at,
      ],
    }, {
      sql: `INSERT INTO claims_fts
              (statement, claim_id, org_scope, subject_scope)
            VALUES (?, ?, lower(hex(?)) || '0', lower(hex(?)) || '0')`,
      params: [row.statement, row.id, relatedScheduler.orgId, relatedSubject],
    });
  }
  await db.batch(relatedStatements);
  let relatedEmbedCalls = 0;
  const relatedVectors = {
    embedder: {
      dimensions: 1,
      model: "fixture-vector",
      async embed() {
        relatedEmbedCalls += 1;
        return [new Float32Array([1])];
      },
    },
    store: {
      async upsert() {},
      async remove() {},
      async query() { return [{ id: semanticOldId, score: 1 }]; },
    },
  };
  await scheduleReflections({
    db,
    capability,
    now: current,
    limit: 10,
    orgId: relatedScheduler.orgId,
    vectors: relatedVectors,
  });
  const relatedJob = (await db.all<{ input_ids: string }>(
    `SELECT input_ids FROM enrichment_jobs
      WHERE org_id = ? AND lane = 'reflection' ORDER BY created_at LIMIT 1`,
    [relatedScheduler.orgId],
  ))[0]!;
  const relatedIds = (JSON.parse(relatedJob.input_ids) as Array<{ id: string }>).map(({ id }) => id);
  assert.ok(relatedIds.includes(lexicalOldId), "bounded FTS candidates must beat recent noise");
  assert.ok(relatedIds.includes(semanticOldId), "bounded vector candidates must beat recent noise");
  const stableEmbedCalls = relatedEmbedCalls;
  await scheduleReflections({
    db,
    capability,
    now: current,
    limit: 10,
    orgId: relatedScheduler.orgId,
    vectors: relatedVectors,
  });
  assert.equal(relatedEmbedCalls, stableEmbedCalls, "unchanged snapshots must not spend embeddings");

  const cursorClient = await createClient();
  const cursorPrefix = `cursor_${runtime.replace(/[^a-z0-9]/gu, "_")}`;
  const cursorStatements = Array.from({ length: 101 }, (_, index) => {
    const at = new Date(current.getTime() + index).toISOString();
    return {
      sql: `INSERT INTO claims
              (id, org_id, subject_id, project_id, workspace_id, observer_id,
               actor_id, kind, statement, confidence, trust, visibility, status,
               version, valid_from, valid_to, created_at, enrichment_job_id)
            VALUES (?, ?, ?, NULL, NULL, NULL, ?, 'semantic_fact', ?, 0.8,
                    'asserted', 'private', 'active', 1, ?, NULL, ?, NULL)`,
      params: [
        `${cursorPrefix}_${String(index).padStart(3, "0")}`,
        cursorClient.orgId,
        `${cursorPrefix}_subject_${String(index).padStart(3, "0")}`,
        cursorClient.principalId,
        `Cursor fixture ${index}`,
        at,
        at,
      ],
    };
  });
  for (let index = 0; index < cursorStatements.length; index += 25)
    await db.batch(cursorStatements.slice(index, index + 25));
  for (let index = 0; index < 101; index += 1)
    await scheduleReflections({
      db,
      capability,
      now: current,
      limit: 1,
      orgId: cursorClient.orgId,
    });
  const oldestCursorClaim = `${cursorPrefix}_000`;
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_jobs
      WHERE org_id = ? AND lane = 'reflection' AND input_ids LIKE ?`,
    [cursorClient.orgId, `%${oldestCursorClaim}%`],
  ))[0]!.count), 1, "the durable cursor must eventually schedule anchor 101");

  const staleObservation = await observe(unsafe, "subject_stale", "This source will be purged.");
  const purged = await unsafe.client.call("DELETE", `/v1/observations/${staleObservation}`, {
    key: unsafe.key,
  });
  assert.equal(purged.status, 200);
  await drainHttp(unsafe);
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
    output_hash: string | null;
    input_ids: string;
  }>(
    `SELECT state, attempts, next_attempt_at, error_class, output_hash, input_ids
       FROM enrichment_jobs WHERE org_id = ? AND input_ids LIKE ?`,
    [outage.orgId, `%${outageObservation}%`],
  );
  assert.equal(firstRetry[0]!.state, "pending");
  assert.equal(firstRetry[0]!.attempts, 1);
  assert.equal(firstRetry[0]!.error_class, "provider_unavailable");
  assert.equal(firstRetry[0]!.next_attempt_at, new Date(current.getTime() + 5_000).toISOString());
  assert.equal(firstRetry[0]!.output_hash, null);
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
  await drainHttp(outage);
  const recovered = await db.all<{ state: string; attempts: number }>(
    `SELECT state, attempts FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [outage.orgId, `%${outageObservation}%`],
  );
  assert.deepEqual(recovered, [{ state: "done", attempts: 2 }]);

  const oldCapability: ExtractionCapability = {
    ...capability,
    modelId: "rollout-old",
    generate: (request) => capability.generate(request),
  };
  const newCapability: ExtractionCapability = {
    ...capability,
    modelId: "rollout-new",
    generate: (request) => capability.generate(request),
  };
  const rollout = await createClient(oldCapability);
  const rolloutObservation = await observe(
    rollout,
    "subject_rollout",
    "A new worker must not consume an old pipeline job.",
  );
  const incompatible = await drainEnrichment({
    db,
    capability: newCapability,
    limit: 1,
    now: () => current,
    orgId: rollout.orgId,
  });
  assert.equal(incompatible.leased, 0);
  assert.deepEqual(await db.all<{ state: string; attempts: number }>(
    `SELECT state, attempts FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [rollout.orgId, `%${rolloutObservation}%`],
  ), [{ state: "pending", attempts: 0 }]);
  assert.equal((await drainEnrichment({
    db,
    capability: oldCapability,
    limit: 1,
    now: () => current,
    orgId: rollout.orgId,
  })).completed, 1);
  const oldPipelineJobId = `enr_old_pipeline_${runtime.replace(/[^a-z0-9]/gu, "_")}`;
  await db.batch([{
    sql: `INSERT INTO enrichment_jobs
            (id, org_id, lane, derivation_key, input_ids, input_hash, subject_id, project_id,
             workspace_id, actor_id, model_id, model_fingerprint,
             prompt_fingerprint, schema_fingerprint, policy_fingerprint, state,
             attempts, max_attempts, next_attempt_at, lease_token,
             lease_expires_at, error_class, output_hash, result_ids, created_at,
             updated_at)
          SELECT ?, org_id, lane, ?, input_ids, input_hash, subject_id, project_id,
                 workspace_id, actor_id, model_id, model_fingerprint,
                 prompt_fingerprint, ?, policy_fingerprint, 'pending', 0,
                 max_attempts, ?, NULL, NULL, NULL, NULL, NULL, ?, ?
            FROM enrichment_jobs
           WHERE org_id = ? AND input_ids LIKE ? LIMIT 1`,
    params: [
      oldPipelineJobId,
      "e".repeat(64),
      "f".repeat(64),
      current.toISOString(),
      current.toISOString(),
      current.toISOString(),
      rollout.orgId,
      `%${rolloutObservation}%`,
    ],
  }]);
  await drainEnrichment({
    db,
    capability: oldCapability,
    limit: 1,
    now: () => current,
    orgId: rollout.orgId,
  });
  assert.deepEqual(await db.all<{ state: string; attempts: number }>(
    `SELECT state, attempts FROM enrichment_jobs WHERE id = ?`,
    [oldPipelineJobId],
  ), [{ state: "pending", attempts: 0 }]);

  const expiredRollout = await createClient(oldCapability);
  const expiredRolloutObservation = await observe(
    expiredRollout,
    "subject_rollout_expired",
    "An expired old lease must recover without new-pipeline consumption.",
  );
  await db.batch([{
    sql: `UPDATE enrichment_jobs
             SET state = 'leased', attempts = 1, lease_token = 'old-worker-token',
                 lease_expires_at = ?, updated_at = ?
           WHERE org_id = ? AND input_ids LIKE ?`,
    params: [
      new Date(current.getTime() - 1).toISOString(),
      current.toISOString(),
      expiredRollout.orgId,
      `%${expiredRolloutObservation}%`,
    ],
  }]);
  assert.equal((await drainEnrichment({
    db,
    capability: newCapability,
    limit: 1,
    now: () => current,
    orgId: expiredRollout.orgId,
  })).leased, 0);
  assert.deepEqual(await db.all<{ state: string; attempts: number; lease_token: string | null }>(
    `SELECT state, attempts, lease_token FROM enrichment_jobs
      WHERE org_id = ? AND input_ids LIKE ?`,
    [expiredRollout.orgId, `%${expiredRolloutObservation}%`],
  ), [{ state: "pending", attempts: 1, lease_token: null }]);
  assert.equal((await drainEnrichment({
    db,
    capability: oldCapability,
    limit: 1,
    now: () => current,
    orgId: expiredRollout.orgId,
  })).completed, 1);

  const advancingCapability: ExtractionCapability = {
    ...capability,
    modelId: "sequential-fresh-lease",
    async generate(request) {
      current = new Date(current.getTime() + 25_000);
      return proposalFor(request);
    },
  };
  const sequential = await createClient(advancingCapability);
  for (const index of [1, 2, 3])
    await observe(
      sequential,
      `subject_sequential_${index}`,
      `Sequential provider call ${index} needs a fresh lease.`,
    );
  const sequentialResult = await drainEnrichment({
    db,
    capability: advancingCapability,
    limit: 3,
    now: () => current,
    orgId: sequential.orgId,
  });
  assert.equal(sequentialResult.completed, 3);
  assert.equal(sequentialResult.leased, 3);

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
    "Concurrent duplicate drains must produce one semantic result.",
  );
  const concurrentDuplicateObservation = await observe(
    concurrent,
    "subject_concurrent",
    "Concurrent duplicate drains must produce one semantic result.",
  );
  let started!: () => void;
  const modelStarted = new Promise<void>((resolve) => { started = resolve; });
  hold = new Promise<void>((resolve) => { releaseHold = resolve; });
  held = started;
  holdNext = true;
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
  assert.equal(firstResult.leased, 1);
  assert.equal(second.leased, 0, "a duplicate job must wait behind the leased canonical job");
  assert.equal(concurrentDuplicateCalls, 1);
  const reuseResult = await drainEnrichment({
    db,
    capability,
    limit: 2,
    now: () => current,
    orgId: concurrent.orgId,
  });
  assert.ok(reuseResult.leased >= 1);
  assert.ok(reuseResult.completed >= 1);
  assert.equal(
    concurrentDuplicateCalls,
    1,
    "the waiting duplicate must reuse without a second derivation model call",
  );
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claims
      WHERE org_id = ? AND subject_id = 'subject_concurrent'`,
    [concurrent.orgId],
  ))[0]!.count), 1);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM enrichment_commits c
      JOIN enrichment_jobs j ON j.id = c.job_id
      WHERE j.org_id = ? AND (j.input_ids LIKE ? OR j.input_ids LIKE ?)`,
    [
      concurrent.orgId,
      `%${concurrentObservation}%`,
      `%${concurrentDuplicateObservation}%`,
    ],
  ))[0]!.count), 2);
  assert.equal(Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM claim_sources s
       JOIN claims c ON c.id = s.claim_id
      WHERE c.org_id = ? AND c.subject_id = 'subject_concurrent'`,
    [concurrent.orgId],
  ))[0]!.count), 2);

  const expired = await createClient();
  const expiredObservation = await observe(
    expired,
    "subject_expired_lease",
    "STALE_INVALID_ONCE an expired semantic lease must fence stale failure output.",
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

  const readinessNoise = await createClient();
  assert.notEqual(readinessNoise.orgId, primary.orgId);
  await observe(
    readinessNoise,
    "subject_readiness_privacy",
    "One pending job must not expose a deployment-wide count.",
  );
  const readinessWithOne = await primary.client.call("GET", "/readyz");
  assert.equal(readinessWithOne.status, 200);
  const publicEnrichmentState = readinessWithOne.body.data.checks.enrichment_jobs;
  assert.deepEqual(Object.keys(publicEnrichmentState), ["state"]);
  assert.equal(typeof publicEnrichmentState.state, "string");
  await observe(
    readinessNoise,
    "subject_readiness_privacy",
    "A second pending job must not change public queue cardinality metadata.",
  );
  const readinessWithTwo = await primary.client.call("GET", "/readyz");
  assert.equal(readinessWithTwo.status, 200);
  assert.deepEqual(readinessWithTwo.body.data.checks.enrichment_jobs, publicEnrichmentState);

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
  await assert.rejects(
    () => db.batch([{
      sql: `UPDATE enrichment_jobs SET output_hash = ? WHERE id = ?`,
      params: ["c".repeat(64), immutable],
    }]),
    /ENRICHMENT_OUTPUT_IMMUTABLE/u,
  );
}
