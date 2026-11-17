// GET /api/brownfield/[oppId]/eval-draft-runs/active — every S6 evaluation run of the opportunity registered with the
// dispatcher in THIS process (running or queued for a worker slot, including a cancelled run whose in-flight items are
// finishing), oldest first, each in the same shape as the `latest` response ({ run, items, progress, counts, budget }).
// `{ runs: [] }` when none (design 2026-11-17 §10.8).
import { getDb } from "../../../../../../../../db/client.ts";
import { getRun } from "../../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { activeEngineRunsForOpportunity } from "../../../../../../lib/brownfield-eval-queue.ts";
import { runProgressView } from "../../../../../../lib/brownfield-eval-run-view.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  const runs = activeEngineRunsForOpportunity(oppId)
    .map((id) => getRun(db, id))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : a.id < b.id ? -1 : 1))
    .map((r) => runProgressView(db, oppId, r.id));
  return ok({ runs }, 200);
}
