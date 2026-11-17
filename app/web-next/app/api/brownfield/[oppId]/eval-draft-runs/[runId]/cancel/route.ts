// POST /api/brownfield/[oppId]/eval-draft-runs/[runId]/cancel — cancel an active run (ADR-0199 A4; design 2026-11-17 §10.5).
// Every queued (`pending`) item becomes `cancelled`; in-flight items finish their current step, then the run becomes
// `cancelled` (at once when nothing is in flight). Versions and applied verdicts already written stay. Response
// { run_id, status, cancelled_items }. Analyst+. Audit target_eval.bulk_run.cancel.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { EvalDraftError, getRun } from "../../../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";
import { cancelRun } from "../../../../../../../lib/brownfield-eval-queue.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { promotedCarrierResponse } from "../../../../../../../lib/route-track-guard.ts";
import { fail, notFound, ok } from "../../../../../../../lib/envelope.ts";

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; runId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Cancelling an AI evaluation run requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { oppId, runId } = await params;
  const db = getDb();
  const run = getRun(db, runId);
  if (!run || run.opportunity_id !== oppId) return notFound();
  const promoted = promotedCarrierResponse(
    db,
    oppId,
    "This opportunity is already a project; its evaluation runs can no longer be changed.",
  );
  if (promoted) return promoted;
  const now = new Date().toISOString();
  try {
    // The audit row commits with the cancel (one transaction) or the cancel does not happen.
    const { run: next, cancelledItems } = cancelRun(db, runId, now, (n) =>
      appendAudit(db, {
        actor: auth.auth.userId,
        action: "target_eval.bulk_run.cancel",
        target: `${oppId}:run:${runId}:cancelled_items=${n}`,
        now,
      }),
    );
    return ok({ run_id: next.id, status: next.status, cancelled_items: cancelledItems }, 200);
  } catch (e) {
    if (e instanceof EvalDraftError) return fail(409, "not_cancellable", e.message);
    throw e;
  }
}
