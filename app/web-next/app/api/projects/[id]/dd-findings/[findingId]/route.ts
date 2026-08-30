// Single DD finding — update/delete (CRUD completion). Ownership resolved
// through project_id on the finding row.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; findingId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "DD findings are updated by analysts.");
  const { id, findingId } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  const owned = getDb()
    .query("SELECT id FROM dd_finding WHERE id = ? AND project_id = ?")
    .get(findingId, project.id);
  if (!owned) return notFound();
  const body = (await request.json().catch(() => null)) as {
    description?: string; value_impact?: number | null; evidence_ref?: string | null;
  } | null;
  if (!body) return badRequest("invalid_request", "body required.");
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.description !== undefined) {
    if (!body.description.trim()) return badRequest("invalid_request", "description cannot be empty.");
    sets.push("description = ?");
    vals.push(body.description.trim());
  }
  if (body.value_impact !== undefined) {
    sets.push("value_impact = ?");
    vals.push(body.value_impact === null ? null : Number(body.value_impact));
  }
  if (body.evidence_ref !== undefined) { sets.push("evidence_ref = ?"); vals.push(body.evidence_ref?.trim() || null); }
  if (sets.length === 0) return badRequest("invalid_request", "Nothing to update.");
  getDb().run(`UPDATE dd_finding SET ${sets.join(", ")} WHERE id = ?`, [...vals, findingId]);
  appendAudit(getDb(), { actor: ctx.userId, action: "dd_finding_update", target: `${project.project_no}:${findingId}`, now: new Date().toISOString() });
  return ok({ id: findingId });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; findingId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "DD findings are deleted by analysts.");
  const { id, findingId } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  const res = getDb().run("DELETE FROM dd_finding WHERE id = ? AND project_id = ?", [findingId, project.id]);
  if (res.changes === 0) return notFound();
  appendAudit(getDb(), { actor: ctx.userId, action: "dd_finding_delete", target: `${project.project_no}:${findingId}`, now: new Date().toISOString() });
  return ok({ deleted: findingId });
}
