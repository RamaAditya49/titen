import { auditStatement } from "./audit";
import { first } from "./db";
import { ApiError, unavailable } from "./errors";
import { requireOrgRole } from "./governance";
import type { RequestContext, Result } from "./http";
import { requireEnum, requireObject } from "./validate";
import { embedForRetrieval } from "./vectors";

function set(value: unknown): "set" | "unset" {
  return value ? "set" : "unset";
}

export async function getModelConfig(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "models.config");
  const config = ctx.app.modelConfiguration;
  const stored = await first<Record<string, unknown>>(ctx.app.db,
    `SELECT provider, model, revision, dimensions, metric, preprocessing, index_schema
       FROM semantic_index_metadata WHERE id = 'claims'`);
  return { data: {
    immutable_startup_snapshot: true,
    extraction: {
      state: ctx.app.modelCapabilities.extraction,
      diagnostic: ctx.app.modelCapabilities.extraction === "configured_error"
        ? "extraction_configuration_invalid" : null,
      base_url: config?.extraction.baseUrl ?? ctx.app.extraction?.providerIdentity ?? null,
      model: config?.extraction.model ?? ctx.app.extraction?.modelId ?? null,
      model_fingerprint: config?.extraction.modelFingerprint ?? ctx.app.extraction?.modelFingerprint ?? null,
      response_mode: config?.extraction.responseMode ?? ctx.app.extraction?.responseMode ?? "json_schema",
      timeout_ms: config?.extraction.timeoutMs ?? null,
      api_key: set(config?.extraction.apiKeySet),
    },
    embedding: {
      state: ctx.app.semanticReadiness.embedding,
      vector_state: ctx.app.semanticReadiness.vector,
      diagnostic: ctx.app.semanticReadiness.diagnostic ?? null,
      base_url: config?.embedding.baseUrl ?? null,
      model: config?.embedding.model ?? ctx.app.vectors?.fingerprint.model ?? null,
      dimensions: config?.embedding.dimensions ?? ctx.app.vectors?.fingerprint.dimensions ?? null,
      revision: config?.embedding.revision ?? ctx.app.vectors?.fingerprint.revision ?? null,
      profile: config?.embedding.profile ?? null,
      minimum_cosine: config?.embedding.minimumCosine ?? null,
      api_key: set(config?.embedding.apiKeySet),
      configured_fingerprint: ctx.app.vectors?.fingerprint ?? null,
      stored_fingerprint: stored ?? null,
      drift: Boolean(stored && ctx.app.vectors
        && JSON.stringify(stored) !== JSON.stringify(ctx.app.vectors.fingerprint)),
    },
    authority: {
      may: ["classify observations", "propose add-only claims", "reflect over authorized premises", "retrieve candidates"],
      never: ["delete or supersede evidence", "raise trust", "resolve disputes", "approve or publish", "grant access", "operate leases, handoffs, or checkpoints"],
    },
  } };
}

export async function probeModel(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "models.probe");
  const body = requireObject(await ctx.json());
  const group = requireEnum(body, "group", ["extraction", "embedding"] as const);
  const principal = ctx.principal!;
  const now = ctx.app.now();
  const recent = await first<{ count: number }>(ctx.app.db,
    `SELECT COUNT(*) AS count FROM audit_log
      WHERE org_id = ? AND actor_id = ? AND action = 'model.probe'
        AND created_at > ?`,
    [principal.orgId, principal.principalId, new Date(now.getTime() - 10_000).toISOString()]);
  if (Number(recent?.count ?? 0) > 0)
    throw new ApiError(429, "RATE_LIMITED", "Wait ten seconds before probing this provider again.");
  const started = performance.now();
  let data: Record<string, unknown>;
  let outcome = "success";
  try {
    if (group === "extraction") {
      if (!ctx.app.extraction || ctx.app.modelCapabilities.extraction !== "enabled")
        throw unavailable("The extraction provider is not enabled.");
      const value = await ctx.app.extraction.generate({
        lane: "derivation",
        system: "Return the exact JSON object required by the schema.",
        input: { operation: "titen_provider_probe" },
        schema: {
          type: "object", additionalProperties: false,
          properties: { ok: { type: "boolean", const: true } }, required: ["ok"],
        },
      });
      const valid = Boolean(value && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).length === 1 && (value as { ok?: unknown }).ok === true);
      data = { group, valid, schema_enforced: valid && ctx.app.extraction.responseMode !== "json_object",
        response_mode: ctx.app.extraction.responseMode ?? "json_schema" };
    } else {
      if (!ctx.app.vectors || ctx.app.semanticReadiness.embedding !== "enabled")
        throw unavailable("The embedding provider is not enabled.");
      const vectors = await embedForRetrieval(ctx.app.vectors, "query", ["Titen provider probe"]);
      const vector = vectors[0]!;
      let squared = 0;
      for (const value of vector) squared += value * value;
      data = { group, valid: vector.length === ctx.app.vectors.embedder.dimensions,
        vector_count: vectors.length, dimensions: vector.length,
        finite: vector.every(Number.isFinite), norm: Math.sqrt(squared) };
    }
  } catch (error) {
    outcome = error instanceof ApiError ? error.code : "provider_error";
    throw error instanceof ApiError ? error : unavailable("The model provider probe failed.");
  } finally {
    await ctx.app.db.batch([auditStatement(principal.orgId, principal.principalId,
      "model.probe", "model_provider", now.toISOString(), group,
      JSON.stringify({ group, outcome }))]);
  }
  return { data: { ...data, latency_ms: Math.max(0, Math.round(performance.now() - started)) } };
}
