// POST /api/brownfield/[oppId]/eval-draft-runs/[runId]/cancel — stop an active run after its current step (ADR-0199 A4).
// Versions already written stay; remaining items stay `pending`. Analyst+. Audit target_eval.bulk_run.cancel.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import {
  EvalDraftError,
  finishRun,
  getRun,
} from "../../../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
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
  const now = new Date().toISOString();
  try {
    const next = finishRun(db, runId, "cancelled", now);
    appendAudit(db, {
      actor: auth.auth.userId,
      action: "target_eval.bulk_run.cancel",
      target: `${oppId}:run:${runId}`,
      now,
    });
    return ok({ run_id: next.id, status: next.status }, 200);
  } catch (e) {
    if (e instanceof EvalDraftError) return fail(409, "not_cancellable", e.message);
    throw e;
  }
}
