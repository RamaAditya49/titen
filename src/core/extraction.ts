export type EnrichmentLane = "derivation" | "reflection";

export interface ExtractionRequest {
  lane: EnrichmentLane;
  system: string;
  input: unknown;
  schema: Record<string, unknown>;
}

/** One untrusted proposal boundary shared by Bun and Cloudflare. */
export interface ExtractionCapability {
  modelId: string;
  modelFingerprint: string;
  /** Non-secret provider identity folded into durable job provenance. */
  providerIdentity?: string;
  generate(request: ExtractionRequest): Promise<unknown>;
}

/** Runtime guard for capabilities injected by embedders rather than config parsers. */
export function isExtractionCapability(value: unknown): value is ExtractionCapability {
  if (!value || typeof value !== "object") return false;
  const capability = value as Partial<ExtractionCapability>;
  return typeof capability.modelId === "string"
    && capability.modelId.trim().length > 0
    && capability.modelId.length <= 200
    && typeof capability.modelFingerprint === "string"
    && /^[a-f0-9]{64}$/u.test(capability.modelFingerprint)
    && (capability.providerIdentity === undefined
      || (typeof capability.providerIdentity === "string"
        && capability.providerIdentity.length > 0
        && capability.providerIdentity.length <= 2_048))
    && typeof capability.generate === "function";
}

/** Copy mutable/embedder-owned configuration into one immutable startup snapshot. */
export function snapshotExtractionCapability(value: unknown): ExtractionCapability | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    const source = value as ExtractionCapability;
    const generate = source.generate;
    let snapshot!: ExtractionCapability;
    snapshot = {
      modelId: source.modelId,
      modelFingerprint: source.modelFingerprint,
      ...(source.providerIdentity === undefined
        ? {}
        : { providerIdentity: source.providerIdentity }),
      generate(request) {
        return generate.call(snapshot, request);
      },
    };
    return isExtractionCapability(snapshot) ? Object.freeze(snapshot) : undefined;
  } catch {
    return undefined;
  }
}

export type ExtractionConfigurationState = "disabled" | "enabled" | "configured_error";

export type ProviderFailureClass =
  | "provider_unavailable"
  | "provider_rejected"
  | "provider_protocol";

export class ExtractionProviderError extends Error {
  constructor(
    readonly failureClass: ProviderFailureClass,
    readonly retryable: boolean,
  ) {
    super(failureClass);
    this.name = "ExtractionProviderError";
  }
}

const MAX_PROVIDER_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
// Leaves deterministic validation and commit headroom inside the 60s job lease.
const MAX_TIMEOUT_MS = 45_000;

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        throw new ExtractionProviderError("provider_unavailable", true);
      }
      const { done, value } = next;
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PROVIDER_BYTES)
        throw new ExtractionProviderError("provider_protocol", false);
      try {
        text += decoder.decode(value, { stream: true });
      } catch {
        throw new ExtractionProviderError("provider_protocol", false);
      }
    }
    try {
      return text + decoder.decode();
    } catch {
      throw new ExtractionProviderError("provider_protocol", false);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ExtractionProviderError) throw error;
    throw new ExtractionProviderError("provider_protocol", false);
  } finally {
    reader.releaseLock();
  }
}

function endpoint(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    || url.username
    || url.password
    || url.search
    || url.hash
  ) throw new Error("Extraction endpoint must be HTTPS or loopback HTTP without credentials, query, or hash.");
  return url.toString().replace(/\/$/u, "");
}

function fingerprint(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value))
    throw new Error("Extraction model fingerprint must be 64 lowercase hexadecimal characters.");
  return value;
}

/**
 * OpenAI-compatible structured output over native fetch. The explicit model
 * fingerprint is required because a mutable model alias is not release
 * provenance.
 */
export function createHttpExtraction(config: {
  baseUrl: string;
  model: string;
  modelFingerprint: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): ExtractionCapability {
  const baseUrl = endpoint(config.baseUrl);
  const modelId = config.model.trim();
  if (!modelId || modelId.length > 200) throw new Error("Extraction model ID is invalid.");
  const modelFingerprint = fingerprint(config.modelFingerprint);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS)
    throw new Error(`Extraction timeout must be between 1000 and ${MAX_TIMEOUT_MS} milliseconds.`);
  const dispatch = config.fetch ?? fetch;

  return {
    modelId,
    modelFingerprint,
    providerIdentity: baseUrl,
    async generate(request) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
      let response: Response;
      try {
        response = await dispatch(`${baseUrl}/chat/completions`, {
          method: "POST",
          redirect: "error",
          headers,
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model: modelId,
            temperature: 0,
            max_tokens: 2_048,
            messages: [
              { role: "system", content: request.system },
              {
                role: "user",
                content: `UNTRUSTED_INPUT_JSON\n${JSON.stringify(request.input)}`,
              },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: `titen_${request.lane}_proposal`,
                strict: true,
                schema: request.schema,
              },
            },
          }),
        });
      } catch {
        throw new ExtractionProviderError("provider_unavailable", true);
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new ExtractionProviderError(
          response.status === 408 || response.status === 429 || response.status >= 500
            ? "provider_unavailable"
            : "provider_rejected",
          response.status === 408 || response.status === 429 || response.status >= 500,
        );
      }
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > MAX_PROVIDER_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        throw new ExtractionProviderError("provider_protocol", false);
      }
      const text = await boundedResponseText(response);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ExtractionProviderError("provider_protocol", false);
      }
      const content = (body as any)?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length > 64 * 1024)
        throw new ExtractionProviderError("provider_protocol", false);
      try {
        return JSON.parse(content);
      } catch {
        throw new ExtractionProviderError("provider_protocol", false);
      }
    },
  };
}

/** Partial or invalid opt-in never crashes the canonical service. */
export function configureHttpExtraction(config: {
  baseUrl?: string;
  model?: string;
  modelFingerprint?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): { capability?: ExtractionCapability; state: ExtractionConfigurationState } {
  const required = [config.baseUrl, config.model, config.modelFingerprint];
  const supplied = [...required, config.apiKey, config.timeoutMs]
    .some((value) => value !== undefined && value !== "");
  if (!supplied)
    return { state: "disabled" };
  if (required.some((value) => value === undefined || value === ""))
    return { state: "configured_error" };
  try {
    return {
      state: "enabled",
      capability: createHttpExtraction({
        baseUrl: config.baseUrl!,
        model: config.model!,
        modelFingerprint: config.modelFingerprint!,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
        fetch: config.fetch,
      }),
    };
  } catch {
    return { state: "configured_error" };
  }
}
