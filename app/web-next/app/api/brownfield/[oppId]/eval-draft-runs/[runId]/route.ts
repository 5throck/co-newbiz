// GET /api/brownfield/[oppId]/eval-draft-runs/[runId] — one run with items and the budget snapshot (ADR-0199 A2).
// A run of another opportunity is 404 (never leaked).
import { getDb } from "../../../../../../../../db/client.ts";
import { getRun } from "../../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { runProgressView } from "../../../../../../lib/brownfield-eval-run-view.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string; runId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { oppId, runId } = await params;
  const db = getDb();
  const run = getRun(db, runId);
  if (!run || run.opportunity_id !== oppId) return notFound();
  return ok(runProgressView(db, oppId, runId), 200);
}
