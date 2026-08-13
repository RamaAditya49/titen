import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  basename,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { createApp } from "../../core/app";
import { canonicalJson } from "../../core/idempotency";
import { sha256Hex } from "../../core/ids";
import { schemaState } from "../../core/migrations";
import type { Visibility } from "../../core/validate";
import { TitenClient, type ObservationRecord } from "../../sdk";
import { mem0Envelope, secretHits } from "./audit";
import { createSqliteDb, openDatabase } from "./sqlite";

export const SOURCE_IMPORT_PROFILE_IDS = [
  "mem0-json@1",
  "openclaw-memory@1",
  "hermes-memory@1",
  "claude-code-memory@1",
  "codex-memory@1",
  "gemini-cli-memory@1",
  "qwen-code-memory@1",
  "byterover-context@1",
  "amazon-q-memory@1",
  "replit-memory@1",
  "honcho-conclusions@1",
  "letta-agentfile@1",
  "memomind-json@1",
  "agent-rules@1",
  "basic-memory@1",
  "markdown@1",
] as const;

export type SourceImportProfile = (typeof SOURCE_IMPORT_PROFILE_IDS)[number];

const MAX_SELECTED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_CLAIM_CHARS = 4_000;
const UNSAFE_TEXT = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

type ParserFamily = "markdown" | "records" | "honcho" | "agentfile";
type ClaimKind = "semantic_fact" | "procedural";

type Profile = {
  parser: ParserFamily;
  input: "file" | "directory" | "either";
  include: (relativePath: string, rootName: string, directFile: boolean) => boolean;
  descend?: (relativeDirectory: string) => boolean;
  records?: "mem0" | "memomind";
};

const pathParts = (value: string) => value.split("/").filter(Boolean);
const hiddenPath = (value: string) => pathParts(value).some((part) => part.startsWith("."));
const markdown = (value: string) => value.endsWith(".md");

function agentRulePath(value: string, rootName: string, directFile: boolean): boolean {
  const lower = value.toLowerCase();
  const file = basename(value);
  if (file === "AGENTS.md") return true;
  if (["CLAUDE.md", "GEMINI.md", "QWEN.md", ".cursorrules", ".windsurfrules"].includes(file))
    return true;
  if (["agents.md", "claude.md", "qodo.md", ".augment-guidelines"].includes(lower)) return true;
  if (lower === ".claude/claude.md" || lower === ".qwen/qwen.local.md") return true;
  if (lower === "copilot-instructions.md" || lower === "user-guidelines.md")
    return directFile || [".copilot", ".augment"].includes(rootName);
  if (lower === "custom_instruction/instructions.md") return true;
  if (/^\.agents\/rules\/.+\.md$/u.test(lower)) return true;
  if (/^\.cursor\/rules\/.+\.mdc$/u.test(lower)) return true;
  if (/^\.windsurf\/rules\/.+\.md$/u.test(lower)) return true;
  if (/^\.github\/instructions\/.+\.instructions\.md$/u.test(lower)) return true;
  if (lower === ".github/copilot-instructions.md") return true;
  if (/^instructions\/.+\.instructions\.md$/u.test(lower) && rootName === ".copilot") return true;
  if (/^\.clinerules\/.+\.(?:md|txt)$/u.test(lower)) return true;
  if (/^\.kiro\/steering\/.+\.md$/u.test(lower)) return true;
  if (/^\.continue\/rules\/.+\.md$/u.test(lower)) return true;
  if (lower === ".junie/agents.md" || lower === ".junie/guidelines.md") return true;
  if (/^\.junie\/guidelines\/.+\.md$/u.test(lower)) return true;
  if (/^\.augment\/rules\/.+\.(?:md|mdx)$/u.test(lower)) return true;
  if (/^\.amazonq\/rules\/(?!memory-bank\/).+\.md$/u.test(lower)) return true;
  return ["steering", ".clinerules", "rules", "guidelines"].includes(rootName)
    && (lower.endsWith(".md") || lower.endsWith(".mdx") || lower.endsWith(".txt"));
}

export const SOURCE_IMPORT_PROFILES: Readonly<Record<SourceImportProfile, Profile>> = {
  "mem0-json@1": {
    parser: "records", input: "file", records: "mem0",
    include: (path) => path.endsWith(".json"),
  },
  "openclaw-memory@1": {
    parser: "markdown", input: "directory",
    include: (path) => path === "USER.md" || path === "MEMORY.md"
      || /^memory\/\d{4}-\d{2}-\d{2}(?:-[A-Za-z0-9_-]+)?\.md$/u.test(path),
    descend: (path) => path === "memory",
  },
  "hermes-memory@1": {
    parser: "markdown", input: "directory",
    include: (path) => path === "MEMORY.md" || path === "USER.md",
    descend: () => false,
  },
  "claude-code-memory@1": {
    parser: "markdown", input: "directory",
    include: (path) => markdown(path) && !hiddenPath(path),
  },
  "codex-memory@1": {
    parser: "markdown", input: "directory",
    include: (path) => path === "MEMORY.md" || path === "memory_summary.md",
    descend: () => false,
  },
  "gemini-cli-memory@1": {
    parser: "markdown", input: "directory",
    include: (path) => {
      const parts = pathParts(path.toLowerCase());
      return markdown(path)
        && basename(path) !== "SKILL.md"
        && basename(path) !== "GEMINI.md"
        && !parts.some((part) => ["inbox", "chats", "chat", "sessions", "session"].includes(part))
        && !hiddenPath(path);
    },
  },
  "qwen-code-memory@1": {
    parser: "markdown", input: "directory",
    include: (path) => (
      (!path.includes("/") && markdown(path) && !["MEMORY.md", "QWEN.md"].includes(path))
      || /^pinned\/.+\.md$/u.test(path)
    ) && !hiddenPath(path),
    descend: (path) => path === "pinned" || path.startsWith("pinned/"),
  },
  "byterover-context@1": {
    parser: "markdown", input: "directory",
    include: (path) => markdown(path)
      && !pathParts(path).includes("_archived")
      && !["_index.md", "context.md"].includes(basename(path))
      && !path.endsWith(".abstract.md")
      && !path.endsWith(".overview.md"),
    descend: (path) => !pathParts(path).includes("_archived"),
  },
  "amazon-q-memory@1": {
    parser: "markdown", input: "directory",
    include: (path) => ["product.md", "structure.md", "tech.md", "guidelines.md"].includes(path),
    descend: () => false,
  },
  "replit-memory@1": {
    parser: "markdown", input: "file",
    include: (path) => basename(path) === "replit.md",
  },
  "honcho-conclusions@1": {
    parser: "honcho", input: "either",
    include: (path) => path.endsWith(".json"),
  },
  "letta-agentfile@1": {
    parser: "agentfile", input: "file",
    include: (path) => path.endsWith(".af"),
  },
  "memomind-json@1": {
    parser: "records", input: "file", records: "memomind",
    include: (path) => path.endsWith(".json"),
  },
  "agent-rules@1": {
    parser: "markdown", input: "either",
    include: agentRulePath,
    descend: (path) => !pathParts(path).some((part) => [
      ".git", "node_modules", "dist", "build", "coverage", "workflows", "prompts", "commands", "skills",
    ].includes(part.toLowerCase())),
  },
  "basic-memory@1": {
    parser: "markdown", input: "directory",
    include: (path) => markdown(path) && !hiddenPath(path),
    descend: (path) => !hiddenPath(path),
  },
  "markdown@1": {
    parser: "markdown", input: "file",
    include: (path) => path.endsWith(".md"),
  },
};

type SelectedFile = { path: string; locator: string; bytes: number; text: string };
type RawEntry = {
  locator: string;
  identity: string;
  provenance: string;
  content: string;
  occurredAt: string | null;
  kind: ClaimKind;
};

export type PreparedSourceEntry = RawEntry & {
  sourceId: string;
  sourceRef: string;
  contentHash: string;
};

export interface SourceImportPreview {
  profile: SourceImportProfile;
  subject_id: string;
  project_reference: string | null;
  workspace_id: string | null;
  visibility: Visibility;
  trust: "unverified" | "asserted";
  import_run_id: string;
  selected_files: Array<{ locator: string; bytes: number }>;
  skipped_files: number;
  selected_bytes: number;
  entries: number;
  duplicate_entries: number;
  items: Array<{
    locator: string;
    source_ref: string;
    source_id: string;
    content_sha256: string;
    characters: number;
    claim_kind: ClaimKind;
    occurred_at: string | null;
  }>;
}

export interface PreparedSourceImport {
  preview: SourceImportPreview;
  entries: PreparedSourceEntry[];
}

export interface PrepareSourceImportOptions {
  path: string;
  profile: string;
  subject: string;
  project?: string;
  workspaceId?: string;
  visibility?: string;
  trust?: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function safeText(value: string, locator: string): string {
  if (!value.isWellFormed()) fail(`${locator} contains malformed Unicode`);
  if (UNSAFE_TEXT.test(value)) fail(`${locator} contains an unsafe Unicode control character`);
  return value;
}

function timestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "") fail(`${field} must be a non-empty timestamp string`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`${field} must be a valid timestamp`);
  return parsed.toISOString();
}

function assertNoSymlinkComponents(path: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const component of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, component);
    if (lstatSync(current).isSymbolicLink()) fail(`source path may not contain a symlink: ${current}`);
  }
}

function selectFiles(input: string, profileId: SourceImportProfile): {
  files: Array<{ path: string; locator: string; bytes: number }>;
  skipped: number;
} {
  assertNoSymlinkComponents(input);
  const absolute = resolve(input);
  const stat = statSync(absolute);
  const profile = SOURCE_IMPORT_PROFILES[profileId];
  const rootName = basename(absolute).toLowerCase();
  if (stat.isFile()) {
    if (profile.input === "directory") fail(`${profileId} requires a directory`);
    const locator = basename(absolute);
    if (!profile.include(locator, rootName, true)) fail(`${locator} is not allowed by ${profileId}`);
    return { files: [{ path: absolute, locator, bytes: stat.size }], skipped: 0 };
  }
  if (!stat.isDirectory()) fail(`source must be a regular file or directory: ${absolute}`);
  if (profile.input === "file") fail(`${profileId} requires one explicit file`);

  const files: Array<{ path: string; locator: string; bytes: number }> = [];
  let skipped = 0;
  const walk = (directory: string, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const locator = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`source path may not contain a symlink: ${path}`);
      if (entry.isDirectory()) {
        if (profile.descend?.(locator) === false) continue;
        walk(path, locator);
        continue;
      }
      if (!entry.isFile()) {
        skipped += 1;
        continue;
      }
      if (!profile.include(locator, rootName, false)) {
        skipped += 1;
        continue;
      }
      files.push({ path, locator, bytes: statSync(path).size });
    }
  };
  walk(absolute);
  files.sort((a, b) => a.locator.localeCompare(b.locator));
  if (files.length === 0) fail(`${profileId} found no allowlisted memory files`);
  return { files, skipped };
}

function readSelectedFiles(input: string, profileId: SourceImportProfile): {
  files: SelectedFile[];
  skipped: number;
  bytes: number;
} {
  const selected = selectFiles(input, profileId);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  const files = selected.files.map((file) => {
    assertNoSymlinkComponents(file.path);
    let descriptor: number;
    try {
      descriptor = openSync(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      fail(`${file.locator} must remain a regular non-symlink file`);
    }
    let bytes: Uint8Array;
    try {
      const current = fstatSync(descriptor!);
      if (!current.isFile()) fail(`${file.locator} must remain a regular file`);
      if (total + current.size > MAX_SELECTED_BYTES)
        fail(`selected source exceeds ${MAX_SELECTED_BYTES} bytes`);
      bytes = readFileSync(descriptor!);
    } finally {
      closeSync(descriptor!);
    }
    total += bytes!.byteLength;
    if (total > MAX_SELECTED_BYTES)
      fail(`selected source exceeds ${MAX_SELECTED_BYTES} bytes`);
    let text: string;
    try {
      text = decoder.decode(bytes!);
    } catch {
      fail(`${file.locator} must be valid UTF-8 text`);
    }
    return { ...file, bytes: bytes!.byteLength, text: safeText(text!, file.locator) };
  });
  const hits = new Map<string, number>();
  for (const file of files)
    for (const hit of secretHits(file.text)) {
      const key = `${file.locator}:${hit.rule.name}`;
      hits.set(key, (hits.get(key) ?? 0) + 1);
    }
  if (hits.size) {
    const summary = [...hits.entries()].slice(0, 10).map(([key, count]) => `${key}=${count}`).join(", ");
    fail(`secret patterns rejected the complete import: ${summary}${hits.size > 10 ? ", …" : ""}`);
  }
  return { files, skipped: selected.skipped, bytes: total };
}

function splitClaim(text: string): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > MAX_CLAIM_CHARS) {
    const window = rest.slice(0, MAX_CLAIM_CHARS + 1);
    const newline = window.lastIndexOf("\n", MAX_CLAIM_CHARS);
    const space = window.lastIndexOf(" ", MAX_CLAIM_CHARS);
    const boundary = Math.max(newline, space);
    const cut = boundary >= Math.floor(MAX_CLAIM_CHARS / 2) ? boundary : MAX_CLAIM_CHARS;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function frontmatter(text: string): { body: string; metadata: string | null } {
  if (!text.startsWith("---\n")) return { body: text, metadata: null };
  const lines = text.split("\n");
  const end = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
  if (end < 0) return { body: text, metadata: null };
  return {
    metadata: lines.slice(1, end).join("\n").trim() || null,
    body: lines.slice(end + 1).join("\n"),
  };
}

function markdownEntries(file: SelectedFile, profileId: SourceImportProfile): RawEntry[] {
  const normalized = file.text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/^\uFEFF/u, "");
  const parsed = frontmatter(normalized);
  const metadata = profileId === "agent-rules@1" && parsed.metadata
    ? `Source applicability metadata (inert):\n${parsed.metadata}`
    : null;
  const lines = parsed.body.split("\n");
  const headings: string[] = [];
  const blocks: Array<{ headings: string[]; text: string }> = [];
  let current: string[] = [];
  let fence: "```" | "~~~" | null = null;
  const flush = () => {
    const text = current.join("\n").trim();
    if (text) blocks.push({ headings: [...headings], text });
    current = [];
  };
  for (const line of lines) {
    const fenceMatch = /^\s*(```|~~~)/u.exec(line);
    if (fenceMatch) fence = fence === null ? fenceMatch[1] as "```" | "~~~" : fence === fenceMatch[1] ? null : fence;
    const heading = fence === null ? /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/u.exec(line) : null;
    if (heading) {
      flush();
      const level = heading[1]!.length;
      headings.length = level - 1;
      headings[level - 1] = heading[2]!.trim();
      continue;
    }
    if (line.trim() === "" && fence === null) flush();
    else current.push(line);
  }
  flush();

  const date = /^memory\/(\d{4}-\d{2}-\d{2})(?:-|\.md)/u.exec(file.locator)?.[1];
  const occurredAt = date ? timestamp(`${date}T00:00:00.000Z`, `${file.locator} date`) : null;
  const kind: ClaimKind = profileId === "agent-rules@1"
    || (profileId === "amazon-q-memory@1" && file.locator === "guidelines.md")
    ? "procedural"
    : "semantic_fact";
  const entries: RawEntry[] = [];
  blocks.forEach((block, blockIndex) => {
    const heading = block.headings.filter(Boolean).join(" > ");
    const content = [metadata, heading || null, block.text].filter(Boolean).join("\n\n");
    splitClaim(content).forEach((chunk, chunkIndex) => entries.push({
      locator: file.locator,
      identity: `${file.locator}:block:${blockIndex}:chunk:${chunkIndex}`,
      provenance: `${file.locator}#block=${blockIndex};chunk=${chunkIndex}`,
      content: chunk,
      occurredAt,
      kind,
    }));
  });
  return entries;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${field} must be a non-empty string`);
  return value;
}

function parseJson(file: SelectedFile): unknown {
  try {
    return JSON.parse(file.text);
  } catch {
    fail(`${file.locator} must contain valid JSON`);
  }
}

function recordEntries(file: SelectedFile, kind: "mem0" | "memomind"): RawEntry[] {
  const root = parseJson(file);
  if (kind === "mem0") {
    const values = mem0Envelope(root);
    if (!values) fail(`${file.locator} has no supported Mem0 record envelope`);
    if (values.length === 0) fail(`${file.locator} contains no Mem0 records`);
    return values.map((value, index) => {
      const row = record(value, `${file.locator} record ${index}`);
      const texts = ["memory", "content", "text"]
        .filter((field) => typeof row[field] === "string" && (row[field] as string).trim() !== "")
        .map((field) => row[field] as string);
      if (texts.length !== 1) fail(`${file.locator} record ${index} must contain exactly one memory/content/text value`);
      const id = row.id === undefined ? null : nonEmptyString(row.id, `${file.locator} record ${index} id`);
      const occurredAt = timestamp(row.created_at ?? row.createdAt, `${file.locator} record ${index} created_at`);
      return {
        locator: file.locator,
        identity: `${file.locator}:record:${id ?? index}`,
        provenance: `${file.locator}#record=${id ?? index}`,
        content: texts[0]!,
        occurredAt,
        kind: "semantic_fact" as const,
      };
    });
  }

  const document = record(root, file.locator);
  if (document.format !== "memomind-export") fail(`${file.locator} format must be memomind-export`);
  const version = String(document.version ?? "");
  if (!/^1(?:\.|$)/u.test(version)) fail(`${file.locator} uses unsupported MemoMind version ${version || "<missing>"}`);
  if (!Array.isArray(document.memories)) fail(`${file.locator} memories must be an array`);
  if (document.memories.length === 0) fail(`${file.locator} memories must not be empty`);
  return document.memories.map((value, index) => {
    const row = record(value, `${file.locator} memories[${index}]`);
    return {
      locator: file.locator,
      identity: `${file.locator}:record:${index}`,
      provenance: `${file.locator}#record=${index};format=memomind-export;version=${version}`,
      content: nonEmptyString(row.text, `${file.locator} memories[${index}].text`),
      occurredAt: timestamp(row.date, `${file.locator} memories[${index}].date`),
      kind: "semantic_fact" as const,
    };
  });
}

function integer(value: unknown, field: string, minimum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum) fail(`${field} must be an integer >= ${minimum}`);
  return Number(value);
}

function honchoEntries(files: SelectedFile[]): RawEntry[] {
  const pages = files.map((file) => {
    const root = record(parseJson(file), file.locator);
    if (!Array.isArray(root.items)) fail(`${file.locator} items must be an array`);
    return {
      file,
      items: root.items,
      total: integer(root.total, `${file.locator}.total`, 0),
      page: integer(root.page, `${file.locator}.page`, 1),
      size: integer(root.size, `${file.locator}.size`, 1),
      pages: integer(root.pages, `${file.locator}.pages`, 0),
    };
  }).sort((a, b) => a.page - b.page);
  const expected = pages[0]!;
  if (pages.some((page) => page.total !== expected.total || page.size !== expected.size || page.pages !== expected.pages))
    fail("Honcho pages disagree on total, size, or pages");
  if (expected.pages < 1 || pages.length !== expected.pages)
    fail(`Honcho export requires exactly ${expected.pages} page file(s)`);
  pages.forEach((page, index) => {
    if (page.page !== index + 1) fail("Honcho pages must be the complete contiguous set 1..pages");
  });
  const all = pages.flatMap((page) => page.items.map((item, index) => ({ page, item, index })));
  if (all.length !== expected.total || all.length === 0)
    fail(`Honcho item count ${all.length} does not match total ${expected.total}`);
  const ids = new Set<string>();
  return all.map(({ page, item, index }) => {
    const row = record(item, `${page.file.locator}.items[${index}]`);
    const id = nonEmptyString(row.id, `${page.file.locator}.items[${index}].id`);
    if (ids.has(id)) fail(`Honcho conclusion id is duplicated: ${id}`);
    ids.add(id);
    const observer = nonEmptyString(row.observer_id, `${id}.observer_id`);
    const observed = nonEmptyString(row.observed_id, `${id}.observed_id`);
    const session = row.session_id === null || row.session_id === undefined
      ? null
      : nonEmptyString(row.session_id, `${id}.session_id`);
    const level = nonEmptyString(row.level, `${id}.level`);
    return {
      locator: page.file.locator,
      identity: `${page.file.locator}:conclusion:${id}`,
      provenance: `${page.file.locator}#id=${id};observer=${observer};observed=${observed};session=${session ?? "null"};level=${level}`,
      content: nonEmptyString(row.content, `${id}.content`),
      occurredAt: timestamp(row.created_at, `${id}.created_at`),
      kind: "semantic_fact" as const,
    };
  });
}

function hasPopulatedValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.some(hasPopulatedValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasPopulatedValue);
  return true;
}

function agentFileEntries(file: SelectedFile): RawEntry[] {
  const root = record(parseJson(file), file.locator);
  if (!Array.isArray(root.agents) || !Array.isArray(root.blocks))
    fail(`${file.locator} must contain agents[] and blocks[]`);
  if (root.agents.length !== 1) fail(`${file.locator} must contain exactly one agent`);
  const agent = record(root.agents[0], `${file.locator}.agents[0]`);
  const agentId = nonEmptyString(agent.id, `${file.locator}.agents[0].id`);
  if (!Array.isArray(agent.block_ids)) fail(`${file.locator}.agents[0].block_ids must be an array`);
  const blockIds = agent.block_ids.map((id, index) => nonEmptyString(id, `${file.locator}.agents[0].block_ids[${index}]`));
  if (new Set(blockIds).size !== blockIds.length) fail(`${file.locator} contains duplicate agent block references`);
  if (agent.secrets !== undefined && agent.secrets !== null) fail(`${file.locator} contains a non-null secret payload`);
  if (hasPopulatedValue(agent.tool_exec_environment_variables))
    fail(`${file.locator} contains populated tool execution environment variables`);

  const blocks = new Map<string, Record<string, unknown>>();
  for (const [index, value] of root.blocks.entries()) {
    const block = record(value, `${file.locator}.blocks[${index}]`);
    const id = nonEmptyString(block.id, `${file.locator}.blocks[${index}].id`);
    if (blocks.has(id)) fail(`${file.locator} contains duplicate block id ${id}`);
    blocks.set(id, block);
  }
  const labels = new Set<string>();
  return blockIds.map((blockId) => {
    const block = blocks.get(blockId);
    if (!block) fail(`${file.locator} has dangling block reference ${blockId}`);
    const label = nonEmptyString(block.label, `${blockId}.label`);
    if (labels.has(label)) fail(`${file.locator} contains duplicate selected block label ${label}`);
    labels.add(label);
    const description = block.description === undefined || block.description === null
      ? null
      : nonEmptyString(block.description, `${blockId}.description`);
    const updatedAt = timestamp(block.updated_at, `${blockId}.updated_at`);
    const createdAt = timestamp(block.created_at, `${blockId}.created_at`);
    return {
      locator: file.locator,
      identity: `${file.locator}:agent:${agentId}:block:${blockId}`,
      provenance: `${file.locator}#agent=${agentId};block=${blockId};label=${label};description=${description ?? "null"}`,
      content: nonEmptyString(block.value, `${blockId}.value`),
      occurredAt: updatedAt ?? createdAt,
      kind: "semantic_fact" as const,
    };
  });
}

function parseEntries(files: SelectedFile[], profileId: SourceImportProfile): RawEntry[] {
  const profile = SOURCE_IMPORT_PROFILES[profileId];
  if (profile.parser === "markdown") return files.flatMap((file) => markdownEntries(file, profileId));
  if (profile.parser === "records") return recordEntries(files[0]!, profile.records!);
  if (profile.parser === "honcho") return honchoEntries(files);
  return agentFileEntries(files[0]!);
}

function validateDestination(options: PrepareSourceImportOptions): {
  profile: SourceImportProfile;
  subject: string;
  project: string | null;
  workspaceId: string | null;
  visibility: Visibility;
  trust: "unverified" | "asserted";
} {
  if (!SOURCE_IMPORT_PROFILE_IDS.includes(options.profile as SourceImportProfile))
    fail(`--from must be one of: ${SOURCE_IMPORT_PROFILE_IDS.join(", ")}`);
  const subject = safeText(options.subject?.trim() ?? "", "--subject");
  if (!subject || subject.length > 200) fail("--subject must contain 1 to 200 characters");
  const project = options.project?.trim()
    ? safeText(options.project.trim(), "--project")
    : null;
  const workspaceId = options.workspaceId?.trim()
    ? safeText(options.workspaceId.trim(), "--workspace-id")
    : null;
  const visibility = (options.visibility ?? "private") as Visibility;
  if (!(["private", "team", "organization"] as string[]).includes(visibility))
    fail("--visibility must be private, team, or organization");
  if (visibility === "team" && !workspaceId) fail("--workspace-id is required for team visibility");
  const trust = options.trust ?? "unverified";
  if (trust !== "unverified" && trust !== "asserted") fail("--trust must be unverified or asserted");
  for (const [field, value] of [["--project", project], ["--workspace-id", workspaceId]] as const)
    if (value && value.length > 200) fail(`${field} may not exceed 200 characters`);
  return {
    profile: options.profile as SourceImportProfile,
    subject,
    project,
    workspaceId,
    visibility,
    trust,
  };
}

export async function prepareSourceImport(options: PrepareSourceImportOptions): Promise<PreparedSourceImport> {
  const destination = validateDestination(options);
  const selected = readSelectedFiles(options.path, destination.profile);
  const rawEntries = parseEntries(selected.files, destination.profile).flatMap((entry) => {
    const chunks = splitClaim(entry.content);
    return chunks.map((content, index) => chunks.length === 1 ? entry : {
      ...entry,
      identity: `${entry.identity}:chunk:${index}`,
      provenance: `${entry.provenance};chunk=${index}`,
      content,
    });
  });
  if (rawEntries.length === 0) fail(`${destination.profile} produced no memory entries`);
  if (rawEntries.length > MAX_ENTRIES) fail(`source produced more than ${MAX_ENTRIES} entries`);
  const destinationTuple = {
    subject_id: destination.subject,
    project_reference: destination.project,
    workspace_id: destination.workspaceId,
    visibility: destination.visibility,
    trust: destination.trust,
  };
  const entries: PreparedSourceEntry[] = [];
  for (const entry of rawEntries) {
    const contentHash = await sha256Hex(entry.content);
    const sourceId = `imp_${await sha256Hex(canonicalJson({
      profile: destination.profile,
      identity: entry.identity,
      provenance: entry.provenance,
      content_hash: contentHash,
      destination: destinationTuple,
    }))}`;
    const readableRef = entry.provenance;
    const sourceRef = readableRef.length <= 200
      ? readableRef
      : `sha256:${await sha256Hex(readableRef)}`;
    entries.push({ ...entry, sourceId, sourceRef, contentHash });
  }
  const runId = `import_${await sha256Hex(canonicalJson({
    profile: destination.profile,
    destination: destinationTuple,
    source_ids: entries.map((entry) => entry.sourceId),
  }))}`;
  const seen = new Set<string>();
  let duplicates = 0;
  for (const entry of entries) {
    const key = `${entry.contentHash}:${entry.occurredAt ?? ""}:${entry.kind}`;
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return {
    entries,
    preview: {
      profile: destination.profile,
      subject_id: destination.subject,
      project_reference: destination.project,
      workspace_id: destination.workspaceId,
      visibility: destination.visibility,
      trust: destination.trust,
      import_run_id: runId,
      selected_files: selected.files.map(({ locator, bytes }) => ({ locator, bytes })),
      skipped_files: selected.skipped,
      selected_bytes: selected.bytes,
      entries: entries.length,
      duplicate_entries: duplicates,
      items: entries.map((entry) => ({
        locator: entry.locator,
        source_ref: entry.sourceRef,
        source_id: entry.sourceId,
        content_sha256: entry.contentHash,
        characters: entry.content.length,
        claim_kind: entry.kind,
        occurred_at: entry.occurredAt,
      })),
    },
  };
}

export interface ApplySourceImportTarget {
  apiKey: string;
  dbPath?: string;
  url?: string;
}

export interface SourceImportApplyResult {
  target: "local" | "served";
  database: string | null;
  endpoint: string | null;
  entries: number;
  observations_created: number;
  observations_replayed: number;
  claims_created: number;
  claims_replayed: number;
}

function servedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("TITEN_URL must be an exact HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(url!.protocol)
    || url!.username || url!.password || url!.pathname !== "/" || url!.search || url!.hash
  ) fail("TITEN_URL must be an exact HTTP(S) origin without credentials, path, query, or hash");
  return url!.origin;
}

export async function applySourceImport(
  prepared: PreparedSourceImport,
  target: ApplySourceImportTarget,
): Promise<SourceImportApplyResult> {
  if (!target.apiKey?.trim()) fail("TITEN_API_KEY is required for --apply");
  if (Boolean(target.dbPath) === Boolean(target.url))
    fail("--apply requires exactly one local --db target or TITEN_URL");
  let close = () => {};
  let client: TitenClient;
  let databasePath: string | null = null;
  let endpoint: string | null = null;
  if (target.dbPath) {
    databasePath = resolve(target.dbPath);
    if (!existsSync(databasePath)) fail(`database does not exist: ${databasePath}`);
    assertNoSymlinkComponents(databasePath);
    const database = openDatabase(databasePath, { create: false });
    close = () => database.close();
    const db = createSqliteDb(database);
    const schema = await schemaState(db);
    if (!schema.verified || schema.applied !== schema.expected) {
      close();
      fail(`database schema is not ready (${schema.applied}/${schema.expected})`);
    }
    const app = createApp({ db, revision: "source-import", runtime: "bun-sqlite" });
    client = new TitenClient({
      url: "http://source-import.invalid",
      key: target.apiKey,
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        app(new Request(input, init))) as unknown as typeof fetch,
    });
  } else {
    endpoint = servedOrigin(target.url!);
    client = new TitenClient({ url: endpoint, key: target.apiKey });
  }

  let observationsCreated = 0;
  let observationsReplayed = 0;
  let claimsCreated = 0;
  let claimsReplayed = 0;
  let nextSourceRef = prepared.entries[0]?.sourceRef ?? null;
  try {
    await client.request("GET", "/v1/principal");
    const projectId = prepared.preview.project_reference
      ? (await client.resolveProject(prepared.preview.project_reference, false)).project_id
      : undefined;
    const observations: ObservationRecord[] = [];
    for (const entry of prepared.entries) {
      nextSourceRef = entry.sourceRef;
      const response = await client.requestWithMeta<ObservationRecord>("POST", "/v1/observations", {
        idempotencyKey: `source-observation:${entry.sourceId}`,
        json: {
          subject_id: prepared.preview.subject_id,
          project_id: projectId,
          workspace_id: prepared.preview.workspace_id ?? undefined,
          kind: "imported_source",
          content: entry.content,
          source: {
            type: `import:${prepared.preview.profile}`,
            ref: entry.sourceRef,
            id: entry.sourceId,
          },
          run_id: prepared.preview.import_run_id,
          trust: prepared.preview.trust,
          visibility: prepared.preview.visibility,
          occurred_at: entry.occurredAt ?? undefined,
        },
      });
      observations.push(response.data);
      if (response.meta.replayed === true) observationsReplayed += 1;
      else observationsCreated += 1;
    }

    for (let start = 0; start < prepared.entries.length; start += 50) {
      const entries = prepared.entries.slice(start, start + 50);
      const evidence = observations.slice(start, start + 50);
      nextSourceRef = entries[0]?.sourceRef ?? null;
      const key = await sha256Hex(`${prepared.preview.import_run_id}:claims:${start}`);
      const response = await client.requestWithMeta<{ claims: unknown[] }>("POST", "/v1/consolidations", {
        idempotencyKey: `source-claims:${key}`,
        json: {
          subject_id: prepared.preview.subject_id,
          project_id: projectId,
          workspace_id: prepared.preview.workspace_id ?? undefined,
          claims: entries.map((entry, index) => ({
            kind: entry.kind,
            statement: entry.content,
            confidence: 1,
            trust: prepared.preview.trust,
            visibility: prepared.preview.visibility,
            valid_from: entry.occurredAt ?? undefined,
            sources: [{ observation_id: evidence[index]!.observation_id, relation: "supports" }],
          })),
        },
      });
      const count = response.data.claims.length;
      if (response.meta.replayed === true) claimsReplayed += count;
      else claimsCreated += count;
      nextSourceRef = prepared.entries[start + count]?.sourceRef ?? null;
    }
  } catch (error) {
    const complete = claimsCreated + claimsReplayed;
    throw new Error(
      `apply stopped after ${complete} complete entr${complete === 1 ? "y" : "ies"}${
        nextSourceRef ? ` at ${nextSourceRef}` : ""
      }: ${
        error instanceof Error ? error.message : "target request failed"
      }`,
    );
  } finally {
    close();
  }
  return {
    target: databasePath ? "local" : "served",
    database: databasePath,
    endpoint,
    entries: prepared.entries.length,
    observations_created: observationsCreated,
    observations_replayed: observationsReplayed,
    claims_created: claimsCreated,
    claims_replayed: claimsReplayed,
  };
}
