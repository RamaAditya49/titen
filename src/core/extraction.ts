export type EnrichmentLane = "derivation" | "reflection";
export type ExtractionResponseMode = "json_schema" | "json_object";

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
  /** Observable request contract used by configured HTTP providers. */
  responseMode?: ExtractionResponseMode;
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
    && (capability.responseMode === undefined
      || capability.responseMode === "json_schema"
      || capability.responseMode === "json_object")
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
      ...(source.responseMode === undefined
        ? {}
        : { responseMode: source.responseMode }),
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
      // Inferred, not annotated: bun-types and lib.dom each declare their own
      // read-result type, so naming either one breaks under the other runtime.
      let next;
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
  responseMode?: ExtractionResponseMode;
  fetch?: typeof fetch;
}): ExtractionCapability {
  const baseUrl = endpoint(config.baseUrl);
  const modelId = config.model.trim();
  if (!modelId || modelId.length > 200) throw new Error("Extraction model ID is invalid.");
  const modelFingerprint = fingerprint(config.modelFingerprint);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS)
    throw new Error(`Extraction timeout must be between 1000 and ${MAX_TIMEOUT_MS} milliseconds.`);
  const responseMode = config.responseMode ?? "json_schema";
  if (responseMode !== "json_schema" && responseMode !== "json_object")
    throw new Error("Extraction response mode must be json_schema or json_object.");
  const dispatch = config.fetch ?? fetch;

  return {
    modelId,
    modelFingerprint,
    responseMode,
    providerIdentity: baseUrl,
    async generate(request) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (config.apiKey) headers["authorization"] = `Bearer ${config.apiKey}`;
      let response: Response;
      try {
        response = await dispatch(`${baseUrl}/chat/completions`, {
          method: "POST",
          redirect: "manual",
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
                content: responseMode === "json_object"
                  ? `REQUIRED_OUTPUT_SCHEMA_JSON\n${JSON.stringify(request.schema)}\n\nUNTRUSTED_INPUT_JSON\n${JSON.stringify(request.input)}`
                  : `UNTRUSTED_INPUT_JSON\n${JSON.stringify(request.input)}`,
              },
            ],
            response_format: responseMode === "json_schema"
              ? {
                  type: "json_schema",
                  json_schema: {
                    name: `titen_${request.lane}_proposal`,
                    strict: true,
                    schema: request.schema,
                  },
                }
              : { type: "json_object" },
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
      const completion = (body as any)?.choices?.[0];
      if (completion?.finish_reason !== "stop")
        throw new ExtractionProviderError("provider_protocol", false);
      const content = completion?.message?.content;
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

const GATE_DEFAULT_ABSTAIN_BELOW = 0.1;
const GATE_DEFAULT_TIMEOUT_MS = 3_000;
// Gate plus the 45s extraction ceiling must stay inside the 60s job lease.
const GATE_MAX_TIMEOUT_MS = 5_000;

const GATE_QUESTION = {
  type: "noul",
  instructions: "Does `observation.content` state a durable fact that a later session should recall: "
    + "a preference, an accepted decision, a verified fact, a reusable procedure, or a correction?",
  criteria: {
    true: "A durable fact that a later session should recall",
    false: "Routine tool output, chatter, a transient status, or no fact",
  },
} as const;

/**
 * Structured yes/no decision (System One wire format: TypeSafe
 * `/v1/systemone`, OpenRouter `/api/v1/systemone` or `/api/alpha/decisions`)
 * in front of derivation. Only a confident "no" skips the generative call and
 * becomes an ordinary abstain; the gate can never add, link, or raise trust.
 */
export function createHttpDecisionGate(inner: ExtractionCapability, config: {
  url: string;
  model: string;
  apiKey?: string;
  abstainBelow?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): ExtractionCapability {
  const url = endpoint(config.url);
  const model = config.model.trim();
  if (!model || model.length > 200 || /latest/iu.test(model))
    throw new Error("Decision gate model must be a pinned model ID, not a latest alias.");
  const abstainBelow = config.abstainBelow ?? GATE_DEFAULT_ABSTAIN_BELOW;
  if (!(abstainBelow > 0 && abstainBelow < 0.5))
    throw new Error("Decision gate abstain threshold must be above 0 and below 0.5.");
  const timeoutMs = config.timeoutMs ?? GATE_DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > GATE_MAX_TIMEOUT_MS)
    throw new Error(`Decision gate timeout must be between 500 and ${GATE_MAX_TIMEOUT_MS} milliseconds.`);
  const dispatch = config.fetch ?? fetch;

  async function probabilityYes(state: unknown): Promise<number> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (config.apiKey) headers["authorization"] = `Bearer ${config.apiKey}`;
    const response = await dispatch(url, {
      method: "POST",
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model, state, questions: { durable: GATE_QUESTION } }),
    });
    if (!response.ok || Number(response.headers.get("content-length") ?? "0") > MAX_PROVIDER_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("gate_rejected");
    }
    const yes = (JSON.parse(await boundedResponseText(response)) as any)?.answers?.durable?.noul;
    if (typeof yes !== "number" || !(yes >= 0 && yes <= 1)) throw new Error("gate_protocol");
    return yes;
  }

  return {
    modelId: inner.modelId,
    modelFingerprint: inner.modelFingerprint,
    ...(inner.responseMode === undefined ? {} : { responseMode: inner.responseMode }),
    // Folded into the job model fingerprint, so gate changes re-key the pipeline.
    providerIdentity: `${inner.providerIdentity ?? "native"} gate=${url}#${model}<${abstainBelow}`,
    async generate(request) {
      if (request.lane === "derivation") {
        // ponytail: any gate failure falls through to the generative call; an
        // optional cost optimization never stalls or drops enrichment.
        const yes = await probabilityYes(request.input).catch(() => undefined);
        if (yes !== undefined && yes < abstainBelow) return { action: "abstain", claims: null };
      }
      return inner.generate(request);
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
  responseMode?: ExtractionResponseMode | string;
  gateUrl?: string;
  gateModel?: string;
  gateApiKey?: string;
  gateAbstainBelow?: number;
  gateTimeoutMs?: number;
  fetch?: typeof fetch;
}): { capability?: ExtractionCapability; state: ExtractionConfigurationState } {
  const given = (value: unknown) => value !== undefined && value !== "";
  const required = [config.baseUrl, config.model, config.modelFingerprint];
  const gate = [config.gateUrl, config.gateModel, config.gateApiKey, config.gateAbstainBelow, config.gateTimeoutMs]
    .some(given);
  const supplied = gate
    || [...required, config.apiKey, config.timeoutMs, config.responseMode].some(given);
  if (!supplied)
    return { state: "disabled" };
  if (!required.every(given) || (gate && !(given(config.gateUrl) && given(config.gateModel))))
    return { state: "configured_error" };
  try {
    const capability = createHttpExtraction({
      baseUrl: config.baseUrl!,
      model: config.model!,
      modelFingerprint: config.modelFingerprint!,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      responseMode: config.responseMode as ExtractionResponseMode | undefined,
      fetch: config.fetch,
    });
    return {
      state: "enabled",
      capability: gate
        ? createHttpDecisionGate(capability, {
            url: config.gateUrl!,
            model: config.gateModel!,
            apiKey: config.gateApiKey,
            abstainBelow: config.gateAbstainBelow,
            timeoutMs: config.gateTimeoutMs,
            fetch: config.fetch,
          })
        : capability,
    };
  } catch {
    return { state: "configured_error" };
  }
}
