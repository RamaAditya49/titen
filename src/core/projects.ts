import { first, type Db } from "./db";
import { notFound, validationError } from "./errors";
import { newId } from "./ids";
import { hasScope, type Principal } from "./auth";
import { LIMITS, requireObject, requireString, optionalBoolean } from "./validate";
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

export async function resolveProject(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const reference = normalizeProjectReference(requireString(body, "reference", LIMITS.identifier));
  const wantsCreate = optionalBoolean(body, "create");

  const existing = await first<{ id: string; created_at: string }>(
    ctx.app.db,
    `SELECT id, created_at FROM projects WHERE org_id = ? AND reference = ?`,
    [principal.orgId, reference],
  );
  if (existing)
    return {
      data: { project_id: existing.id, reference, created: false },
    };

  // Resolution alone never creates scope; creating a project is a capability.
  if (!wantsCreate || !hasScope(principal, "projects:create"))
    throw notFound({
      reason: "project_not_registered",
      reference,
      can_create: hasScope(principal, "projects:create"),
    });

  const id = newId("project");
  await ctx.app.db.batch([
    {
      sql: `INSERT INTO projects (id, org_id, reference, created_at) VALUES (?, ?, ?, ?)`,
      params: [id, principal.orgId, reference, ctx.app.now().toISOString()],
    },
  ]);
  return { status: 201, data: { project_id: id, reference, created: true } };
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
