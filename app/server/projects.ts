// @version 1.1.0
/**
 * Project routes — docs/api-spec.md §3 (Wave 5.6A).
 *
 * Every read goes through db/repositories/project.repository.ts, which
 * filters by project_member at the SQL layer (FR-SEC-01/02). A non-member
 * gets 404 — identical to "does not exist" — never 403.
 *
 * MNPI (FR-SEC-06 / FR-SYS-02): list excludes mnpi_flag=1 projects by
 * default across every list/search surface; `include_mnpi=1` is the
 * member-gated opt-in (the repository logs every MNPI read at the
 * enforcement layer). Detail returns the flag so the UI can render the MNPI
 * banner for authenticated members (security-model §6).
 *
 * Role note: api-spec names legal-counsel/compliance-officer for
 * classification writes — the account model (Wave 5.5) has
 * admin/analyst/viewer only, so classification PUT maps to admin+member and
 * records classified_by. Deferred-to-5.7 note lives in the PR body.
 */

import { Hono } from "hono";
import { getDb } from "../../db/client.ts";
import {
  createProject,
  getProjectIfVisible,
  listVisibleProjects,
} from "../../db/repositories/project.repository.ts";
import { appendAudit, grantProjectMembership, revokeProjectMembership } from "../../db/lib/access-control.ts";
import { badRequest, forbidden, notFound, ok } from "./envelope.ts";
import { requireAuth, type AppEnv, type AuthContext } from "./middleware.ts";

export const projectRoutes = new Hono<AppEnv>();
projectRoutes.use("*", requireAuth);

const PROJECT_ROLES = new Set(["lead", "contributor", "reviewer", "observer"]);
const SENSITIVITIES = new Set(["public", "internal", "confidential", "restricted"]);

function isLead(ctx: AuthContext, projectId: string): boolean {
  const row = getDb()
    .query("SELECT project_role FROM project_member WHERE project_id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(projectId, ctx.userId) as { project_role: string } | null;
  return row?.project_role === "lead";
}

function classificationOf(projectId: string) {
  return getDb()
    .query("SELECT sensitivity, mnpi_flag, wall_group, classified_by, classified_at FROM project_classification WHERE project_id = ?")
    .get(projectId) as { sensitivity: string; mnpi_flag: number; wall_group: string | null; classified_by: string | null; classified_at: string | null } | null;
}

/**
 * Membership-gated detail lookup. Returns null when the caller cannot see
 * the project — the route turns that into a bare 404.
 */
function visibleProject(ctx: AuthContext, projectId: string) {
  return getProjectIfVisible(ctx.userId, projectId, { excludeMnpi: false });
}

/**
 * Latest `overall`-grade rag_assessment per project, one aggregate query
 * (ROW_NUMBER window over assessed_at DESC, id DESC — the same recency
 * ordering the /rag route uses), not a per-project subrequest. `overall`
 * rows are written only by assessRun when a real overall grade resulted
 * (rag-engine.ts), so a missing entry genuinely means "no overall grade
 * yet" and the list row carries no RAG fields at all — the same
 * absence-is-meaningful rule as the /rag read side (never a default color).
 *
 * `stale` is deliberately NOT derived here: fact_market_observation rows
 * carry no project binding (api-spec §7's own /api/data-changes note), and
 * ttl_days is per (run, assumption_key) with no design rule defining a
 * project-level freshness boolean — no honest server-side staleness signal
 * exists yet, so the field is omitted rather than fabricated.
 */
function latestOverallGrades(projectIds: string[]): Map<string, { grade: string; assessed_at: string }> {
  const byProject = new Map<string, { grade: string; assessed_at: string }>();
  if (projectIds.length === 0) return byProject;
  const rows = getDb()
    .query(
      `SELECT project_id, grade, assessed_at FROM (
         SELECT project_id, grade, assessed_at,
                ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY assessed_at DESC, id DESC) AS rn
         FROM rag_assessment
         WHERE dimension = 'overall' AND project_id IN (${projectIds.map(() => "?").join(", ")})
       ) WHERE rn = 1`,
    )
    .all(...projectIds) as { project_id: string; grade: string; assessed_at: string }[];
  for (const row of rows) byProject.set(row.project_id, { grade: row.grade, assessed_at: row.assessed_at });
  return byProject;
}

/**
 * GET /api/projects — membership-filtered list; MNPI excluded by default.
 * Rows carry rag_overall/rag_assessed_at only when a latest overall
 * assessment exists (see latestOverallGrades) — the list-card RAG badge
 * renders on field presence, never on a defaulted grade.
 */
projectRoutes.get("/api/projects", (c) => {
  const includeMnpi = ["1", "true"].includes(c.req.query("include_mnpi") ?? "");
  const projects = listVisibleProjects(c.get("auth").userId, { excludeMnpi: !includeMnpi });
  const overall = latestOverallGrades(projects.map((p) => p.id));
  const rows = projects.map((p) => {
    const grade = overall.get(p.id);
    return grade ? { ...p, rag_overall: grade.grade, rag_assessed_at: grade.assessed_at } : p;
  });
  return ok(c, rows, 200, { include_mnpi: includeMnpi, count: rows.length });
});

/** GET /api/projects/:id — 404 for non-members; MNPI banner flag in meta. */
projectRoutes.get("/api/projects/:id", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const classification = classificationOf(project.id);
  return ok(c, project, 200, {
    mnpi_banner: classification?.mnpi_flag === 1,
    sensitivity: classification?.sensitivity ?? null,
    wall_group: classification?.wall_group ?? null,
  });
});

/** POST /api/projects — analyst/admin; creator becomes lead automatically. */
projectRoutes.post("/api/projects", async (c) => {
  const ctx = c.get("auth");
  if (ctx.role === "viewer") {
    return forbidden(c, "role_required", "Project creation requires the analyst role.");
  }
  const body = await c.req.json().catch(() => null) as { project_no?: string } | null;
  if (!body?.project_no?.trim()) {
    return badRequest(c, "invalid_request", "project_no is required.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  const project = createProject(body.project_no.trim());
  // Without this grant the creator could not see their own project —
  // deny-by-default applies to everyone (the basis records why).
  grantProjectMembership(db, {
    projectId: project.id,
    userId: ctx.userId,
    projectRole: "lead",
    grantedBy: ctx.userId,
    needToKnowBasis: "project creator",
    now,
  });
  appendAudit(db, { actor: ctx.userId, action: "project_create", target: project.id, now });
  return ok(c, project, 201);
});

/** GET /api/projects/:id/members — any active member of the project. */
projectRoutes.get("/api/projects/:id/members", (c) => {
  const ctx = c.get("auth");
  const project = visibleProject(ctx, c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query(
      "SELECT user_id, project_role, granted_by, granted_at, need_to_know_basis FROM project_member WHERE project_id = ? AND revoked_at IS NULL ORDER BY granted_at",
    )
    .all(project.id);
  return ok(c, rows);
});

/** POST /api/projects/:id/members — project lead only; basis mandatory (engine). */
projectRoutes.post("/api/projects/:id/members", async (c) => {
  const ctx = c.get("auth");
  const project = visibleProject(ctx, c.req.param("id"));
  if (!project) return notFound(c);
  if (!isLead(ctx, project.id)) {
    return forbidden(c, "not_project_lead", "Only the project lead can manage membership.");
  }
  const body = await c.req.json().catch(() => null) as
    | { userId?: string; project_role?: string; need_to_know_basis?: string }
    | null;
  if (!body?.userId?.trim() || !body.project_role || !PROJECT_ROLES.has(body.project_role)) {
    return badRequest(c, "invalid_request", "userId and a valid project_role (lead|contributor|reviewer|observer) are required.");
  }
  try {
    grantProjectMembership(getDb(), {
      projectId: project.id,
      userId: body.userId.trim(),
      projectRole: body.project_role as "lead" | "contributor" | "reviewer" | "observer",
      grantedBy: ctx.userId,
      needToKnowBasis: body.need_to_know_basis ?? "",
      now: new Date().toISOString(),
    });
  } catch (err) {
    return badRequest(c, "membership_grant_failed", err instanceof Error ? err.message : "Grant failed.");
  }
  return ok(c, { ok: true, project_id: project.id, user_id: body.userId.trim(), project_role: body.project_role }, 201);
});

/** DELETE /api/projects/:id/members/:userId — project lead only. */
projectRoutes.delete("/api/projects/:id/members/:userId", (c) => {
  const ctx = c.get("auth");
  const project = visibleProject(ctx, c.req.param("id"));
  if (!project) return notFound(c);
  if (!isLead(ctx, project.id)) {
    return forbidden(c, "not_project_lead", "Only the project lead can manage membership.");
  }
  revokeProjectMembership(getDb(), {
    projectId: project.id,
    userId: c.req.param("userId"),
    revokedBy: ctx.userId,
    now: new Date().toISOString(),
  });
  return ok(c, { ok: true });
});

/** GET /api/projects/:id/classification */
projectRoutes.get("/api/projects/:id/classification", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  return ok(c, classificationOf(project.id));
});

/** PUT /api/projects/:id/classification — admin AND member (see module doc). */
projectRoutes.put("/api/projects/:id/classification", async (c) => {
  const ctx = c.get("auth");
  if (ctx.role !== "admin") {
    return forbidden(c, "admin_required", "Classification is set by an administrator who is a project member.");
  }
  const project = visibleProject(ctx, c.req.param("id"));
  if (!project) return notFound(c);
  const body = await c.req.json().catch(() => null) as
    | { sensitivity?: string; mnpi_flag?: number | boolean; wall_group?: string | null }
    | null;
  const mnpi = body?.mnpi_flag === true || body?.mnpi_flag === 1 ? 1 : 0;
  if (!body?.sensitivity || !SENSITIVITIES.has(body.sensitivity)) {
    return badRequest(c, "invalid_request", `sensitivity must be one of ${[...SENSITIVITIES].join("|")}.`);
  }
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, wall_group, classified_by, classified_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (project_id) DO UPDATE SET
       sensitivity = excluded.sensitivity,
       mnpi_flag = excluded.mnpi_flag,
       wall_group = excluded.wall_group,
       classified_by = excluded.classified_by,
       classified_at = excluded.classified_at`,
    [project.id, body.sensitivity, mnpi, body.wall_group?.trim() || null, ctx.userId, now],
  );
  appendAudit(db, {
    actor: ctx.userId,
    action: "classification_set",
    target: `${project.id}:${body.sensitivity}:mnpi=${mnpi}`,
    now,
  });
  return ok(c, classificationOf(project.id));
});
