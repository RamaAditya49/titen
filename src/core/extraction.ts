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

/** OpenRouter app attribution; other providers receive no extra headers. */
export function providerAttribution(url: string): Record<string, string> {
  const host = new URL(url).hostname;
  return host === "openrouter.ai" || host.endsWith(".openrouter.ai")
    ? { "http-referer": "https://titen.dev", "x-openrouter-title": "Titen.dev", "x-title": "Titen.dev" }
    : {};
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
      const headers: Record<string, string> = { "content-type": "application/json", ...providerAttribution(baseUrl) };
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

const LINK_CRITERIA = {
  duplicate: "Both claims state the same fact, even in different words",
  supersession: "One claim updates or replaces the other: a newer value, a changed decision, or a correction",
  conflict: "The claims contradict each other and cannot both be true",
  related: "Same topic, but each claim adds a different fact",
  none: "Different topics, or no useful connection",
} as const;
type LinkChoice = Exclude<keyof typeof LINK_CRITERIA, "none">;
const LINK_RELATION: Record<LinkChoice, string> = {
  conflict: "conflict_candidate",
  supersession: "supersession_candidate",
  duplicate: "duplicate_candidate",
  related: "related_to",
};
// Array order is link priority when a job has more candidates than slots.
const LINK_PRIORITY: LinkChoice[] = ["conflict", "supersession", "duplicate", "related"];
const GATE_DEFAULT_LINK_MIN_CONFIDENCE = 0.8;
// A false contradiction misleads more than a missed one, so it needs more certainty.
const GATE_CONFLICT_MIN_CONFIDENCE = 0.9;
const GATE_MAX_LINKS = 8;
export type DecisionGateLane = "derivation" | "reflection";

interface Premise { claim_id: string; statement: string; kind?: unknown; valid_from?: unknown; valid_to?: unknown; status?: unknown }

function premisesOf(input: unknown): Premise[] | undefined {
  const premises = (input as { premises?: unknown })?.premises;
  if (!Array.isArray(premises) || premises.length < 2 || premises.length > GATE_MAX_LINKS) return undefined;
  return premises.every((p) => typeof p?.claim_id === "string" && typeof p?.statement === "string")
    ? premises as Premise[]
    : undefined;
}

/**
 * Structured decisions in the System One wire format (TypeSafe
 * `/v1/systemone`, OpenRouter `/api/v1/systemone` or `/api/alpha/decisions`).
 * Derivation: only a confident "no" skips the generative call and becomes an
 * ordinary abstain. Reflection: confident pairwise relations become a link-only
 * proposal; claim synthesis always stays with the generative model. The gate
 * never adds claims or raises trust, and its output passes the same validator.
 */
export function createHttpDecisionGate(inner: ExtractionCapability, config: {
  url: string;
  model: string;
  apiKey?: string;
  abstainBelow?: number;
  timeoutMs?: number;
  lanes?: DecisionGateLane[];
  linkMinConfidence?: number;
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
  const lanes = new Set(config.lanes ?? ["derivation"]);
  if (!lanes.size || [...lanes].some((lane) => lane !== "derivation" && lane !== "reflection"))
    throw new Error("Decision gate lanes must be derivation, reflection, or both.");
  const linkMin = config.linkMinConfidence ?? GATE_DEFAULT_LINK_MIN_CONFIDENCE;
  if (!(linkMin >= 0.5 && linkMin < 1))
    throw new Error("Decision gate link confidence must be at least 0.5 and below 1.");
  const dispatch = config.fetch ?? fetch;

  async function ask(state: unknown, questions: Record<string, unknown>): Promise<Record<string, any>> {
    const headers: Record<string, string> = { "content-type": "application/json", ...providerAttribution(url) };
    if (config.apiKey) headers["authorization"] = `Bearer ${config.apiKey}`;
    const response = await dispatch(url, {
      method: "POST",
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model, state, questions }),
    });
    if (!response.ok || Number(response.headers.get("content-length") ?? "0") > MAX_PROVIDER_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("gate_rejected");
    }
    const answers = (JSON.parse(await boundedResponseText(response)) as any)?.answers;
    if (!answers || typeof answers !== "object") throw new Error("gate_protocol");
    return answers;
  }

  async function probabilityYes(state: unknown): Promise<number> {
    const yes = (await ask(state, { durable: GATE_QUESTION }))["durable"]?.noul;
    if (typeof yes !== "number" || !(yes >= 0 && yes <= 1)) throw new Error("gate_protocol");
    return yes;
  }

  async function reflectionLinks(premises: Premise[]) {
    const state: Record<string, unknown> = {};
    premises.forEach(({ kind, statement, valid_from, valid_to, status }, index) => {
      state[`P${index + 1}`] = { kind, statement, valid_from, valid_to, status };
    });
    const pairs: Array<[number, number]> = [];
    const questions: Record<string, unknown> = {};
    for (let a = 0; a < premises.length; a += 1) for (let b = a + 1; b < premises.length; b += 1) {
      pairs.push([a, b]);
      questions[`pair_${a + 1}_${b + 1}`] = {
        type: "choice",
        instructions: `How does claim \`P${a + 1}\` relate to claim \`P${b + 1}\`?`,
        criteria: LINK_CRITERIA,
      };
    }
    const answers = await ask(state, questions);
    const candidates = pairs.flatMap(([a, b]) => {
      const answer = answers[`pair_${a + 1}_${b + 1}`];
      const choice = answer?.choice as LinkChoice;
      const confidence = answer?.confidence;
      if (!LINK_PRIORITY.includes(choice) || typeof confidence !== "number") return [];
      if (confidence < Math.max(linkMin, choice === "conflict" ? GATE_CONFLICT_MIN_CONFIDENCE : 0)) return [];
      let [source, target] = [premises[a]!, premises[b]!];
      if (choice === "supersession") {
        // Code, not the model, orders supersession: the newer claim is the source.
        const [first, second] = [String(source.valid_from ?? ""), String(target.valid_from ?? "")];
        if (!first || !second || first === second) return [];
        if (first < second) [source, target] = [target, source];
      }
      return [{ choice, confidence, source: source.claim_id, target: target.claim_id }];
    });
    return candidates
      .sort((x, y) => LINK_PRIORITY.indexOf(x.choice) - LINK_PRIORITY.indexOf(y.choice) || y.confidence - x.confidence)
      .slice(0, GATE_MAX_LINKS)
      .map((link) => ({
        source_claim_id: link.source,
        target_claim_id: link.target,
        relation: LINK_RELATION[link.choice],
      }));
  }

  return {
    modelId: inner.modelId,
    modelFingerprint: inner.modelFingerprint,
    ...(inner.responseMode === undefined ? {} : { responseMode: inner.responseMode }),
    // Folded into the job model fingerprint, so gate changes re-key the pipeline.
    providerIdentity: `${inner.providerIdentity ?? "native"} gate=${url}#${model}<${abstainBelow}`
      + ` lanes=${[...lanes].sort().join(",")} links>=${linkMin}`,
    async generate(request) {
      // ponytail: any gate failure falls through to the generative call; an
      // optional cost optimization never stalls or drops enrichment.
      if (request.lane === "derivation" && lanes.has("derivation")) {
        const yes = await probabilityYes(request.input).catch(() => undefined);
        if (yes !== undefined && yes < abstainBelow) return { action: "abstain", claims: null };
      }
      const premises = request.lane === "reflection" && lanes.has("reflection")
        ? premisesOf(request.input)
        : undefined;
      if (premises) {
        const links = await reflectionLinks(premises).catch(() => undefined);
        if (links?.length) return { action: "link", claims: null, links };
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
  gateLanes?: string;
  gateLinkMinConfidence?: number;
  fetch?: typeof fetch;
}): { capability?: ExtractionCapability; state: ExtractionConfigurationState } {
  const given = (value: unknown) => value !== undefined && value !== "";
  const required = [config.baseUrl, config.model, config.modelFingerprint];
  const gate = [config.gateUrl, config.gateModel, config.gateApiKey, config.gateAbstainBelow, config.gateTimeoutMs,
    config.gateLanes, config.gateLinkMinConfidence]
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
            lanes: config.gateLanes === undefined
              ? undefined
              : config.gateLanes.split(",").map((lane) => lane.trim()) as DecisionGateLane[],
            linkMinConfidence: config.gateLinkMinConfidence,
            fetch: config.fetch,
          })
        : capability,
    };
  } catch {
    return { state: "configured_error" };
  }
}
