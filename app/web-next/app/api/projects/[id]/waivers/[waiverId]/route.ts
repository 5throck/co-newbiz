// Waiver decision — PATCH records the human approve/reject/revoke
// (db/lib/compliance.ts decideWaiver). Approve flips pending → active with
// the approver record; reject records the schema-reserved 'rejected' state;
// revoke is only for invalidated justification — otherwise expiry IS the
// enforcement mechanism (skills/waiver-management).
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { decideWaiver, type WaiverDecision } from "../../../../../../../../db/lib/compliance.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";

const DECISIONS = new Set<WaiverDecision>(["approve", "reject", "revoke"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; waiverId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Waiver judgements require the analyst role or higher.");
  const { id, waiverId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { decision?: string } | null;
  const decision = body?.decision as WaiverDecision | undefined;
  if (!decision || !DECISIONS.has(decision)) {
    return badRequest("invalid_request", `decision must be one of ${[...DECISIONS].join("|")}.`);
  }
  const db = getDb();
  const waiver = db.query("SELECT id, project_id FROM waiver WHERE id = ?").get(waiverId) as
    | { id: string; project_id: string }
    | undefined;
  if (!waiver || waiver.project_id !== id) return notFound();

  const now = new Date().toISOString();
  try {
    const row = decideWaiver(db, { id: waiverId, decision, decidedBy: ctx.userId, now });
    appendAudit(db, { actor: ctx.userId, action: `waiver.${decision}`, target: `${id}:${waiverId}`, now });
    return ok({ id: row.id, status: row.status, approved_by: row.approved_by, approved_at: row.approved_at });
  } catch (err) {
    return badRequest("invalid_transition", err instanceof Error ? err.message : String(err));
  }
}
