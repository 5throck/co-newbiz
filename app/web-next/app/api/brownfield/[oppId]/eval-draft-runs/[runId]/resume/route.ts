// POST /api/brownfield/[oppId]/eval-draft-runs/[runId]/resume — resume a paused_budget or interrupted run from its first
// non-terminal item (ADR-0199 A3). MANUAL ONLY: the scheduler never resumes a run, so every version stays attributable
// to a real caller (a person, or an agent under that person's delegation). Refused with 409 budget_reserve while the
// DART reserve is still unmet. Sets resumed_by. Analyst+. Audit target_eval.bulk_run.resume.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import {
  EvalDraftError,
  getRun,
  markStaleRunInterrupted,
  resumeRun,
} from "../../../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { promotedCarrierResponse } from "../../../../../../../lib/route-track-guard.ts";
import { fail, notFound, ok } from "../../../../../../../lib/envelope.ts";
import {
  currentBudget,
  dartReserve,
  isEngineActive,
  launchBulkEval,
} from "../../../../../../../lib/brownfield-eval-bulk.ts";

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; runId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Resuming an AI evaluation run requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { oppId, runId } = await params;
  const db = getDb();
  let run = getRun(db, runId);
  if (!run || run.opportunity_id !== oppId) return notFound();
  const promoted = promotedCarrierResponse(
    db,
    oppId,
    "이 기회는 이미 프로젝트로 승격되었습니다 — 실행을 이어갈 수 없습니다.",
  );
  if (promoted) return promoted;
  const now = new Date().toISOString();
  if (!isEngineActive(runId)) {
    markStaleRunInterrupted(db, oppId, now);
    run = getRun(db, runId) ?? run;
  }
  if (isEngineActive(runId)) return fail(409, "engine_active", "The run is still being processed.");
  if (run.status !== "paused_budget" && run.status !== "interrupted")
    return fail(409, "not_resumable", `Run is '${run.status}'; only a paused or interrupted run can be resumed.`);
  if (run.status === "paused_budget") {
    const b = currentBudget();
    if (b.budget - b.calls < dartReserve(b.budget))
      return fail(409, "budget_reserve", "The DART daily budget reserve is not yet restored — resume later.");
  }
  try {
    run = resumeRun(db, runId, auth.auth.userId, now);
  } catch (e) {
    if (e instanceof EvalDraftError) return fail(409, "not_resumable", e.message);
    throw e;
  }
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "target_eval.bulk_run.resume",
    target: `${oppId}:run:${runId}`,
    now,
  });
  launchBulkEval(db, runId);
  return ok({ run_id: run.id, status: run.status }, 202);
}
