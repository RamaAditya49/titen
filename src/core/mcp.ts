import type { RequestContext, Result } from "./http";
import { validationError } from "./errors";
import { newId, sha256Hex } from "./ids";
import { ftsQuery, retrieveClaimCandidates } from "./retrieval";
import { rankCandidates, packUnderBudget } from "./rank";
import { estimateJsonTokens } from "./tokens";
import { first, chunk } from "./db";
import { CONTEXT_INSTRUCTIONS, POLICY_SNAPSHOT, MIN_BUDGET_TOKENS } from "./context";

// --- JSON-RPC types ---

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

// --- JSON-RPC error codes ---

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// --- Tool schemas ---

const CHECKPOINT_KINDS = ["task_state", "conversation", "workflow", "cursor"];
const OUTCOMES = ["used", "useful", "irrelevant", "incorrect", "harmful"];

/**
 * Tool specs as data: `name!` marks a required argument, `name:i` an integer,
 * `name:?` a free-form value, and `name=a|b` an enum. One builder expands them
 * into JSON Schema so adding a tool is one line, not a nested literal.
 */
const TOOL_SPECS: [name: string, description: string, args: string][] = [
  ["titen_remember", "Append an observation to memory.",
    "subject_id! kind! content! source_type! source_ref! trust visibility"],
  ["titen_compile", "Compile context for a task.",
    "subject_id! task! max_tokens!:i"],
  ["titen_feedback", "Record feedback on a context run.",
    `context_id! outcome!=${OUTCOMES.join("|")} claim_id reason_code`],
  ["titen_checkpoint_save", "Save or update a checkpoint.",
    `subject_id! kind!=${CHECKPOINT_KINDS.join("|")} state!:? ttl_seconds!:i`],
  ["titen_checkpoint_get", "Get the current checkpoint for a subject and kind.",
    `subject_id! kind!=${CHECKPOINT_KINDS.join("|")}`],
  ["titen_lease_acquire", "Acquire a coordination lease on a resource.",
    "resource_type! resource_id! purpose! ttl_seconds!:i"],
  ["titen_handoff", "Create a handoff to another principal.",
    "to_principal! subject_id! message"],
];

const TOOLS = TOOL_SPECS.map(([name, description, args]) => {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const token of args.split(" ")) {
    const [head, values] = token.split("=");
    const isRequired = head!.includes("!");
    const [field, type] = head!.replace("!", "").split(":");
    if (isRequired) required.push(field!);
    properties[field!] = values
      ? { type: "string", enum: values.split("|") }
      : type === "i"
        ? { type: "integer" }
        : type === "?"
          ? {}
          : { type: "string" };
  }
  return { name, description, inputSchema: { type: "object", properties, required } };
});

// --- Helpers ---

function rpcOk(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function requireArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0)
    throw new Error(`Missing required argument: ${key}`);
  return v;
}

// --- Tool implementations ---

async function toolRemember(ctx: RequestContext, args: Record<string, unknown>) {
  const principal = ctx.principal!;
  const subjectId = requireArg(args, "subject_id");
  const kind = requireArg(args, "kind");
  const content = requireArg(args, "content");
  const sourceType = requireArg(args, "source_type");
  const sourceRef = (args.source_ref as string) || null;
  const trust = (args.trust as string) || "asserted";
  const visibility = (args.visibility as string) || "team";

  const id = newId("obs");
  const at = ctx.app.now().toISOString();
  const contentHash = await sha256Hex(content);

  await ctx.app.db.batch([
    {
      sql: `INSERT INTO observations
              (id, org_id, subject_id, project_id, agent_id, run_id, actor_id, kind, content,
               content_hash, source_type, source_ref, trust, visibility, occurred_at, ingested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, principal.orgId, subjectId, null, null, null,
        principal.principalId, kind, content, contentHash,
        sourceType, sourceRef, trust, visibility, null, at,
      ],
    },
    {
      sql: `INSERT INTO observations_fts (content, observation_id) VALUES (?, ?)`,
      params: [content, id],
    },
  ]);

  return { observation_id: id, ingested_at: at };
}

async function toolCompile(ctx: RequestContext, args: Record<string, unknown>) {
  const principal = ctx.principal!;
  const subjectId = requireArg(args, "subject_id");
  const task = requireArg(args, "task");
  const maxTokens = typeof args.max_tokens === "number" ? args.max_tokens : 2048;

  if (maxTokens < MIN_BUDGET_TOKENS)
    throw new Error(`max_tokens must be >= ${MIN_BUDGET_TOKENS}`);

  const now = ctx.app.now();
  const at = now.toISOString();
  const match = ftsQuery(task);
  const candidates = match
    ? await retrieveClaimCandidates(ctx.app.db, principal, match, {
        subjectId,
        projectId: null,
        at,
      })
    : [];

  const ranked = rankCandidates(candidates, now);
  const evidenceMap = await loadEvidenceIds(ctx, ranked.map(r => r.candidate.id));

  const entries = ranked.map(entry => {
    const item = {
      claim_id: entry.candidate.id,
      claim: entry.candidate.statement,
      kind: entry.candidate.kind,
      confidence: entry.candidate.confidence,
      trust: entry.candidate.trust,
      evidence_ids: evidenceMap.get(entry.candidate.id) ?? [],
      score: entry.score,
    };
    return { value: item, kind: entry.candidate.kind, tokens: estimateJsonTokens(item) };
  });

  const envelopeTokens = estimateJsonTokens({ context_id: "", query: "", budget: {}, instructions: "" });
  const packed = packUnderBudget(entries, maxTokens - envelopeTokens);
  const contextId = newId("ctx");

  await ctx.app.db.batch([
    {
      sql: `INSERT INTO context_runs
              (id, org_id, actor_id, subject_id, project_id, task_hash, max_tokens, used_tokens,
               policy_snapshot, degraded, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        contextId, principal.orgId, principal.principalId, subjectId, null,
        await sha256Hex(task), maxTokens, packed.usedTokens, POLICY_SNAPSHOT,
        JSON.stringify({ semantic: false, vector: "disabled", model: "disabled" }), at,
      ],
    },
  ]);

  return {
    context_id: contextId,
    query: task,
    budget: { max_tokens: maxTokens, used_tokens: packed.usedTokens },
    items: packed.selected,
    instructions: CONTEXT_INSTRUCTIONS,
  };
}

async function toolFeedback(ctx: RequestContext, args: Record<string, unknown>) {
  const principal = ctx.principal!;
  const contextId = requireArg(args, "context_id");
  const outcome = requireArg(args, "outcome");
  const claimId = (args.claim_id as string) || null;
  const reasonCode = (args.reason_code as string) || null;

  const run = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM context_runs WHERE id = ? AND org_id = ?`,
    [contextId, principal.orgId],
  );
  if (!run) throw new Error("Context run not found.");

  const id = newId("fb");
  const at = ctx.app.now().toISOString();

  await ctx.app.db.batch([{
    sql: `INSERT INTO context_feedback
            (id, org_id, context_id, claim_id, actor_id, outcome, reason_code, client_mutation_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [id, principal.orgId, contextId, claimId, principal.principalId, outcome, reasonCode, null, at],
  }]);

  return { feedback_id: id, context_id: contextId, outcome, recorded_at: at };
}

async function toolCheckpointSave(ctx: RequestContext, args: Record<string, unknown>) {
  const principal = ctx.principal!;
  const subjectId = requireArg(args, "subject_id");
  const kind = requireArg(args, "kind");
  const state = args.state;
  if (state === undefined || state === null) throw new Error("state is required.");
  const ttlSeconds = typeof args.ttl_seconds === "number" ? args.ttl_seconds : 3600;

  const serialized = JSON.stringify(state);
  const now = ctx.app.now();
  const at = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const stateHash = await sha256Hex(serialized);

  const existing = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM checkpoints
       WHERE org_id = ? AND subject_id = ? AND agent_id = ? AND kind = ?`,
    [principal.orgId, subjectId, principal.principalId, kind],
  );

  if (existing) {
    await ctx.app.db.batch([{
      sql: `UPDATE checkpoints SET state = ?, state_hash = ?, ttl_seconds = ?, expires_at = ?, updated_at = ? WHERE id = ?`,
      params: [serialized, stateHash, ttlSeconds, expiresAt, at, existing.id],
    }]);
    return { checkpoint_id: existing.id, expires_at: expiresAt, updated: true };
  }

  const id = newId("ckpt");
  await ctx.app.db.batch([{
    sql: `INSERT INTO checkpoints
            (id, org_id, subject_id, agent_id, run_id, kind, state, state_hash,
             ttl_seconds, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [id, principal.orgId, subjectId, principal.principalId, null, kind, serialized, stateHash, ttlSeconds, expiresAt, at, at],
  }]);

  return { checkpoint_id: id, expires_at: expiresAt, updated: false };
}

async function toolCheckpointGet(ctx: RequestContext, args: Record<string, unknown>) {
  const principal = ctx.principal!;
  const subjectId = requireArg(args, "subject_id");
  const kind = requireArg(args, "kind");
  const now = ctx.app.now().toISOString();

  const row = await first<{ id: string; state: string; state_hash: string; expires_at: string }>(
    ctx.app.db,
    `SELECT id, state, state_hash, expires_at FROM checkpoints
       WHERE org_id = ? AND subject_id = ? AND agent_id = ? AND kind = ? AND expires_at > ?`,
    [principal.orgId, subjectId, principal.principalId, kind, now],
  );
  if (!row) throw new Error("Checkpoint not found or expired.");

  return { checkpoint_id: row.id, state: JSON.parse(row.state), state_hash: row.state_hash, expires_at: row.expires_at };
}

async function toolLeaseAcquire(ctx: RequestContext, args: Record<string, unknown>) {
  const principal = ctx.principal!;
  const resourceType = requireArg(args, "resource_type");
  const resourceId = requireArg(args, "resource_id");
  const purpose = requireArg(args, "purpose");
  const ttlSeconds = typeof args.ttl_seconds === "number" ? args.ttl_seconds : 300;

  const now = ctx.app.now();
  const nowIso = now.toISOString();

  const existing = await first<{ id: string; holder_id: string; expires_at: string }>(
    ctx.app.db,
    `SELECT id, holder_id, expires_at FROM leases
       WHERE org_id = ? AND resource_type = ? AND resource_id = ? AND released_at IS NULL`,
    [principal.orgId, resourceType, resourceId],
  );

  if (existing) {
    if (existing.holder_id !== principal.principalId && new Date(existing.expires_at) > now)
      throw new Error(`Resource is leased until ${existing.expires_at}.`);
    await ctx.app.db.batch([{
      sql: `UPDATE leases SET released_at = ? WHERE id = ?`,
      params: [nowIso, existing.id],
    }]);
  }

  const id = newId("lease");
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  await ctx.app.db.batch([{
    sql: `INSERT INTO leases (id, org_id, resource_type, resource_id, holder_id, purpose, ttl_seconds, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [id, principal.orgId, resourceType, resourceId, principal.principalId, purpose, ttlSeconds, expiresAt, nowIso],
  }]);

  return { lease_id: id, expires_at: expiresAt };
}

async function toolHandoff(ctx: RequestContext, args: Record<string, unknown>) {
  const principal = ctx.principal!;
  const toPrincipal = requireArg(args, "to_principal");
  const subjectId = requireArg(args, "subject_id");
  const message = (args.message as string) || null;

  const id = newId("hoff");
  const now = ctx.app.now().toISOString();

  await ctx.app.db.batch([{
    sql: `INSERT INTO handoffs (id, org_id, from_principal, to_principal, subject_id, context_id, checkpoint_id, message, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    params: [id, principal.orgId, principal.principalId, toPrincipal, subjectId, null, null, message, now],
  }]);

  return { handoff_id: id, status: "pending" };
}

// --- Evidence loader (shared with context compile) ---

async function loadEvidenceIds(
  ctx: RequestContext,
  claimIds: string[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  if (claimIds.length === 0) return grouped;
  for (const group of chunk(claimIds)) {
    const rows = await ctx.app.db.all<{ claim_id: string; observation_id: string }>(
      `SELECT claim_id, observation_id FROM claim_sources
        WHERE claim_id IN (${group.map(() => "?").join(", ")})
        ORDER BY claim_id, observation_id`,
      group,
    );
    for (const row of rows) {
      const list = grouped.get(row.claim_id) ?? [];
      list.push(row.observation_id);
      grouped.set(row.claim_id, list);
    }
  }
  return grouped;
}

// --- Dispatch ---

const TOOL_HANDLERS: Record<string, (ctx: RequestContext, args: Record<string, unknown>) => Promise<unknown>> = {
  titen_remember: toolRemember,
  titen_compile: toolCompile,
  titen_feedback: toolFeedback,
  titen_checkpoint_save: toolCheckpointSave,
  titen_checkpoint_get: toolCheckpointGet,
  titen_lease_acquire: toolLeaseAcquire,
  titen_handoff: toolHandoff,
};

/**
 * Streamable HTTP MCP endpoint. Handles JSON-RPC 2.0 requests for the
 * Model Context Protocol at /mcp.
 */
export async function handleMcp(ctx: RequestContext): Promise<Result> {
  let body: unknown;
  try {
    body = await ctx.json();
  } catch {
    return { data: rpcError(null, PARSE_ERROR, "Parse error.") };
  }

  const req = body as JsonRpcRequest;
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return { data: rpcError(req?.id ?? null, INVALID_REQUEST, "Invalid JSON-RPC request.") };
  }

  const id = req.id ?? null;

  switch (req.method) {
    case "initialize":
      return {
        data: rpcOk(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "titen", version: "0.2.0" },
        }),
      };

    case "tools/list":
      return {
        data: rpcOk(id, {
          tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        }),
      };

    case "tools/call": {
      const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const toolName = params.name;
      if (typeof toolName !== "string")
        return { data: rpcError(id, INVALID_PARAMS, "Missing tool name.") };

      const handler = TOOL_HANDLERS[toolName];
      if (!handler)
        return { data: rpcError(id, INVALID_PARAMS, `Unknown tool: ${toolName}`) };

      const toolArgs = params.arguments ?? {};
      try {
        const result = await handler(ctx, toolArgs);
        return {
          data: rpcOk(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          }),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Tool execution failed.";
        return {
          data: rpcOk(id, {
            content: [{ type: "text", text: msg }],
            isError: true,
          }),
        };
      }
    }

    default:
      return { data: rpcError(id, METHOD_NOT_FOUND, `Method not found: ${req.method}`) };
  }
}
