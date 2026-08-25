// Port of app/server/projects.ts GET/POST /api/projects/:id/members
import { getDb } from "../../../../../../../db/client.ts";
import { grantProjectMembership } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { isLead, visibleProject } from "../../../../../lib/project-visibility.ts";

const PROJECT_ROLES = new Set(["lead", "contributor", "reviewer", "observer"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query(
      "SELECT user_id, project_role, granted_by, granted_at, need_to_know_basis FROM project_member WHERE project_id = ? AND revoked_at IS NULL ORDER BY granted_at",
    )
    .all(project.id);
  return ok(rows);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (!isLead(ctx, project.id)) {
    return forbidden("not_project_lead", "Only the project lead can manage membership.");
  }
  const body = (await request.json().catch(() => null)) as
    | { userId?: string; project_role?: string; need_to_know_basis?: string }
    | null;
  if (!body?.userId?.trim() || !body.project_role || !PROJECT_ROLES.has(body.project_role)) {
    return badRequest("invalid_request", "userId and a valid project_role (lead|contributor|reviewer|observer) are required.");
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
    return badRequest("membership_grant_failed", err instanceof Error ? err.message : "Grant failed.");
  }
  return ok({ ok: true, project_id: project.id, user_id: body.userId.trim(), project_role: body.project_role }, 201);
}
