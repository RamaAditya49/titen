import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditStore, NOT_MEASURABLE, type AuditReport, type Metric } from "../../src/runtime/bun/audit";
import { openLocalStore } from "../../src/runtime/bun/mcp-stdio";

const root = mkdtempSync(join(tmpdir(), "titen-audit-"));
const cli = join(import.meta.dir, "../../src/runtime/bun/cli.ts");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const metric = (audit: AuditReport, name: Metric) => {
  const found = audit.metrics.find((entry) => entry.metric === name);
  assert.ok(found, `report is missing the ${name} metric`);
  return found;
};

/**
 * A fixture with exactly one planted exact duplicate, one planted near
 * duplicate, one planted credential, and entries that are none of those. Every
 * assertion below is an exact count, so a rule that starts over-matching fails
 * here rather than in someone else's published write-up.
 */
const PLANTED = [
  "Rotate the staging key with AKIAIOSFODNN7EXAMPLE before the release.",
  "The release branch is cut on Thursday.",
  "The release branch is cut on Thursday.",
  "the release branch is cut on thursday!",
];

test("a reference-server store reports planted duplicates and a planted secret exactly", async () => {
  const path = join(root, "memory.jsonl");
  writeFileSync(path, [
    JSON.stringify({ type: "entity", name: "deploy", entityType: "runbook", observations: PLANTED }),
    JSON.stringify({ type: "entity", name: "team", entityType: "people", observations: ["Wulan owns the ingest pipeline."] }),
    JSON.stringify({ type: "relation", from: "team", to: "deploy", relationType: "owns" }),
    "",
  ].join("\n"));

  const audit = await auditStore(path);
  assert.equal(audit.format, "reference-memory");
  assert.equal(audit.entries, 5);
  assert.equal(audit.composite_score, null);

  const exact = metric(audit, "exact_duplicate");
  assert.equal(exact.count, 1);
  assert.deepEqual(exact.findings.map((finding) => finding.entry_id), ["deploy#3"]);
  assert.match(exact.findings[0]!.evidence, /byte-identical to deploy#2/);

  const near = metric(audit, "near_duplicate");
  assert.equal(near.count, 1);
  assert.deepEqual(near.findings.map((finding) => finding.entry_id), ["deploy#4"]);

  const secret = metric(audit, "secret_pattern");
  assert.equal(secret.count, 1);
  assert.deepEqual(secret.findings.map((finding) => finding.entry_id), ["deploy#1"]);
  assert.match(secret.findings[0]!.evidence, /aws_access_key_id/);
  // The report is a file the user may hand to someone else. Quoting evidence
  // must never quote the credential the evidence is about.
  assert.ok(
    !JSON.stringify(audit).includes("AKIAIOSFODNN7EXAMPLE"),
    "the audit report must not reproduce the credential it found",
  );

  // AC-AUDIT-002: absent signals are absent, not zero, and not a failure.
  for (const name of ["recall_loop", "stale"] as const) {
    const absent = metric(audit, name);
    assert.equal(absent.measurable, false);
    assert.equal(absent.count, null, `${name} must not be reported as a count`);
    assert.equal(absent.rate, null);
    assert.ok(absent.reason?.startsWith(NOT_MEASURABLE), absent.reason);
    assert.ok(!/fail/i.test(absent.reason ?? ""), "an absent signal is never a failure");
  }
});

test("a Mem0 export is audited from the fields it does carry", async () => {
  const path = join(root, "mem0.json");
  writeFileSync(path, JSON.stringify({
    results: [
      { id: "m1", memory: "Wulan prefers dark mode.", created_at: "2026-08-01T00:00:00.000Z" },
      { id: "m2", memory: "Wulan prefers dark mode.", created_at: "2026-08-02T00:00:00.000Z" },
      { id: "m3", memory: "Deploys happen at 09:00 UTC.", created_at: "2026-08-03T00:00:00.000Z" },
    ],
  }));

  const audit = await auditStore(path);
  assert.equal(audit.format, "mem0-export");
  assert.equal(audit.entries, 3);
  assert.equal(audit.first_written_at, "2026-08-01T00:00:00.000Z");
  assert.equal(metric(audit, "exact_duplicate").count, 1);
  assert.deepEqual(metric(audit, "exact_duplicate").findings.map((f) => f.entry_id), ["m2"]);
  assert.equal(metric(audit, "near_duplicate").count, 0);
  assert.equal(metric(audit, "secret_pattern").count, 0);
  assert.equal(metric(audit, "recall_loop").measurable, false);
  assert.equal(metric(audit, "stale").measurable, false);
});

/**
 * The recall-loop metric is the one that needed the provenance work to land
 * first. A store that stamps its own recalled writes can be measured; this
 * proves the stamp reaches the audit, and that the independent text match
 * against previously served output reaches it too.
 */
test("a Titen store measures recall loop and staleness from its own signals", async () => {
  const dbPath = join(root, "store/memory.db");
  const local = await openLocalStore(dbPath);
  const call = async (path: string, body: unknown) => {
    const response = await local.app(new Request(`http://127.0.0.1${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${local.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }));
    const payload = await response.json() as { data?: Record<string, any>; error?: unknown };
    assert.ok(response.ok, `${path} failed: ${JSON.stringify(payload)}`);
    return payload.data!;
  };

  const STATEMENT = "Deployments are cut on Thursday.";
  let observed: string;
  try {
    const first = await call("/v1/observations", {
      subject_id: "audit_subject",
      kind: "user_statement",
      content: "The team agreed deployments are cut on Thursday.",
      source: { type: "chat", ref: "thread-1" },
      trust: "asserted",
    });
    observed = first.observation_id as string;
    // A second, byte-identical write with a different source ref: no source.id,
    // so Titen's canonical replay key is absent and both rows are kept.
    await call("/v1/observations", {
      subject_id: "audit_subject",
      kind: "user_statement",
      content: "The team agreed deployments are cut on Thursday.",
      source: { type: "chat", ref: "thread-2" },
      trust: "asserted",
    });
    await call("/v1/consolidations", {
      subject_id: "audit_subject",
      claims: [{
        kind: "decision",
        statement: STATEMENT,
        confidence: 0.9,
        sources: [{ observation_id: observed, relation: "supports" }],
      }],
    });
    const context = await call("/v1/context/compile", {
      subject_id: "audit_subject",
      task: "when are deployments cut",
      max_tokens: 900,
    });
    assert.ok((context.items as unknown[]).length > 0, "the pack must contain the claim just written");
    // Written back while holding the pack, with the pack's own text: both the
    // server-assigned stamp and the independent text match should fire.
    await call("/v1/observations", {
      subject_id: "audit_subject",
      kind: "tool_result",
      content: STATEMENT,
      source: { type: "agent", ref: "summary-1" },
      trust: "asserted",
      context_token: context.context_id,
    });
  } finally {
    local.close();
  }

  const audit = await auditStore(dbPath);
  assert.equal(audit.format, "titen-sqlite");
  assert.equal(audit.entries, 3);

  assert.equal(metric(audit, "exact_duplicate").count, 1);

  const recall = metric(audit, "recall_loop");
  assert.equal(recall.measurable, true);
  assert.equal(recall.count, 1);
  assert.match(recall.findings[0]!.evidence, /provenance "recalled"/);
  assert.match(recall.findings[0]!.evidence, /served at .*before this entry was written/);

  // The two originals support a claim that was served after they were written;
  // the recalled write has been served to nobody.
  const stale = metric(audit, "stale");
  assert.equal(stale.measurable, true);
  assert.equal(stale.count, 2);
  assert.ok(stale.findings.every((finding) => finding.entry_id !== observed));
});

/**
 * The offline promise is the reason this is safe to run against a private
 * store, so it is asserted rather than documented: the installed entry point
 * runs with a `fetch` that throws on any call.
 */
test("the installed CLI produces a report without touching the network", async () => {
  const preload = join(root, "no-network.ts");
  writeFileSync(preload, `
globalThis.fetch = () => {
  throw new Error("titen audit attempted a network call");
};
`);
  const child = Bun.spawn({
    cmd: ["bun", "--preload", preload, cli, "audit", join(root, "memory.jsonl"), "--json"],
    env: { PATH: process.env.PATH ?? "", HOME: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(exitCode, 0, stderr);
  const audit = JSON.parse(stdout) as AuditReport;
  assert.equal(audit.entries, 5);
  assert.equal(audit.composite_score, null);
  assert.equal(metric(audit, "exact_duplicate").count, 1);
});

test("audit refuses a file it cannot recognize instead of reporting zeros", async () => {
  const path = join(root, "notes.txt");
  writeFileSync(path, "this is not a memory store\n");
  await assert.rejects(auditStore(path), /not a Titen SQLite store/);
});
