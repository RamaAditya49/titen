// Pooled-store variant of run.js: ONE @modelcontextprotocol/server-memory
// instance holding every distinct session, all questions searched against it.
//
// Same non-ranking as run.js: search_nodes is substring .includes(); ranked =
// matched sessions in insertion order, truncated at 10. Insertion order is the
// shared gold-first deterministic pooled order, identical to every other lane.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createReadStream, promises as fs } from "fs";
import { createInterface } from "readline";
import path from "path";

const [poolFile, questionsFile, outFile, serverPathArg, scratchDirArg] = process.argv.slice(2);
const TIMEOUT_MS = 600_000;
const scratchDir = path.resolve(scratchDirArg);
const serverPath = path.resolve(serverPathArg);

async function call(client, name, args, label) {
  const r = await withTimeout(client.callTool({ name, arguments: args }), TIMEOUT_MS, label);
  if (r.isError) throw new Error(`${name} failed: ${JSON.stringify(r.content)?.slice(0, 300)}`);
  return r;
}

const STOP = new Set(("a about after all also am an and any are as at be been before being but by can " +
  "did do does doing done for from had has have how i if in into is it its just me more most my no " +
  "not now of on or our out over own she he her him his so some such than that the their them then " +
  "there these they this those through to too under until up was we were what when where which while " +
  "who whom why will with would you your yours did what's whats").split(" "));

function keywords(question) {
  const seen = new Set();
  const out = [];
  for (const raw of question.toLowerCase().split(/[^a-z0-9']+/)) {
    const t = raw.replace(/^'+|'+$/g, "");
    if (t.length < 3 || STOP.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.length ? out : [question.toLowerCase().trim()];
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout: ${label}`)), ms); }),
  ]);
}

async function main() {
  await fs.mkdir(scratchDir, { recursive: true });
  const memPath = path.join(scratchDir, "pooled-memory.json");
  await fs.rm(memPath, { force: true });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, MEMORY_FILE_PATH: memPath },
  });
  const client = new Client({ name: "pooled-driver", version: "1.0.0" });
  await withTimeout(client.connect(transport), TIMEOUT_MS, "connect");

  // Ingest the pool in insertion order, batched.
  const rl = createInterface({ input: createReadStream(poolFile), crlfDelay: Infinity });
  const insertIndex = new Map();
  let batch = [];
  let n = 0;
  const t0 = Date.now();
  const flush = async () => {
    if (!batch.length) return;
    await call(client, "create_entities", { entities: batch }, `create_entities@${n}`);
    batch = [];
  };
  for await (const line of rl) {
    if (!line.trim()) continue;
    const { sid, text } = JSON.parse(line);
    insertIndex.set(sid, n);
    batch.push({ name: sid, entityType: "session", observations: [text] });
    n += 1;
    if (batch.length >= 20) await flush();
    if (n % 2000 === 0) console.error(`ingested ${n} (${((Date.now() - t0) / 1000) | 0}s)`);
  }
  await flush();
  const ingestSeconds = (Date.now() - t0) / 1000;
  console.error(`pool ingested: ${n} sessions in ${ingestSeconds.toFixed(1)}s`);

  const questions = JSON.parse(await fs.readFile(questionsFile, "utf8"));
  const ranked = {};
  const failures = {};
  const latencies = {};
  const t1 = Date.now();
  for (const { qid, question } of questions) {
    const q0 = process.hrtime.bigint();
    try {
      // Union of matches across all terms, ordered by pool insertion order —
      // identical to run.js's rule, applied to the pooled graph.
      const seen = new Set();
      for (const term of keywords(question)) {
        const r = await call(client, "search_nodes", { query: term }, `search@${qid}`);
        const payload = JSON.parse(r.content[0].text);
        for (const e of payload.entities ?? []) seen.add(e.name);
      }
      const order = [...seen].sort((a, b) => (insertIndex.get(a) ?? 1e9) - (insertIndex.get(b) ?? 1e9));
      ranked[qid] = order.slice(0, 10);
      if (!order.length) failures[qid] = "no matches";
    } catch (err) {
      ranked[qid] = [];
      failures[qid] = String(err).slice(0, 200);
    }
    latencies[qid] = Number(process.hrtime.bigint() - q0) / 1e6;
  }
  const querySeconds = (Date.now() - t1) / 1000;

  await fs.writeFile(outFile, JSON.stringify({
    lane: "mcp-memory", condition: "pooled",
    pool_sessions: n, ingest_seconds: ingestSeconds, query_seconds: querySeconds,
    ranked, failures, latency_ms: latencies,
  }, null, 2));
  console.error(`wrote ${outFile}`);
  await client.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
