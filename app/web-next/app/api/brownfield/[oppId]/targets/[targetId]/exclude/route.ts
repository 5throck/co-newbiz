// S7 — 제외 (Exclusion Reasons 기록).
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../../lib/envelope.ts";

const now = () => new Date().toISOString();

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Exclusion requires the analyst role or higher." });
  if (denied) return denied;
  const { oppId, targetId } = await params;
  const body = (await request.json().catch(() => null)) as { reason?: string; gate_evaluation_id?: string } | null;
  const reason = body?.reason?.trim();
  if (!reason) return badRequest("invalid_request", "Exclusion reason is required.");
  const db = getDb();
  // ADR-0097 back-compat: optional provenance link to the S6/S7 committee
  // deliberation that proposed this exclusion (0066 nullable column).
  const gateEvaluationId = body?.gate_evaluation_id?.trim() || null;
  if (gateEvaluationId && !db.query("SELECT id FROM gate_evaluation WHERE id = ?").get(gateEvaluationId)) {
    return badRequest("invalid_request", "gate_evaluation_id does not exist — check the gate_evaluation of the committee session.");
  }
  const existing = db
    .query("SELECT id FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(targetId, oppId) as { id: string } | undefined;
  if (!existing) return notFound();
  db.run("UPDATE brownfield_target SET status = 'excluded', exclusion_reason = ?, rank = NULL, gate_evaluation_id = COALESCE(?, gate_evaluation_id), updated_at = ? WHERE id = ?", [reason, gateEvaluationId, now(), targetId]);
  appendAudit(db, { actor: auth.auth.userId, action: "brownfield_target.exclude", target: `${oppId}:${targetId}`, now: now() });
  return ok(db.query("SELECT * FROM brownfield_target WHERE id = ?").get(targetId), 200);
}
