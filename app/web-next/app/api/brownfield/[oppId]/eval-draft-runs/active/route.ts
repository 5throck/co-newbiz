// GET /api/brownfield/[oppId]/eval-draft-runs/active — every S6 evaluation run of the opportunity whose engine is
// executing in THIS process (running, including a cancelled engine still finishing its current item), oldest first,
// each in the same shape as the `latest` response ({ run, items, progress, budget }). `{ runs: [] }` when none. With
// parallel per-candidate engines (ADR-0199 follow-up) the single "latest" run cannot describe what is running.
import { getDb } from "../../../../../../../../db/client.ts";
import { getRun } from "../../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { activeEngineRunsForOpportunity } from "../../../../../../lib/brownfield-eval-bulk.ts";
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
