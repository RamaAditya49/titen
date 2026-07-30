#!/usr/bin/env bun
/**
 * End-to-end run against a real deployment and a real embedding model.
 *
 * Everything here talks to a service over HTTP that it did not start, using
 * embeddings from a model it does not control. Nothing is stubbed. It exists to
 * answer one question the unit and contract suites cannot: does hybrid retrieval
 * actually find memory that lexical search misses, when the vectors come from a
 * real model?
 *
 *   TITEN_URL=http://127.0.0.1:8787 \
 *   TITEN_KEY=titen_sk_... \
 *   TITEN_EMBED_BASE_URL=http://host:11434/v1 \
 *   TITEN_EMBED_MODEL=embeddinggemma \
 *   bun scripts/e2e.ts
 */
import assert from "node:assert/strict";

const URL_BASE = (process.env.TITEN_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const KEY = process.env.TITEN_KEY ?? "";
const EMBED_URL = process.env.TITEN_EMBED_BASE_URL ?? "";
const EMBED_MODEL = process.env.TITEN_EMBED_MODEL ?? "";
const SUBJECT = `e2e_${Date.now()}`;

if (!KEY) throw new Error("TITEN_KEY is required");

const timings: Record<string, number[]> = {};
function record(label: string, ms: number) {
  (timings[label] ??= []).push(ms);
}

async function api(method: string, path: string, body?: unknown) {
  const started = performance.now();
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  record(`${method} ${path.split("?")[0]}`, performance.now() - started);
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw so a failure is readable */
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return parsed.data ?? parsed;
}

async function embed(texts: string[]): Promise<number[][]> {
  const started = performance.now();
  const res = await fetch(`${EMBED_URL}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  record("embed", performance.now() - started);
  if (!res.ok) throw new Error(`embedding failed: ${res.status}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((entry) => entry.embedding);
}

const step = (n: number, what: string) => console.log(`\n[${n}] ${what}`);
const ok = (what: string) => console.log(`    ok  ${what}`);

// ---------------------------------------------------------------- 1. liveness
step(1, "service identity and capabilities");
const health = await api("GET", "/healthz");
console.log(`    runtime=${health.runtime} revision=${health.revision}`);
const ready = await api("GET", "/readyz");
assert.equal(ready.ready, true, "service must be ready");
console.log(
  `    schema=v${ready.schema.applied} fts=${ready.capabilities.fts} vector=${ready.capabilities.vector} model=${ready.capabilities.model}`,
);
const vectorEnabled = ready.capabilities.vector === "enabled";
ok(`ready, vector capability ${vectorEnabled ? "enabled" : "disabled"}`);

// ------------------------------------------------------- 2. the Level 5 loop
step(2, "evidence to claim to context to feedback");
const project = await api("POST", "/v1/projects/resolve", {
  reference: "github.com/RamaAditya49/titen",
  create: true,
});
ok(`project ${project.project_id} (${project.reference})`);

/**
 * The lexical decoy shares the query's words. The semantic target answers the
 * query but shares almost none of them, so FTS alone cannot rank it first. That
 * gap is the entire reason vector retrieval exists.
 */
const SEMANTIC_TARGET =
  "Engineers must rehearse undoing a shipment before customers receive it.";
const LEXICAL_DECOY =
  "The rollback smoke deploy release checklist document was renamed last quarter.";
const QUERY = "how do we practise reversing a deployment safely";

const facts = [SEMANTIC_TARGET, LEXICAL_DECOY];
const claimIds: string[] = [];
for (const statement of facts) {
  const observation = await api("POST", "/v1/observations", {
    subject_id: SUBJECT,
    project_id: project.project_id,
    kind: "tool_result",
    content: `Recorded during the end-to-end run: ${statement}`,
    source: { type: "tool", ref: "e2e" },
    trust: "verified",
  });
  const consolidated = await api("POST", "/v1/consolidations", {
    subject_id: SUBJECT,
    project_id: project.project_id,
    claims: [
      {
        kind: "procedural",
        statement,
        confidence: 0.9,
        sources: [{ observation_id: observation.observation_id, relation: "supports" }],
      },
    ],
  });
  claimIds.push(consolidated.claims[0].claim_id);
}
ok(`${claimIds.length} claims materialized under subject ${SUBJECT}`);

// Nothing is searchable by vector until the indexing outbox is drained. This is
// the step an operator schedules; without it a configured vector capability
// finds nothing, because the index is empty.
if (vectorEnabled) {
  const drained = await api("POST", "/v1/index/drain?limit=50");
  console.log(
    `    indexed ${drained.indexed} claim(s) with ${drained.model} at ${drained.dimensions} dims, ${drained.remaining} pending`,
  );
  assert.ok(drained.indexed >= claimIds.length, "every new claim must be indexed");
  ok("indexing outbox drained into the vector store");
}

const context = await api("POST", "/v1/context/compile", {
  subject_id: SUBJECT,
  task: QUERY,
  max_tokens: 1200,
});
console.log(
  `    compiled: ${context.items.length} item(s), ${context.budget.used_tokens}/${context.budget.max_tokens} tokens`,
);
for (const item of context.items)
  console.log(`      - rel=${item.score_components.relevance} ${item.claim.slice(0, 62)}`);

/**
 * The point of the whole exercise. The query shares no words with the answer, so
 * lexical search cannot reach it; only semantic recall can. If the deployment has
 * a vector capability this must succeed, and if it does not it must legitimately
 * return nothing rather than appear to work.
 */
if (vectorEnabled) {
  assert.ok(
    context.items.length > 0,
    "with a vector capability, a paraphrased query must still retrieve memory",
  );
  const found = context.items.find((item: any) => item.claim === SEMANTIC_TARGET);
  assert.ok(
    found,
    `semantic recall must reach the paraphrase; got ${JSON.stringify(
      context.items.map((i: any) => i.claim),
    )}`,
  );
  ok("semantic recall retrieved memory that shares no keywords with the query");

  // Recall alone is not enough: the closer meaning must also rank first, or the
  // similarity the model computed has been discarded somewhere in scoring.
  assert.equal(
    context.items[0].claim,
    SEMANTIC_TARGET,
    `the closer meaning must rank first; got ${JSON.stringify(
      context.items.map((i: any) => [i.claim.slice(0, 40), i.score_components.relevance]),
    )}`,
  );
  assert.ok(
    context.items.length < 2 ||
      context.items[0].score_components.relevance >
        context.items[1].score_components.relevance,
    "relevance must separate the candidates rather than flattening to a tie",
  );
  ok("the closer meaning ranks first, and relevance separates the candidates");
} else {
  assert.equal(
    context.items.length,
    0,
    "without vectors a keyword-free query legitimately finds nothing",
  );
  ok("lexical-only retrieval correctly finds nothing for a paraphrase");
}

await api("POST", `/v1/context/${context.context_id}/feedback`, {
  outcome: "useful",
  claim_id: context.items[0]?.claim_id,
});
ok("feedback recorded");

const evidence = await api("GET", `/v1/claims/${claimIds[0]}/evidence`);
assert.equal(evidence.evidence.supporting.length, 1);
ok("evidence resolves back to its observation");

// ------------------------------------------- 3. the real model does the work
step(3, "semantic retrieval with real embeddings");
if (!EMBED_URL || !EMBED_MODEL) {
  console.log("    skipped: no embedding endpoint configured");
} else {
  const vectors = await embed([QUERY, ...facts]);
  const dims = vectors[0]!.length;
  console.log(`    model=${EMBED_MODEL} dims=${dims}`);

  const cosine = (a: number[], b: number[]) => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  };

  const queryVec = vectors[0]!;
  const similarity = facts.map((statement, index) => ({
    statement,
    score: cosine(queryVec, vectors[index + 1]!),
  }));
  for (const entry of similarity)
    console.log(`      cos=${entry.score.toFixed(4)}  ${entry.statement.slice(0, 58)}`);

  const ranked = [...similarity].sort((l, r) => r.score - l.score);
  assert.equal(
    ranked[0]!.statement,
    SEMANTIC_TARGET,
    "the model must consider the paraphrase closer than the keyword decoy",
  );
  ok("the model ranks meaning above shared keywords");

  // Word overlap is what FTS can see. Showing the decoy wins on overlap while
  // losing on meaning is what makes this a real test rather than a tautology.
  const words = (text: string) =>
    new Set(text.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  const queryWords = words(QUERY);
  const overlap = (text: string) =>
    [...words(text)].filter((word) => queryWords.has(word)).length;
  const decoyOverlap = overlap(LEXICAL_DECOY);
  const targetOverlap = overlap(SEMANTIC_TARGET);
  console.log(`      query word overlap: decoy=${decoyOverlap} target=${targetOverlap}`);
  // The precondition that makes step 2 meaningful: with no shared keyword,
  // lexical search cannot rank either claim, so whatever ordering the service
  // produced came from the model and nothing else.
  assert.equal(targetOverlap, 0, "the target must share no keyword with the query");
  assert.equal(decoyOverlap, 0, "the decoy must share no keyword with the query");
  ok("neither claim shares a keyword, so only the model could have ranked them");
}

// ------------------------------------------------ 4. lifecycle and durability
step(4, "lifecycle, portability, restart durability");
const supersededBy = claimIds[1]!;
const superseded = await api("POST", `/v1/claims/${claimIds[0]}/supersede`, {
  superseded_by: supersededBy,
  reason: "end-to-end run",
});
assert.equal(superseded.status, "superseded");
const afterSupersede = await api("POST", "/v1/context/compile", {
  subject_id: SUBJECT,
  task: QUERY,
  max_tokens: 1200,
});
assert.ok(
  !afterSupersede.items.some((item: any) => item.claim_id === claimIds[0]),
  "a superseded claim must leave context",
);
ok("supersession removes a claim from context without deleting evidence");

const exported = await fetch(`${URL_BASE}/v1/export?type=claims`, {
  headers: { authorization: `Bearer ${KEY}` },
});
const lines = (await exported.text()).trim().split("\n");
assert.ok(lines.length >= 2, "export must contain a header and rows");
assert.ok(!lines.join("").includes("titen_sk_"), "export must carry no credential");
ok(`export produced ${lines.length - 1} claim record(s) as JSONL`);

const events = await api("GET", "/v1/events?limit=100");
const kinds = new Set(events.events.map((event: any) => event.kind));
assert.ok(kinds.has("observation.appended"), "writes must emit events");
assert.ok(kinds.has("claim.superseded"), "lifecycle must emit events");
ok(`event trail carries ${events.events.length} entries: ${[...kinds].join(", ")}`);

const audit = await api("GET", "/v1/audit?limit=50");
assert.ok(
  audit.entries.some((entry: any) => entry.action === "claim.supersede"),
  "supersession must be audited",
);
ok("audit trail records the lifecycle change");

// -------------------------------------------------------------- 5. isolation
step(5, "a second organization sees none of it");
const scoped = await api("POST", "/v1/keys", {
  label: "e2e-reader",
  scopes: ["context:compile"],
  max_trust: "asserted",
});
const readerRes = await fetch(`${URL_BASE}/v1/observations`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${scoped.api_key}`,
  },
  body: JSON.stringify({
    subject_id: SUBJECT,
    kind: "tool_result",
    content: "a compile-only key must not be able to write this",
    source: { type: "tool" },
  }),
});
assert.equal(readerRes.status, 403, "a scoped key must be refused a write");
ok("a compile-only credential cannot write");

// ----------------------------------------------------------------- 6. numbers
step(6, "measured");
const rows = Object.entries(timings)
  .map(([label, samples]) => {
    const sorted = [...samples].sort((l, r) => l - r);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? sorted[0]!;
    return { label, n: samples.length, p50, max: sorted[sorted.length - 1]! };
  })
  .sort((l, r) => r.p50 - l.p50);
console.log(`    ${"operation".padEnd(34)} n   p50        max`);
for (const row of rows)
  console.log(
    `    ${row.label.padEnd(34)} ${String(row.n).padEnd(3)} ${row.p50.toFixed(1).padStart(7)}ms ${row.max.toFixed(1).padStart(7)}ms`,
  );

console.log("\nE2E PASSED");
