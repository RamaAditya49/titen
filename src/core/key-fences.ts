import type { Stmt } from "./db";
import { forbidden, notFound, validationError } from "./errors";
import { LIMITS, requireString } from "./validate";

/** Null on a dimension means that dimension is unrestricted. */
export interface KeyFences {
  read_projects: string[] | null;
  read_subjects: string[] | null;
  write_projects: string[] | null;
  write_subjects: string[] | null;
}

export const UNRESTRICTED_FENCES: KeyFences = {
  read_projects: null,
  read_subjects: null,
  write_projects: null,
  write_subjects: null,
};

export const MAX_FENCE_PATTERNS = 32;

const WRITE_FENCE_DENIED = "This credential's write fence does not allow this subject or project.";

export interface FenceRow {
  access: "read" | "write";
  target_type: "project" | "subject";
  pattern: string;
}

type FenceKind = "project" | "subject";

/**
 * Exact subject, or one trailing `*` prefix. A project pattern is an exact
 * project id. The SQL twin of this function is `subjectPatternSql`; keep them
 * aligned.
 */
export function subjectMatches(pattern: string, subjectId: string): boolean {
  if (pattern === subjectId) return true;
  if (pattern.length <= 1 || !pattern.endsWith("*") || pattern.indexOf("*") !== pattern.length - 1)
    return false;
  return subjectId.startsWith(pattern.slice(0, -1));
}

/**
 * Predicate comparing a pattern column to a subject expression.
 *
 * Callers pass fixed identifiers. The expression must not contain the
 * substrings `o.` or `c.` except for a record alias the portability rewriter
 * is expected to rename.
 */
export function subjectPatternSql(patternSql: string, subjectSql: string): string {
  return `(
    ${patternSql} = ${subjectSql}
    OR (
      length(${patternSql}) > 1
      AND substr(${patternSql}, length(${patternSql}), 1) = '*'
      AND instr(${patternSql}, '*') = length(${patternSql})
      AND substr(${subjectSql}, 1, length(${patternSql}) - 1)
          = substr(${patternSql}, 1, length(${patternSql}) - 1)
    )
  )`;
}

/**
 * Read fences filter canonical rows. No read-fence rows for the bound key
 * allow every row the rest of the predicate already allows. A project list and
 * a subject list on the same key both have to match. Write fences stay out of
 * this predicate so an organization or team read is unchanged.
 *
 * Five `?` binds, each the key id, in the order `recordAccessParams` appends.
 * Nested `EXISTS` probes `api_key_fences` by that key id. Do not rewrite this
 * as a join onto observations or claims.
 */
export function readFenceSql(alias: "c" | "o"): string {
  return `(
    NOT EXISTS (
      SELECT 1 FROM api_key_fences read_fence
       WHERE read_fence.key_id = ? AND read_fence.access = 'read'
    )
    OR (
      (
        NOT EXISTS (
          SELECT 1 FROM api_key_fences read_project
           WHERE read_project.key_id = ?
             AND read_project.access = 'read'
             AND read_project.target_type = 'project'
        )
        OR EXISTS (
          SELECT 1 FROM api_key_fences read_project_match
           WHERE read_project_match.key_id = ?
             AND read_project_match.access = 'read'
             AND read_project_match.target_type = 'project'
             AND read_project_match.pattern = ${alias}.project_id
        )
      )
      AND (
        NOT EXISTS (
          SELECT 1 FROM api_key_fences read_subject
           WHERE read_subject.key_id = ?
             AND read_subject.access = 'read'
             AND read_subject.target_type = 'subject'
        )
        OR EXISTS (
          SELECT 1 FROM api_key_fences read_subject_match
           WHERE read_subject_match.key_id = ?
             AND read_subject_match.access = 'read'
             AND read_subject_match.target_type = 'subject'
             AND ${subjectPatternSql("read_subject_match.pattern", `${alias}.subject_id`)}
        )
      )
    )
  )`;
}

export function fencesFromRows(rows: FenceRow[]): KeyFences {
  const grouped: Record<keyof KeyFences, string[]> = {
    read_projects: [],
    read_subjects: [],
    write_projects: [],
    write_subjects: [],
  };
  for (const row of rows) {
    const key = `${row.access}_${row.target_type}s` as keyof KeyFences;
    if (!grouped[key]) continue;
    grouped[key].push(row.pattern);
  }
  const list = (patterns: string[]) => patterns.length ? [...new Set(patterns)].sort() : null;
  return {
    read_projects: list(grouped.read_projects),
    read_subjects: list(grouped.read_subjects),
    write_projects: list(grouped.write_projects),
    write_subjects: list(grouped.write_subjects),
  };
}

export function fencesAreRestricted(fences: KeyFences): boolean {
  return fences.read_projects !== null
    || fences.read_subjects !== null
    || fences.write_projects !== null
    || fences.write_subjects !== null;
}

export function fenceStatements(keyId: string, fences: KeyFences): Stmt[] {
  const statements: Stmt[] = [];
  const push = (access: "read" | "write", target: FenceKind, patterns: string[] | null) => {
    if (!patterns) return;
    for (const pattern of patterns)
      statements.push({
        sql: `INSERT INTO api_key_fences (key_id, access, target_type, pattern) VALUES (?, ?, ?, ?)`,
        params: [keyId, access, target, pattern],
      });
  };
  push("read", "project", fences.read_projects);
  push("read", "subject", fences.read_subjects);
  push("write", "project", fences.write_projects);
  push("write", "subject", fences.write_subjects);
  return statements;
}

export function fenceAuditDetail(
  lifecycle: { not_before: string; expires_at: string | null },
  fences: KeyFences,
): string {
  return JSON.stringify({
    not_before: lifecycle.not_before,
    expires_at: lifecycle.expires_at,
    read_projects: fences.read_projects,
    read_subjects: fences.read_subjects,
    write_projects: fences.write_projects,
    write_subjects: fences.write_subjects,
  });
}

export function parseFenceList(value: unknown, field: string, kind: FenceKind): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0)
    throw validationError(`Field "${field}" must be a non-empty array of patterns.`);
  if (value.length > MAX_FENCE_PATTERNS)
    throw validationError(`Field "${field}" accepts at most ${MAX_FENCE_PATTERNS} patterns.`);
  const patterns = value.map((entry, index) => normalizeFencePattern(entry, `${field}[${index}]`, kind));
  if (new Set(patterns).size !== patterns.length)
    throw validationError(`Field "${field}" contains a duplicate pattern.`);
  return [...patterns].sort();
}

export function parseFenceCsv(value: string, field: string, kind: FenceKind): string[] {
  const parts = value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  const parsed = parseFenceList(parts, field, kind);
  if (!parsed) throw validationError(`Field "${field}" must be a non-empty array of patterns.`);
  return parsed;
}

function normalizeFencePattern(value: unknown, field: string, kind: FenceKind): string {
  if (typeof value !== "string") throw validationError(`Field "${field}" must be a string.`);
  const pattern = requireString({ pattern: value }, "pattern", LIMITS.identifier, field);
  if (/\s/u.test(pattern) || pattern.includes(","))
    throw validationError(`Field "${field}" cannot contain whitespace or a comma.`);
  if (kind === "project") {
    if (pattern.includes("*"))
      throw validationError(`Field "${field}" cannot contain a wildcard.`);
    return pattern;
  }
  const star = pattern.indexOf("*");
  if (star === -1) return pattern;
  if (star !== pattern.length - 1 || pattern.length < 2)
    throw validationError(`Field "${field}" must be an exact subject or a prefix ending in *.`);
  return pattern;
}

function dimensionAllows(
  projects: string[] | null,
  subjects: string[] | null,
  subjectId: string,
  projectId: string | null,
): boolean {
  if (projects === null && subjects === null) return true;
  const projectOk = projects === null || (projectId !== null && projects.includes(projectId));
  const subjectOk = subjects === null || subjects.some((pattern) => subjectMatches(pattern, subjectId));
  return projectOk && subjectOk;
}

export function assertWriteFence(
  fences: KeyFences | undefined,
  subjectId: string,
  projectId: string | null,
): void {
  const current = fences ?? UNRESTRICTED_FENCES;
  if (!dimensionAllows(current.write_projects, current.write_subjects, subjectId, projectId))
    throw forbidden(WRITE_FENCE_DENIED);
}

/** A direct read outside a read fence is indistinguishable from a missing row. */
export function assertReadFence(
  fences: KeyFences | undefined,
  subjectId: string,
  projectId: string | null,
): void {
  const current = fences ?? UNRESTRICTED_FENCES;
  if (!dimensionAllows(current.read_projects, current.read_subjects, subjectId, projectId))
    throw notFound();
}
