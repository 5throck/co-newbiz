// PUT/DELETE /api/projects/[id]/debt/[debtId] — correct / remove one registered debt
// instrument (2026-10-29). Pattern: jv-terms/[termId] + milestones/[milestoneId]
// (project-scoped sub-route, analyst+ business actor, visibleProject need-to-know,
// appendAudit, hard delete - debt_instrument has no soft-delete column and no FK children).
// PUT replaces the editable fields with the same Zod contract as POST (lib/debt-input.ts).
// Gate-integrity: gate snapshots hash decisions/briefs/assumptions, not debt rows; the
// covenant headroom is recomputed live from these rows, so no snapshot invalidation is needed.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { debtCreateSchema } from "../../../../../../lib/debt-input.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { route } from "../../../../../../lib/route.ts";

type Ctx = { params: Promise<{ id: string; debtId: string }> };

export const PUT = route(async (request: Request, { params }: Ctx) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Updating debt instruments requires the analyst role or higher." });
  if (denied) return denied;
  const { id, debtId } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const db = getDb();
  const existing = db.query("SELECT id, rate_type FROM debt_instrument WHERE id = ? AND project_id = ?").get(debtId, id) as { id: string; rate_type: string } | undefined;
  if (!existing) return notFound();
  const raw = await request.json().catch(() => null);
  const parsed = debtCreateSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return badRequest("invalid_debt_instrument", `${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  const body = parsed.data;
  const rateType = body.rate_type ?? existing.rate_type;
  db.run(
    `UPDATE debt_instrument SET lender = ?, principal = ?, rate_type = ?, rate = ?, maturity = ?, amortization = ?,
       covenant_json = ?, security = ?, seniority = ? WHERE id = ? AND project_id = ?`,
    [body.lender?.trim() || null, body.principal, rateType, body.rate, body.maturity?.trim() || null,
     body.amortization?.trim() || null, body.covenant_json?.trim() || null, body.security?.trim() || null,
     body.seniority?.trim() || null, debtId, id],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "debt.update", target: `${id}:${debtId}`, now: new Date().toISOString() });
  return ok(db.query("SELECT * FROM debt_instrument WHERE id = ?").get(debtId), 200);
});

export const DELETE = route(async (request: Request, { params }: Ctx) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Deleting debt instruments requires the analyst role or higher." });
  if (denied) return denied;
  const { id, debtId } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const db = getDb();
  const existing = db.query("SELECT id FROM debt_instrument WHERE id = ? AND project_id = ?").get(debtId, id);
  if (!existing) return notFound();
  db.run("DELETE FROM debt_instrument WHERE id = ? AND project_id = ?", [debtId, id]);
  appendAudit(db, { actor: auth.auth.userId, action: "debt.delete", target: `${id}:${debtId}`, now: new Date().toISOString() });
  return ok({ id: debtId }, 200);
});
