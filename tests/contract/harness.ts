import { createApiKey, organizationStatement } from "../../src/core/auth";
import { newId } from "../../src/core/ids";
import type { Db, Param } from "../../src/core/db";
import type { Trust } from "../../src/core/validate";
import type { VectorCapability } from "../../src/core/vectors";

export interface Res {
  status: number;
  body: any;
  headers: Headers;
}

export interface ProvisionOptions {
  orgId?: string;
  orgName?: string;
  principalId?: string;
  principalKind?: "human" | "agent" | "service";
  scopes?: string[];
  maxTrust?: Trust;
}

export interface Provisioned {
  orgId: string;
  keyId: string;
  key: string;
  principalId: string;
}

/**
 * The only surface a contract case may use. Both runtimes implement it, so a
 * case cannot accidentally depend on Bun or Cloudflare behavior.
 */
export interface Fixture {
  runtime: string;
  call(
    method: string,
    path: string,
    options?: { body?: unknown; key?: string; headers?: Record<string, string> },
  ): Promise<Res>;
  /** Sends an already-serialized body, e.g. NDJSON import payloads. */
  callRaw(
    method: string,
    path: string,
    options: { body: string; key?: string; contentType?: string },
  ): Promise<Res>;
  provision(options?: ProvisionOptions): Promise<Provisioned>;
  revoke(keyId: string): Promise<void>;
  query<Row>(sql: string, params?: Param[]): Promise<Row[]>;
  /** Restart the process/isolate against the same persisted storage. */
  restart(): Promise<void>;
}

export const DEFAULT_SCOPES = [
  "projects:resolve",
  "projects:create",
  "observations:write",
  "claims:write",
  "context:compile",
  "feedback:write",
  "evidence:read",
  "checkpoints:read",
  "checkpoints:write",
];

export async function provisionWith(db: Db, options: ProvisionOptions = {}): Promise<Provisioned> {
  const orgId = options.orgId ?? newId("org");
  const key = await createApiKey({
    orgId,
    principalId: options.principalId ?? newId("agent"),
    principalKind: options.principalKind ?? "agent",
    label: "contract test key",
    scopes: options.scopes ?? DEFAULT_SCOPES,
    maxTrust: options.maxTrust ?? "verified",
  });
  const statements = options.orgId
    ? [key.statement]
    : [organizationStatement(orgId, options.orgName ?? "Contract Org"), key.statement];
  await db.batch(statements);
  return {
    orgId,
    keyId: key.id,
    key: key.key,
    principalId: key.statement.params[2] as string,
  };
}

export async function revokeWith(db: Db, keyId: string): Promise<void> {
  await db.batch([
    {
      sql: `UPDATE api_keys SET revoked_at = ? WHERE id = ?`,
      params: [new Date().toISOString(), keyId],
    },
  ]);
}

/** Builds the client implementations from any raw request dispatcher. */
export function clientVia(  dispatch: (request: Request) => Promise<Response>,
  origin: string,
): Pick<Fixture, "call" | "callRaw"> {
  const send = async (
    method: string,
    path: string,
    headers: Record<string, string>,
    body: string | undefined,
  ): Promise<Res> => {
    const response = await dispatch(new Request(`${origin}${path}`, { method, headers, body }));
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON bodies stay raw so a case can assert on them */
    }
    return { status: response.status, body: parsed, headers: response.headers };
  };

  return {
    call(method, path, options = {}) {
      const headers: Record<string, string> = { ...options.headers };
      if (options.key) headers.authorization = `Bearer ${options.key}`;
      if (options.body !== undefined) headers["content-type"] = "application/json";
      return send(
        method,
        path,
        headers,
        options.body === undefined ? undefined : JSON.stringify(options.body),
      );
    },
    callRaw(method, path, options) {
      const headers: Record<string, string> = {
        "content-type": options.contentType ?? "application/x-ndjson",
      };
      if (options.key) headers.authorization = `Bearer ${options.key}`;
      return send(method, path, headers, options.body);
    },
  };
}

/**
 * An in-memory vector capability for exercising the hybrid retrieval path.
 *
 * Real vector retrieval needs a native extension (sqlite-vec) or a Cloudflare
 * binding (Vectorize) plus an embedding provider, none of which belong in a
 * contract test. This stands in for all three so the shared core's hybrid
 * branch actually executes and its effect on ranking is observable.
 */
export function fakeVectors(): VectorCapability & {
  /** Pin a similarity score for a record id, as a real index would return. */
  setScore(id: string, score: number): void;
  /** Make the embedder throw, to prove retrieval degrades instead of failing. */
  breakEmbedder(): void;
  embedCalls: () => number;
} {
  const scores = new Map<string, number>();
  let broken = false;
  let calls = 0;

  return {
    setScore: (id, score) => scores.set(id, score),
    breakEmbedder: () => {
      broken = true;
    },
    embedCalls: () => calls,
    embedder: {
      dimensions: 4,
      model: "contract-stub",
      async embed(texts: string[]) {
        calls += 1;
        if (broken) throw new Error("embedding provider is unavailable");
        return texts.map(() => new Float32Array([1, 0, 0, 0]));
      },
    },
    store: {
      async upsert() {
        /* the fixture pins scores directly */
      },
      async query(_vector, options) {
        return [...scores.entries()]
          .map(([id, score]) => ({ id, score }))
          .sort((left, right) => right.score - left.score)
          .slice(0, options.topK);
      },
      async remove(ids: string[]) {
        for (const id of ids) scores.delete(id);
      },
    },
  };
}
