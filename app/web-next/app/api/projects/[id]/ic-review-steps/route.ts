// GET/POST /api/projects/[id]/ic-review-steps — the S11 투자심사 procedure
// steps (entity-ic-review 1~5, group-investment-review 1~5) with their status
// from the ledgers of record (lib/ic-review-steps). GET is the step strip the
// IC screen renders; POST records one intermediate human step:
//   { action: "record", procedure, step_id, payload?, evidence_ref? }
//   { action: "snapshot_ic_memo", note? }            → step 3 memo + hash
// Derived steps (AI RAG proposal, gate decisions) are refused here — their
// own ledgers remain authoritative. Analyst+, audited ic_review_step.recorded;
// members only (FR-SEC-01). Nothing here gates: failed steps feed the GO-gap
// warning the person must answer with a rationale (boundary #2).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import {
  IcReviewStepError,
  icReviewStepsView,
  recordIcReviewStep,
  snapshotIcMemo,
  type IcProcedure,
} from "../../../../../lib/ic-review-steps.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  return ok(icReviewStepsView(getDb(), id), 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "투자심사 절차 단계 기록은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const db = getDb();
  try {
    if (body?.action === "snapshot_ic_memo") {
      const row = snapshotIcMemo(db, id, auth.auth.userId, typeof body.note === "string" ? body.note : null);
      return ok(row, 201);
    }
    if (body?.action === "record") {
      const procedure = body.procedure as IcProcedure;
      const stepId = typeof body.step_id === "string" ? body.step_id : "";
      const payload = body.payload && typeof body.payload === "object" ? (body.payload as Record<string, unknown>) : null;
      const row = recordIcReviewStep(db, {
        projectId: id, procedure, stepId, payload,
        evidenceRef: typeof body.evidence_ref === "string" ? body.evidence_ref : null,
        by: auth.auth.userId,
      });
      return ok(row, 201);
    }
    return badRequest("invalid_action", "action은 record | snapshot_ic_memo 중 하나여야 합니다.");
  } catch (err) {
    if (err instanceof IcReviewStepError) return badRequest("invalid_request", err.message);
    throw err;
  }
}
