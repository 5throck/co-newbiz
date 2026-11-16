// GET /api/brownfield/[oppId]/eval-draft-runs/latest — the S6 progress panel's load query (ADR-0199 A2): the latest run
// of the opportunity with its items and the DART budget snapshot; `run: null` when none exists. A `running` run whose
// heartbeat is older than 10 minutes (and that has no engine in this process) is lazily marked `interrupted`.
import { getDb } from "../../../../../../../../db/client.ts";
import { getLatestRun } from "../../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { runProgressView } from "../../../../../../lib/brownfield-eval-run-view.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  const run = getLatestRun(db, oppId);
  return ok(runProgressView(db, oppId, run?.id ?? null), 200);
}
