/**
 * `titen audit` — an offline write-hygiene audit of an agent memory store.
 *
 * Every published agent-memory benchmark measures retrieval on a tidy corpus.
 * The failure people actually report is on the write side: a store that fills
 * with copies of itself until it is worth less than no memory at all. This
 * measures that, on stores Titen does not own, with per-item evidence a skeptic
 * can check by hand.
 *
 * Three constraints are load-bearing and not negotiable:
 *
 * 1. **Nothing leaves the machine.** No network, no model, no upload. This file
 *    imports a SQLite opener and a JSON parser and nothing else, so the promise
 *    is checkable by reading the import list. The report goes to stdout; the
 *    user decides whether it is ever shared.
 * 2. **A missing signal is reported as missing.** A store that records no
 *    provenance cannot have its recall-loop rate measured, and saying "0" there
 *    would be a lie that flatters the store. It is reported as
 *    "not measurable from this export" (AC-AUDIT-002).
 * 3. **No composite score, no ranking.** Five counts, published separately,
 *    with the detection rule beside each one. A single number would turn an
 *    instrument into a weapon and would be dismissed as vendor FUD on sight.
 */
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { sha256Hex } from "../../core/ids";
import { parseReferenceGraph } from "../../core/portability";
import { RECALLED_SOURCE_TYPE } from "../../core/validate";
import { TITEN_VERSION } from "../../core/version";
import { openDatabase } from "./sqlite";

export const METRICS = [
  "exact_duplicate",
  "near_duplicate",
  "recall_loop",
  "secret_pattern",
  "stale",
] as const;
export type Metric = (typeof METRICS)[number];

export type Format = "titen-sqlite" | "reference-memory" | "mem0-export";

const FORMAT_LABELS: Record<Format, string> = {
  "titen-sqlite": "Titen store (SQLite)",
  "reference-memory": "@modelcontextprotocol/server-memory store",
  "mem0-export": "Mem0 export",
};

export interface AuditEntry {
  /** A locator the reader can find in the original store by hand. */
  id: string;
  text: string;
  /** When the store says the entry was written, when it says at all. */
  writtenAt?: string;
  /** Store-assigned provenance, when the store assigns any. */
  sourceType?: string;
  /** When the entry was last served back after it was written. */
  recalledAt?: string;
}

export interface Store {
  format: Format;
  entries: AuditEntry[];
  /** Which signals the export carries at all. Absence is never a failure. */
  signals: { provenance: boolean; retrieval: boolean };
  /**
   * Canonical text of everything the store served back, mapped to the first
   * time it was served. Present only where a store records what it returned.
   */
  served: Map<string, string>;
}

export interface Finding {
  entry_id: string;
  evidence: string;
}

export interface MetricReport {
  metric: Metric;
  measurable: boolean;
  /** The published detection rule, verbatim, beside the number it produced. */
  rule: string;
  /** Why the number is absent. Never "fail", never folded into a score. */
  reason?: string;
  count: number | null;
  rate: number | null;
  findings: Finding[];
}

export interface AuditReport {
  tool: "titen audit";
  titen_version: string;
  path: string;
  format: Format;
  entries: number;
  first_written_at: string | null;
  last_written_at: string | null;
  metrics: MetricReport[];
  /**
   * Explicitly null, and machine-readable as such: these five counts measure
   * different things and are never combined into one number or a ranking.
   */
  composite_score: null;
}

export const NOT_MEASURABLE = "not measurable from this export";

// --- Detection rules, published in docs/reference/audit.md ---

/**
 * Canonical form used by the near-duplicate rule: Unicode NFKC, lowercased,
 * with every run of non-letter/non-digit characters collapsed to one space.
 * Two entries share a canonical hash when they differ only in case, spacing,
 * or punctuation.
 *
 * Deliberately not Titen's `observations.canonical_hash` column, which mixes in
 * the actor, subject, project and provenance and is therefore a replay key
 * rather than a duplicate detector: two agents writing the same sentence get
 * different canonical hashes there, by design.
 *
 * Known ceiling, accepted deliberately: exact match after canonicalization, not
 * an embedding or a shingle-similarity score, so paraphrase is invisible and the
 * count is a floor. It is the only rule a reader can re-derive with `tr` and
 * `sort -u`, and a threshold nobody can reproduce would sink the whole
 * instrument. If it proves too tight, publish a second, clearly separate metric
 * rather than loosening this one.
 */
export function canonicalText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

interface SecretRule {
  name: string;
  pattern: RegExp;
  /** Rules that trade precision for coverage are named so a reader can discount them. */
  precision: "high" | "low";
}

/**
 * A small set of high-signal patterns for credential shapes that are unusable
 * once rotated, plus one deliberately looser rule for the most common real
 * case: an agent told a password in prose. Per-rule counts are always reported,
 * so the loose rule can be discounted by anyone who disagrees with it.
 */
export const SECRET_RULES: readonly SecretRule[] = [
  { name: "aws_access_key_id", pattern: /\bAKIA[0-9A-Z]{16}\b/g, precision: "high" },
  { name: "private_key_block", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g, precision: "high" },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, precision: "high" },
  { name: "slack_token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, precision: "high" },
  { name: "google_api_key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, precision: "high" },
  { name: "openai_style_key", pattern: /\bsk-(?:[A-Za-z0-9]+-)?[A-Za-z0-9_-]{20,}\b/g, precision: "high" },
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    precision: "high",
  },
  { name: "url_basic_auth", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi, precision: "high" },
  {
    name: "assigned_credential",
    pattern:
      /\b(?:pass(?:word|wd)?|secret|api[_-]?key|access[_-]?token|token)\b\s*(?:[:=]|\bis\b)\s*["']?([^\s"',;]{8,})/gi,
    precision: "low",
  },
];

/** Keeps a candidate credential out of a report the user may hand to someone else. */
function mask(value: string): string {
  return `${value.slice(0, 4)}…(${value.length} chars)`;
}

interface SecretHit {
  rule: SecretRule;
  offset: number;
  masked: string;
}

export function secretHits(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const rule of SECRET_RULES)
    for (const match of text.matchAll(rule.pattern))
      hits.push({
        rule,
        offset: match.index ?? 0,
        masked: mask(match[1] ?? match[0]),
      });
  return hits.sort((left, right) => left.offset - right.offset);
}

/**
 * Quoting memory content back at the reader is the whole point of per-item
 * evidence, so it is masked on the way out: a duplicate that happens to contain
 * a credential must not leak it through the duplicate finding.
 */
function excerpt(text: string, limit = 100): string {
  let masked = text;
  for (const rule of SECRET_RULES)
    // `replace` passes the offset where a pattern has no capture group, so the
    // group is taken only when it really is one.
    masked = masked.replace(rule.pattern, (match: string, ...rest: unknown[]) =>
      typeof rest[0] === "string" ? match.replace(rest[0], mask(rest[0])) : mask(match));
  const flat = masked.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

// --- Readers ---

const SQLITE_MAGIC = "SQLite format 3\0";

export function detectFormat(path: string): Format {
  const handle = openSync(path, "r");
  try {
    const header = new Uint8Array(16);
    const read = readSync(handle, header, 0, 16, 0);
    if (read === 16 && new TextDecoder("latin1").decode(header) === SQLITE_MAGIC)
      return "titen-sqlite";
  } finally {
    closeSync(handle);
  }
  const text = readFileSync(path, "utf8");
  const first = text.split("\n").find((line) => line.trim());
  if (first !== undefined) {
    try {
      const parsed: unknown = JSON.parse(first);
      const type = (parsed as { type?: unknown } | null)?.type;
      if (type === "entity" || type === "relation") return "reference-memory";
    } catch {
      // Not a single-line JSON document; fall through to the whole-file parse.
    }
    try {
      JSON.parse(text);
      return "mem0-export";
    } catch {
      // Neither shape.
    }
  }
  throw new Error(
    `${path} is not a Titen SQLite store, a reference-server memory.json(l), or a Mem0 export`,
  );
}

/** A fresh object per store: a shared default map is a bug waiting for a writer. */
const textOnly = () => ({
  signals: { provenance: false, retrieval: false },
  served: new Map<string, string>(),
});

function readReferenceStore(path: string): Store {
  const graph = parseReferenceGraph(readFileSync(path, "utf8"));
  return {
    ...textOnly(),
    format: "reference-memory",
    // Relations carry no free text of their own and are structure rather than
    // entries; only observations are audited, and the count says so.
    entries: graph.entities.flatMap((entity) =>
      entity.observations.map((text, index) => ({ id: `${entity.name}#${index + 1}`, text }))),
  };
}

const stringField = (row: Record<string, unknown>, ...names: string[]): string | undefined => {
  for (const name of names) if (typeof row[name] === "string" && row[name]) return row[name] as string;
  return undefined;
};

/** Mem0 exports appear as a bare array, `{results}`, `{memories}`, or `{data:{results}}`. */
function mem0Records(value: unknown): Record<string, unknown>[] {
  const candidates: unknown[] = [value];
  const root = value as Record<string, unknown> | null;
  if (root && typeof root === "object")
    candidates.push(root.results, root.memories, root.data,
      (root.data as Record<string, unknown> | undefined)?.results);
  for (const candidate of candidates)
    if (Array.isArray(candidate))
      return candidate.filter((row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object" && !Array.isArray(row));
  return [];
}

function readMem0Store(path: string): Store {
  const records = mem0Records(JSON.parse(readFileSync(path, "utf8")));
  const entries: AuditEntry[] = [];
  for (const [index, record] of records.entries()) {
    const text = stringField(record, "memory", "content", "text");
    if (text === undefined) continue;
    const writtenAt = stringField(record, "created_at", "createdAt");
    entries.push({
      id: stringField(record, "id") ?? `record#${index + 1}`,
      text,
      ...(writtenAt ? { writtenAt } : {}),
    });
  }
  return { ...textOnly(), format: "mem0-export", entries };
}

interface TitenRow {
  id: string;
  text: string;
  source_type: string;
  written_at: string;
  recalled_at: string | null;
}

/**
 * Reads a Titen store, strictly read-only: an audit that mutates the store it
 * measures is not an audit. Observations are the audited entries because this
 * measures the write path, and because they are where Titen's own provenance
 * stamp lives.
 *
 * An observation counts as recalled when a claim it supports appeared in a
 * context pack compiled after the observation was written. Direct evidence
 * reads are not logged per record, so the stale count is an upper bound and the
 * reference doc says so.
 */
function readTitenStore(path: string): Store {
  const database = openDatabase(path, { create: false, readonly: true });
  try {
    let rows: TitenRow[];
    try {
      rows = database.query(
        `SELECT o.id AS id, o.content AS text, o.source_type AS source_type,
                o.ingested_at AS written_at,
                (SELECT MAX(r.created_at)
                   FROM claim_sources s
                   JOIN context_run_items i ON i.claim_id = s.claim_id
                   JOIN context_runs r ON r.id = i.context_id
                  WHERE s.observation_id = o.id AND r.created_at > o.ingested_at) AS recalled_at
           FROM observations o
          ORDER BY o.ingested_at, o.id`,
      ).all() as TitenRow[];
    } catch (error) {
      throw new Error(
        `${path} is a SQLite database but not a Titen store: ${
          error instanceof Error ? error.message : "unreadable"
        }`,
      );
    }
    const served = new Map<string, string>();
    for (const row of database.query(
      `SELECT c.statement AS statement, MIN(r.created_at) AS served_at
         FROM context_run_items i
         JOIN context_runs r ON r.id = i.context_id
         JOIN claims c ON c.id = i.claim_id
        GROUP BY c.id`,
    ).all() as { statement: string; served_at: string }[]) {
      const key = canonicalText(row.statement);
      const earliest = served.get(key);
      if (earliest === undefined || row.served_at < earliest) served.set(key, row.served_at);
    }
    return {
      format: "titen-sqlite",
      signals: { provenance: true, retrieval: true },
      served,
      entries: rows.map((row) => ({
        id: row.id,
        text: row.text,
        writtenAt: row.written_at,
        sourceType: row.source_type,
        ...(row.recalled_at ? { recalledAt: row.recalled_at } : {}),
      })),
    };
  } finally {
    database.close();
  }
}

export function readStore(path: string): Store {
  const format = detectFormat(path);
  if (format === "titen-sqlite") return readTitenStore(path);
  if (format === "mem0-export") return readMem0Store(path);
  return readReferenceStore(path);
}

// --- Metrics ---

const RULES: Record<Metric, string> = {
  exact_duplicate: "byte-identical entry text; a group of N copies counts N-1 redundant entries",
  near_duplicate:
    "identical after NFKC + lowercase + non-alphanumeric collapse, but not byte-identical",
  recall_loop:
    "provenance the store itself assigned as recalled, or entry text canonically equal to something the store served back before the entry was written",
  secret_pattern: `entry matching any of ${SECRET_RULES.length} published credential patterns`,
  stale: "no recorded retrieval of the entry after it was written",
};

const groupBy = (entries: AuditEntry[], key: (entry: AuditEntry) => string) => {
  const groups = new Map<string, AuditEntry[]>();
  for (const entry of entries) {
    const group = groups.get(key(entry));
    if (group) group.push(entry);
    else groups.set(key(entry), [entry]);
  }
  return groups;
};

const shortHash = async (value: string) => (await sha256Hex(value)).slice(0, 8);

function report(
  metric: Metric,
  entries: number,
  findings: Finding[],
  count = findings.length,
): MetricReport {
  return {
    metric,
    measurable: true,
    rule: RULES[metric],
    count,
    rate: entries ? count / entries : null,
    findings,
  };
}

function unmeasurable(metric: Metric, reason: string): MetricReport {
  return {
    metric,
    measurable: false,
    rule: RULES[metric],
    reason: `${NOT_MEASURABLE}: ${reason}`,
    count: null,
    rate: null,
    findings: [],
  };
}

export async function analyze(store: Store): Promise<MetricReport[]> {
  const { entries } = store;
  const total = entries.length;

  const exact: Finding[] = [];
  for (const group of groupBy(entries, (entry) => entry.text).values()) {
    if (group.length < 2) continue;
    const digest = await shortHash(group[0]!.text);
    for (const duplicate of group.slice(1))
      exact.push({
        entry_id: duplicate.id,
        evidence: `byte-identical to ${group[0]!.id} (group ${digest}): "${excerpt(duplicate.text)}"`,
      });
  }

  const near: Finding[] = [];
  for (const group of groupBy(entries, (entry) => canonicalText(entry.text)).values()) {
    if (group.length < 2) continue;
    // Keep the first occurrence of each distinct text: the finding names the
    // entry a reader would keep, not whichever copy happened to be scanned last.
    const byText = new Map<string, AuditEntry>();
    for (const entry of group) if (!byText.has(entry.text)) byText.set(entry.text, entry);
    const distinct = [...byText.values()];
    if (distinct.length < 2) continue;
    const digest = await shortHash(canonicalText(group[0]!.text));
    for (const duplicate of distinct.slice(1))
      near.push({
        entry_id: duplicate.id,
        evidence: `canonically equal to ${distinct[0]!.id} (group ${digest}): "${
          excerpt(distinct[0]!.text)
        }" vs "${excerpt(duplicate.text)}"`,
      });
  }

  const secrets: Finding[] = [];
  const perRule = new Map<string, number>();
  for (const entry of entries) {
    const hits = secretHits(entry.text);
    if (!hits.length) continue;
    for (const name of new Set(hits.map((hit) => hit.rule.name)))
      perRule.set(name, (perRule.get(name) ?? 0) + 1);
    secrets.push({
      entry_id: entry.id,
      evidence: hits
        .map((hit) => `${hit.rule.name}${hit.rule.precision === "low" ? " (low precision)" : ""} at offset ${hit.offset}: ${hit.masked}`)
        .join("; "),
    });
  }
  const secretReport = report("secret_pattern", total, secrets);
  if (perRule.size)
    secretReport.rule = `${RULES.secret_pattern} — matched: ${
      [...perRule].map(([name, count]) => `${name} ${count}`).join(", ")
    }`;

  const recall = store.signals.provenance || store.signals.retrieval
    ? report("recall_loop", total, entries.flatMap((entry) => {
        const reasons: string[] = [];
        if (entry.sourceType === RECALLED_SOURCE_TYPE)
          reasons.push(`store-assigned provenance "${RECALLED_SOURCE_TYPE}"`);
        const servedAt = store.served.get(canonicalText(entry.text));
        if (servedAt !== undefined && entry.writtenAt !== undefined && servedAt < entry.writtenAt)
          reasons.push(`canonically equal to output served at ${servedAt}, before this entry was written at ${entry.writtenAt}`);
        return reasons.length
          ? [{ entry_id: entry.id, evidence: `${reasons.join("; ")}: "${excerpt(entry.text)}"` }]
          : [];
      }))
    : unmeasurable(
        "recall_loop",
        "it records neither who assigned an entry's provenance nor what the store previously returned",
      );

  const stale = store.signals.retrieval
    ? report("stale", total, entries.flatMap((entry) => entry.recalledAt === undefined
        ? [{
            entry_id: entry.id,
            evidence: `never served after it was written${
              entry.writtenAt ? ` at ${entry.writtenAt}` : ""
            }: "${excerpt(entry.text)}"`,
          }]
        : []))
    : unmeasurable("stale", "it records no retrieval history, so no entry can be shown to have been read back");

  return [
    report("exact_duplicate", total, exact),
    report("near_duplicate", total, near),
    recall,
    secretReport,
    stale,
  ];
}

export async function auditStore(path: string): Promise<AuditReport> {
  const store = readStore(path);
  const written = store.entries
    .map((entry) => entry.writtenAt)
    .filter((value): value is string => typeof value === "string")
    .sort();
  return {
    tool: "titen audit",
    titen_version: TITEN_VERSION,
    path,
    format: store.format,
    entries: store.entries.length,
    first_written_at: written[0] ?? null,
    last_written_at: written.at(-1) ?? null,
    metrics: await analyze(store),
    composite_score: null,
  };
}

// --- Rendering ---

const LABELS: Record<Metric, string> = {
  exact_duplicate: "exact duplicate",
  near_duplicate: "near duplicate",
  recall_loop: "recall loop",
  secret_pattern: "secret pattern",
  stale: "stale",
};

const EVIDENCE_SHOWN = 10;

export function renderReport(audit: AuditReport): string {
  const lines = [
    `titen audit ${audit.titen_version}`,
    `input:   ${audit.path}`,
    `format:  ${FORMAT_LABELS[audit.format]}`,
    `entries: ${audit.entries}`,
  ];
  if (audit.first_written_at)
    lines.push(`written: ${audit.first_written_at} .. ${audit.last_written_at}`);
  lines.push("", "metric                count   rate      rule");
  for (const metric of audit.metrics) {
    const label = LABELS[metric.metric].padEnd(20);
    if (!metric.measurable) {
      lines.push(`${label}      -       -   ${metric.reason}`);
      continue;
    }
    const rate = metric.rate === null ? "-" : `${(metric.rate * 100).toFixed(1)}%`;
    lines.push(`${label} ${String(metric.count).padStart(6)} ${rate.padStart(7)}   ${metric.rule}`);
  }
  lines.push(
    "",
    "These five counts measure different things, are reported separately, and are",
    "never combined. Titen publishes no composite score and no ranking from them.",
    "Detection rules: docs/reference/audit.md",
  );
  for (const metric of audit.metrics) {
    if (!metric.findings.length) continue;
    lines.push("", `${LABELS[metric.metric]} — ${metric.findings.length} finding${
      metric.findings.length === 1 ? "" : "s"
    }`);
    for (const finding of metric.findings.slice(0, EVIDENCE_SHOWN))
      lines.push(`  ${finding.entry_id}  ${finding.evidence}`);
    if (metric.findings.length > EVIDENCE_SHOWN)
      lines.push(`  ... ${metric.findings.length - EVIDENCE_SHOWN} more (use --json for every item)`);
  }
  return lines.join("\n");
}
