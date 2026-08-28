// POST /api/projects/:id/analysis-tasks/:taskId/review — the ONLY write
// path for analysis_task.reviewed_by (design boundary #2: gate approval
// belongs to humans, never agents). Any authenticated analyst+ caller can
// sign off today — the system has no dedicated "Entity IC reviewer" DB
// role (procedures/_human-roles.yaml's entity-ic-reviewer is a person-role
// label, not a role enum value), so this follows the same role_required
// convention as dimension-input's review endpoint rather than inventing a
// new role tier unilaterally.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id, taskId } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Only analysts and admins can record a human-final review sign-off.");

  const db = getDb();
  const task = db.query("SELECT id, project_id, reviewed_by FROM analysis_task WHERE id = ?").get(taskId) as
    | { id: string; project_id: string; reviewed_by: string | null }
    | null;
  if (!task || task.project_id !== project.id) return notFound();
  if (task.reviewed_by) return badRequest("already_reviewed", "This deliverable already carries a human-final review sign-off.");

  const now = new Date().toISOString();
  db.run("UPDATE analysis_task SET reviewed_by = ?, reviewed_at = ? WHERE id = ?", [ctx.userId, now, taskId]);
  appendAudit(db, { actor: ctx.userId, action: "analysis_task_review", target: `${project.id}:${taskId}`, now });
  return ok({ id: taskId, reviewed_by: ctx.userId, reviewed_at: now });
}
