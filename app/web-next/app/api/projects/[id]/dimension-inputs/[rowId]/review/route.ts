// Port of app/server/pmi.ts POST /api/projects/:id/dimension-inputs/:rowId/review
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { review as reviewDimensionInput } from "../../../../../../../../../db/repositories/dimension-input.repository.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id, rowId } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Reviews require the analyst role.");
  const row = getDb().query("SELECT project_id FROM dimension_input WHERE id = ?").get(rowId) as { project_id: string } | null;
  if (!row || row.project_id !== project.id) return notFound();
  try {
    const reviewed = reviewDimensionInput({ input_id: rowId, reviewed_by: ctx.userId }, getDb());
    appendAudit(getDb(), { actor: ctx.userId, action: "dimension_input_review", target: `${project.id}:${rowId}`, now: new Date().toISOString() });
    return ok({ id: reviewed.id, var_key: reviewed.var_key, reviewed_by: reviewed.reviewed_by });
  } catch (err) {
    return badRequest("review_failed", err instanceof Error ? err.message : "Review rejected.");
  }
}
