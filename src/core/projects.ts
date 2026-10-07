import { auditStatement } from "./audit";
import { first, type Db } from "./db";
import { notFound, validationError } from "./errors";
import { newId } from "./ids";
import { hasScope, type Principal } from "./auth";
import { subjectMatches, type KeyFences } from "./key-fences";
import {
  LIMITS,
  VISIBILITIES,
  optionalBoolean,
  requireEnum,
  requireObject,
  requireString,
  type Visibility,
} from "./validate";
import type { RequestContext, Result } from "./http";

/** Hosts whose origins collapse to an unambiguous lowercase `owner/repo`. */
const HOSTED_GIT = new Set([
  "github.com",
  "www.github.com",
  "gitlab.com",
  "bitbucket.org",
  "codeberg.org",
  "git.sr.ht",
]);

const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/**
 * Project identity must be shareable between agents, so it may never carry
 * credentials, request-specific query state, or a machine-local path.
 */
export function normalizeProjectReference(input: string): string {
  const raw = input.trim();
  if (raw === "") throw validationError("Project reference must not be empty.");
  if (/[?#\s]/.test(raw))
    throw validationError("Project reference must not contain a query string, fragment, or space.");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw))
    throw validationError("Only https or bare Git references are accepted.");
  if (raw.startsWith("/") || raw.startsWith("~") || /^[a-z]:[\\/]/i.test(raw) || raw.includes("\\"))
    throw validationError("A local filesystem path is not a shared project reference.");

  let value = raw.replace(/^https?:\/\//i, "");
  if (value.includes("@")) {
    const at = value.indexOf("@");
    const userInfo = value.slice(0, at);
    if (userInfo.includes(":") || userInfo.toLowerCase() !== "git")
      throw validationError("Project reference must not contain credential material.");
    value = value.slice(at + 1).replace(":", "/");
  }
  value = value.toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "");
  const segments = value.split("/").filter(Boolean);
  if (!segments.length) throw validationError("Project reference is not resolvable.");

  const host = segments[0]!;
  const isHosted = HOSTED_GIT.has(host) || (segments.length > 2 && host.includes("."));
  const parts = isHosted ? segments.slice(1) : segments;
  if (isHosted && parts.length < 2)
    throw validationError("A hosted Git reference needs an owner and a repository.");
  if (parts.length > 3) throw validationError("Project reference has too many segments.");
  for (const part of parts)
    if (!SEGMENT.test(part))
      throw validationError(`Project reference segment "${part}" is not allowed.`);

  const normalized = HOSTED_GIT.has(host) || !isHosted ? parts.join("/") : [host, ...parts].join("/");
  if (normalized.length > LIMITS.identifier)
    throw validationError("Project reference is too long.");
  return normalized;
}

function editDistance(left: string, right: string): number {
  const a = left.slice(0, 80);
  const b = right.slice(0, 80);
  const rows = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let j = 1; j <= b.length; j += 1) {
    let diagonal = rows[0]!;
    rows[0] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const next = a[i - 1] === b[j - 1]
        ? diagonal
        : Math.min(diagonal, rows[i]!, rows[i - 1]!) + 1;
      diagonal = rows[i]!;
      rows[i] = next;
    }
  }
  return rows[a.length]!;
}

function isSubjectStyle(reference: string): boolean {
  if (/^[a-z]:[\\/]/i.test(reference) || reference.includes("\\") || reference.startsWith("/"))
    return false;
  return reference.includes(":") && !reference.includes("://") && !reference.startsWith("git@");
}

async function projectRowsForFence(
  db: Db,
  orgId: string,
  fences: KeyFences | undefined,
): Promise<Array<{ id: string; reference: string; default_visibility: string | null }>> {
  const ids = [...new Set([
    ...(fences?.write_projects ?? []),
    ...(fences?.read_projects ?? []),
  ])];
  if (ids.length === 0) {
    if (fences?.write_projects || fences?.read_projects) return [];
    return db.all(
      `SELECT id, reference, default_visibility FROM projects WHERE org_id = ? ORDER BY reference LIMIT 50`,
      [orgId],
    );
  }
  return db.all(
    `SELECT id, reference, default_visibility FROM projects
      WHERE org_id = ? AND id IN (${ids.map(() => "?").join(", ")})
      ORDER BY reference`,
    [orgId, ...ids],
  );
}

function closeProjects(
  reference: string,
  rows: Array<{ id: string; reference: string; default_visibility: string | null }>,
) {
  const needle = reference.toLowerCase();
  return rows
    .map((row) => ({ row, distance: editDistance(needle, row.reference.toLowerCase()) }))
    .filter(({ row, distance }) => {
      const haystack = row.reference.toLowerCase();
      return distance <= 3
        || (needle.length >= 3 && (haystack.includes(needle) || needle.includes(haystack)));
    })
    .sort((left, right) => left.distance - right.distance || left.row.reference.localeCompare(right.row.reference))
    .slice(0, 3)
    .map(({ row }) => ({
      project_id: row.id,
      reference: row.reference,
      default_visibility: row.default_visibility ?? "private",
    }));
}

export async function resolveProject(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const rawReference = requireString(body, "reference", LIMITS.identifier);
  const wantsCreate = optionalBoolean(body, "create");
  if (isSubjectStyle(rawReference)) {
    const fences = principal.fences;
    const subjectPatterns = [...(fences?.write_subjects ?? []), ...(fences?.read_subjects ?? [])];
    const subjectAllowed = subjectPatterns.length === 0
      || subjectPatterns.some((pattern) => subjectMatches(pattern, rawReference));
    const rows = await projectRowsForFence(ctx.app.db, principal.orgId, fences);
    const projects = subjectAllowed && (fences?.write_projects || fences?.read_projects)
      ? rows.map((row) => ({
        project_id: row.id,
        reference: row.reference,
        default_visibility: row.default_visibility ?? "private",
      }))
      : [];
    return {
      data: {
        matched: "subject",
        subject_id: rawReference,
        projects,
        suggestions: projects.length > 0 ? projects : closeProjects(rawReference, rows),
        hint: "This is a subject id, not a project reference. Pass one of the project references to titen_project_resolve, or pass its project_id on remember and compile.",
      },
    };
  }
  const reference = normalizeProjectReference(rawReference);

  const defaultVisibility = body.default_visibility === undefined || body.default_visibility === null
    ? null
    : requireEnum(body, "default_visibility", VISIBILITIES);
  const existing = await first<{ id: string; created_at: string; default_visibility: string | null }>(
    ctx.app.db,
    `SELECT id, created_at, default_visibility FROM projects WHERE org_id = ? AND reference = ?`,
    [principal.orgId, reference],
  );
  if (existing)
    return {
      data: {
        project_id: existing.id,
        reference,
        created: false,
        default_visibility: existing.default_visibility ?? "private",
      },
    };

  // Resolution alone never creates scope; creating a project is a capability.
  if (!wantsCreate || !hasScope(principal, "projects:create")) {
    const rows = await projectRowsForFence(ctx.app.db, principal.orgId, principal.fences);
    throw notFound({
      reason: "project_not_registered",
      reference,
      can_create: hasScope(principal, "projects:create"),
      suggestions: closeProjects(reference, rows),
    });
  }

  const id = newId("project");
  const at = ctx.app.now().toISOString();
  await ctx.app.db.batch([
    {
      sql: `INSERT INTO projects (id, org_id, reference, created_at, default_visibility)
            VALUES (?, ?, ?, ?, ?)`,
      params: [id, principal.orgId, reference, at, defaultVisibility],
    },
    auditStatement(
      principal.orgId,
      principal.principalId,
      "project.create",
      "project",
      at,
      id,
      JSON.stringify({ reference, default_visibility: defaultVisibility ?? "private" }),
    ),
  ]);
  return {
    status: 201,
    data: {
      project_id: id,
      reference,
      created: true,
      default_visibility: defaultVisibility ?? "private",
    },
  };
}

export async function updateProject(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const projectId = ctx.params.id!;
  const body = requireObject(await ctx.json());
  const unknown = Object.keys(body).find((field) => field !== "default_visibility");
  if (unknown) throw validationError(`Unknown project field "${unknown}".`);
  const defaultVisibility = requireEnum(body, "default_visibility", VISIBILITIES);
  const existing = await first<{ id: string; reference: string }>(
    ctx.app.db,
    `SELECT id, reference FROM projects WHERE id = ? AND org_id = ?`,
    [projectId, principal.orgId],
  );
  if (!existing) throw notFound();
  const at = ctx.app.now().toISOString();
  await ctx.app.db.batch([
    {
      sql: `UPDATE projects SET default_visibility = ? WHERE id = ? AND org_id = ?`,
      params: [defaultVisibility, projectId, principal.orgId],
    },
    auditStatement(
      principal.orgId,
      principal.principalId,
      "project.update",
      "project",
      at,
      projectId,
      JSON.stringify({ default_visibility: defaultVisibility }),
    ),
  ]);
  return {
    data: {
      project_id: projectId,
      reference: existing.reference,
      default_visibility: defaultVisibility,
    },
  };
}

/** Null means the historical private default: the column is unset. */
export async function projectDefaultVisibility(
  db: Db,
  orgId: string,
  projectId: string | null,
): Promise<Visibility | null> {
  if (!projectId) return null;
  const row = await first<{ default_visibility: string | null }>(
    db,
    `SELECT default_visibility FROM projects WHERE id = ? AND org_id = ?`,
    [projectId, orgId],
  );
  const value = row?.default_visibility;
  if (value === "private" || value === "team" || value === "organization") return value;
  return null;
}

/**
 * Omitted visibility uses the project default when one is stored. Private stays
 * the fallback for projects that have no default and for unscoped writes.
 * An explicit private write into a wider project reports a warning and is stored
 * as private.
 */
export async function resolveWriteVisibility(
  db: Db,
  orgId: string,
  projectId: string | null,
  explicit: Visibility | null,
): Promise<{ visibility: Visibility; warning: string | null }> {
  const projectDefault = await projectDefaultVisibility(db, orgId, projectId);
  const fallback = projectDefault ?? "private";
  const visibility = explicit ?? fallback;
  const warning = visibility === "private" && (fallback === "team" || fallback === "organization")
    ? `Recorded visibility "private" is narrower than this project's default_visibility "${fallback}".`
    : null;
  return { visibility, warning };
}

/** Confirms a caller-supplied project belongs to the authenticated scope. */
export async function requireProject(
  db: Db,
  orgId: string,
  projectId: string | null,
): Promise<string | null> {
  if (!projectId) return null;
  const row = await first<{ id: string }>(
    db,
    `SELECT id FROM projects WHERE id = ? AND org_id = ?`,
    [projectId, orgId],
  );
  if (!row) throw notFound();
  return row.id;
}
