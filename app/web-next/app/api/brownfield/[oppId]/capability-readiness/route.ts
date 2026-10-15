// GET /api/brownfield/[oppId]/capability-readiness — S7 `target_screening` readiness: per
// shortlisted target the required-capability check counts (confirmed / unconfirmed / stale /
// unjudged / not reconciled) plus the criteria-reconcile detection (ADR-0171 D7). WARNING ONLY:
// `warning` is advisory text; nothing here caps a grade or blocks a gate or a promotion.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { capabilityReadiness } from "../../../../../lib/brownfield-capability-judgement.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  return ok(capabilityReadiness(db, oppId), 200);
}
