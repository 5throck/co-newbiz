// Single assumption — update/delete (CRUD completion). Updates are partial
// (value/rationale/anchor_ref/ttl_days); delete is a hard delete + audit.
// Assumptions are run-scoped: ownership is resolved through the run's deal.
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../lib/envelope.ts";
import { visibleProject } from "../../../../lib/project-visibility.ts";

export async function PUT(request: Request, { params }: { params: Promise<{ assumptionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Assumptions are updated by analysts.");
  const { assumptionId } = await params;
  const row = getDb()
    .query("SELECT a.id, a.run_id, r.project_id FROM assumption a JOIN run r ON r.id = a.run_id WHERE a.id = ?")
    .get(assumptionId) as { id: string; run_id: string; project_id: string } | null;
  if (!row) return notFound();
  const project = visibleProject(ctx, row.project_id);
  if (!project) return notFound();

  const body = (await request.json().catch(() => null)) as {
    value?: number; rationale?: string; anchor_ref?: string; ttl_days?: number | null;
  } | null;
  if (!body) return badRequest("invalid_request", "body required.");
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.value !== undefined) {
    if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
      return badRequest("invalid_request", "value must be a finite number.");
    }
    sets.push("value = ?");
    vals.push(body.value);
  }
  if (body.rationale !== undefined) { sets.push("rationale = ?"); vals.push(body.rationale?.trim() || null); }
  if (body.anchor_ref !== undefined) { sets.push("anchor_ref = ?"); vals.push(body.anchor_ref?.trim() || null); }
  if (body.ttl_days !== undefined) { sets.push("ttl_days = ?"); vals.push(body.ttl_days === null ? null : Number(body.ttl_days)); }
  if (sets.length === 0) return badRequest("invalid_request", "Nothing to update.");
  const now = new Date().toISOString();
  getDb().run(`UPDATE assumption SET ${sets.join(", ")} WHERE id = ?`, [...vals, assumptionId]);
  appendAudit(getDb(), { actor: ctx.userId, action: "assumption_update", target: assumptionId, now });
  return ok({ id: assumptionId });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ assumptionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Assumptions are deleted by analysts.");
  const { assumptionId } = await params;
  const row = getDb()
    .query("SELECT a.id, r.project_id FROM assumption a JOIN run r ON r.id = a.run_id WHERE a.id = ?")
    .get(assumptionId) as { id: string; project_id: string } | null;
  if (!row) return notFound();
  const project = visibleProject(ctx, row.project_id);
  if (!project) return notFound();
  getDb().run("DELETE FROM assumption WHERE id = ?", [assumptionId]);
  appendAudit(getDb(), { actor: ctx.userId, action: "assumption_delete", target: assumptionId, now: new Date().toISOString() });
  return ok({ deleted: assumptionId });
}
