// Advance a committee session — next deliberation round, or the chair
// synthesis (ADR-0097 §5). The synthesis writes a gate_evaluation PROPOSAL
// with the ADR-0096 §6 verbatim-dissent rule; it NEVER writes a
// gate_decision / route_decision / brownfield_target record (design
// boundary #2 — the confirm click is always human).
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { CommitteeError, advanceCommitteeSession } from "../../../../../../../lib/committee-session.ts";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "위원회 진행은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id, sessionId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  // Session binding: the session's process_run must address THIS path
  // opportunity — a session of another entity is 404 here, never advanceable.
  const run = db.query("SELECT entity_type, entity_id FROM process_run WHERE id = ?").get(sessionId) as
    | { entity_type: string; entity_id: string }
    | undefined;
  if (!run || run.entity_type !== "opportunity" || run.entity_id !== id) return notFound();
  try {
    const result = await advanceCommitteeSession(sessionId, { actor: ctx.userId });
    appendAudit(db, {
      actor: ctx.userId,
      action: `committee_session.${result.status}`,
      target: `${id}:${sessionId}`,
      now: new Date().toISOString(),
    });
    return ok(result, 200);
  } catch (err) {
    if (err instanceof CommitteeError) {
      if (err.code === "not_found") return notFound();
      return badRequest(err.code, err.message);
    }
    return badRequest("advance_failed", err instanceof Error ? err.message : String(err));
  }
}
