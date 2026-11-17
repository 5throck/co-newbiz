// POST /api/brownfield/[oppId]/eval-draft-runs/[runId]/items/[itemId]/cancel — cancel ONE queued item (A4b, design
// 2026-11-17 §10.5). Allowed only while the item is `pending` (waiting for a worker slot); an item a worker already holds
// is 409 item_running (cancel the run instead), a finished one is 409 item_finished. Not human-only: cancelling is not a
// judgement. Analyst+. Audit target_eval.bulk_item.cancel. Items of another opportunity or run are 404 (never leaked).
import { getDb } from "../../../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../../../db/lib/access-control.ts";
import {
  cancelQueuedItem,
  getRun,
  getRunItem,
  STEP_ITEM_STATES,
} from "../../../../../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../../../lib/auth.ts";
import { fail, notFound, ok } from "../../../../../../../../../lib/envelope.ts";
import { promotedCarrierResponse } from "../../../../../../../../../lib/route-track-guard.ts";
import { pump } from "../../../../../../../../../lib/brownfield-eval-queue.ts";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ oppId: string; runId: string; itemId: string }> },
) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Cancelling a queued AI evaluation requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { oppId, runId, itemId } = await params;
  const db = getDb();
  const run = getRun(db, runId);
  if (!run || run.opportunity_id !== oppId) return notFound();
  const item = getRunItem(db, itemId);
  if (!item || item.run_id !== runId) return notFound();
  const promoted = promotedCarrierResponse(
    db,
    oppId,
    "This opportunity is already a project; its evaluation runs can no longer be changed.",
  );
  if (promoted) return promoted;
  const now = new Date().toISOString();
  // The audit row commits with the cancel (one transaction) or the cancel does not happen.
  const cancelled = cancelQueuedItem(db, itemId, now, () =>
    appendAudit(db, {
      actor: auth.auth.userId,
      action: "target_eval.bulk_item.cancel",
      target: `${oppId}:run:${runId}:item:${itemId}:target=${item.brownfield_target_id}`,
      now,
    }),
  );
  if (!cancelled) {
    return (STEP_ITEM_STATES as readonly string[]).includes(item.state)
      ? fail(409, "item_running", "This candidate is already being evaluated; cancel the run instead.")
      : fail(409, "item_finished", `The item is '${item.state}'; only a queued item can be cancelled.`);
  }
  pump(); // a run whose last queued item was cancelled completes now
  return ok({ run_id: runId, item_id: itemId, state: "cancelled" }, 200);
}
