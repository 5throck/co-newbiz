// S7 재무·기술 평가 항목 삭제(커스텀 항목만, 판정 기록 없을 때만) / 가중치
// 수정(모든 항목) / 재무 빌트인 항목의 판정 루브릭 임계값 수정(ADR-0139/0140).
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { deleteCriterion, updateCriterionRubric, updateCriterionWeight } from "../../../../../../lib/brownfield-eval-criteria.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { getDb } from "../../../../../../../../db/client.ts";

export async function PATCH(request: Request, { params }: { params: Promise<{ oppId: string; criterionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Evaluation-item updates require the analyst role or higher." });
  if (denied) return denied;
  const { criterionId } = await params;
  const body = (await request.json().catch(() => null)) as { weight?: number; rubric?: Record<string, unknown> } | null;
  if (body?.weight === undefined && body?.rubric === undefined) {
    return badRequest("invalid_request", "Either weight (a positive number) or rubric (threshold) is required.");
  }
  if (body?.weight !== undefined) {
    if (typeof body.weight !== "number") return badRequest("invalid_request", "weight must be a number.");
    const result = updateCriterionWeight(criterionId, body.weight);
    if (!result.ok) {
      if (result.reason === "not_found") return notFound();
      return badRequest("invalid_weight", "weight must be greater than 0.");
    }
  }
  if (body?.rubric !== undefined) {
    const result = updateCriterionRubric(criterionId, body.rubric);
    if (!result.ok) {
      if (result.reason === "not_found") return notFound();
      if (result.reason === "not_rubric_capable") return badRequest("not_rubric_capable", "Thresholds can be set only on financial built-in items.");
      return badRequest("invalid_input", "A rubric threshold is out of range or unrecognized.");
    }
    appendAudit(getDb(), { actor: auth.auth.userId, action: "eval_criterion.rubric_update", target: criterionId, now: new Date().toISOString() });
  }
  return ok({ ok: true }, 200);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ oppId: string; criterionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Evaluation-item deletion requires the analyst role or higher." });
  if (denied) return denied;
  const { criterionId } = await params;
  const result = deleteCriterion(criterionId);
  if (!result.ok) {
    if (result.reason === "not_found") return notFound();
    if (result.reason === "not_deletable") return badRequest("not_deletable", "Required/seeded items cannot be deleted.");
    return badRequest("has_assessment", "Items with recorded judgements cannot be deleted.");
  }
  return ok({ ok: true }, 200);
}
