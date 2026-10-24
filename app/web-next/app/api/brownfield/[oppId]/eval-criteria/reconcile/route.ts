// GET/POST /api/brownfield/[oppId]/eval-criteria/reconcile — S7 technical-criteria reconcile
// (ADR-0171 D6). Brown Field S3 rows were seeded once as technical criteria, so rows added to S3
// later never reached S7 and removed rows lingered. GET detects the difference (read-only);
// POST applies it, idempotently: missing rows are seeded, removed rows are retired with a marker
// (evaluation records and capability judgements are kept, never deleted), renamed rows get the
// new label, a row that came back is reinstated. Weights and verdicts are never touched.
// analyst+; audit brownfield_eval_criteria.reconcile.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { detectCriteriaReconcile, reconcileCriteria } from "../../../../../../lib/brownfield-eval-criteria.ts";
import { invalidateOpportunityTargets } from "../../../../../../lib/brownfield-capability-judgement.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  return ok(detectCriteriaReconcile(oppId, db), 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Evaluation-criteria tailoring requires the analyst role or higher." });
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  const at = new Date().toISOString();
  const result = db.transaction(() => {
    const r = reconcileCriteria(oppId, auth.auth.userId, db, at);
    // Materialise pending S3 changes on the targets' judgements under the calling user (history + audit).
    const invalidated = invalidateOpportunityTargets(db, oppId, auth.auth.userId, at);
    return { ...r, invalidated: invalidated.length };
  })();
  return ok({ ...result, plan: detectCriteriaReconcile(oppId, db) }, 200);
}
