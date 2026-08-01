import { createApiKey, organizationStatement } from "../../src/core/auth";
import { newId } from "../../src/core/ids";
import type { Db, Param } from "../../src/core/db";
import type { Trust } from "../../src/core/validate";
import {
  embeddingPolicyFingerprint,
  type VectorCapability,
} from "../../src/core/vectors";
import { createSecretCipher } from "../../src/core/secrets";
import type { WebhookSecurity } from "../../src/core/webhook-security";

export const TEST_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const TEST_SECRET_CIPHER = createSecretCipher({
  active: "test-v1",
  keys: { "test-v1": TEST_SECRET_KEY },
});
export const TEST_WEBHOOK_HOST = "hooks.example.com";
export const TEST_WEBHOOK_SECURITY: WebhookSecurity = {
  allowedHostnames: [TEST_WEBHOOK_HOST],
  resolve: async () => ["93.184.216.34"],
  dispatch: async ({ addresses }) => ({
    response: new Response("test transport refusal", { status: 503 }),
    connectedAddress: addresses[0]!,
  }),
};

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
    // Contract suites deliberately move the app clock across decades. Keep
    // fixture credentials valid throughout that simulated timeline.
    notBefore: new Date(0),
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
  setScore(id: string, score: number, metadata?: Record<string, string>): void;
  /** Make the embedder throw, to prove retrieval degrades instead of failing. */
  breakEmbedder(): void;
  restoreEmbedder(): void;
  breakStore(): void;
  restoreStore(): void;
  embedCalls: () => number;
  metadataFor(id: string): Record<string, string> | undefined;
  lastFilter: () => Record<string, string> | undefined;
} {
  const scores = new Map<string, number>();
  const metadata = new Map<string, Record<string, string>>();
  let broken = false;
  let storeBroken = false;
  let calls = 0;
  let filter: Record<string, string> | undefined;

  return {
    setScore: (id, score, scope) => {
      scores.set(id, score);
      if (scope) metadata.set(id, scope);
    },
    breakEmbedder: () => {
      broken = true;
    },
    restoreEmbedder: () => {
      broken = false;
    },
    breakStore: () => {
      storeBroken = true;
    },
    restoreStore: () => {
      storeBroken = false;
    },
    embedCalls: () => calls,
    metadataFor: (id) => metadata.get(id),
    lastFilter: () => filter,
    fingerprint: {
      provider: "contract",
      model: "contract-stub",
      revision: "v1",
      dimensions: 4,
      metric: "cosine",
      preprocessing: embeddingPolicyFingerprint("raw-unit-v1", 0.1),
      index_schema: "claims-scope-v1",
    },
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
      /**
       * Records what was indexed. A pinned score still wins, so a case can
       * control ranking, but an unpinned upsert is still observable — otherwise a
       * test cannot tell "indexed" from "silently dropped".
       */
      async upsert(records) {
        if (storeBroken) throw new Error("vector store is unavailable");
        for (const record of records) {
          metadata.set(record.id, record.metadata);
          if (!scores.has(record.id)) scores.set(record.id, 0.5);
        }
      },
      async query(_vector, options) {
        filter = options.filter;
        return [...scores.entries()]
          .filter(([id]) =>
            Object.entries(options.filter ?? {}).every(
              ([key, value]) => metadata.get(id)?.[key] === value,
            ),
          )
          .map(([id, score]) => ({ id, score }))
          .sort((left, right) => right.score - left.score)
          .slice(0, options.topK);
      },
      async remove(ids: string[]) {
        for (const id of ids) {
          scores.delete(id);
          metadata.delete(id);
        }
      },
    },
  };
}
