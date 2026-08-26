// Phase 2 port of app/server/projects.ts's GET/POST /api/projects
// (ADR-0069/0070, design doc §4). First route ported as the proof point
// for the whole migration — validates the authenticate() wrapper,
// db/repositories reuse, and the envelope contract end-to-end before the
// remaining 33 endpoints are ported the same way.
//
// Deliberately reuses db/repositories/project.repository.ts and
// db/lib/access-control.ts UNCHANGED (same membership filtering, same
// MNPI exclusion, same audit log) — this port moves the HTTP layer only;
// the business logic and its test coverage stay exactly what app/server
// already exercises. See lib/auth.ts's header comment for why.

import { getDb } from "../../../../../db/client.ts";
import { createProject, listVisibleProjects } from "../../../../../db/repositories/project.repository.ts";
import { appendAudit, grantProjectMembership } from "../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, forbidden, ok } from "../../../lib/envelope.ts";

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

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const includeMnpi = ["1", "true"].includes(url.searchParams.get("include_mnpi") ?? "");
  const projects = listVisibleProjects(auth.auth.userId, { excludeMnpi: !includeMnpi });
  const overall = latestOverallGrades(projects.map((p) => p.id));
  const rows = projects.map((p) => {
    const grade = overall.get(p.id);
    return grade ? { ...p, rag_overall: grade.grade, rag_assessed_at: grade.assessed_at } : p;
  });
  return ok(rows, 200, { include_mnpi: includeMnpi, count: rows.length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;

  if (ctx.role === "viewer") {
    return forbidden("role_required", "Project creation requires the analyst role.");
  }
  const body = (await request.json().catch(() => null)) as { project_no?: string } | null;
  if (!body?.project_no?.trim()) {
    return badRequest("invalid_request", "project_no is required.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  const project = createProject(body.project_no.trim());
  grantProjectMembership(db, {
    projectId: project.id,
    userId: ctx.userId,
    projectRole: "lead",
    grantedBy: ctx.userId,
    needToKnowBasis: "project creator",
    now,
  });
  appendAudit(db, { actor: ctx.userId, action: "project_create", target: project.id, now });
  return ok(project, 201);
}
