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
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "평가 항목 수정은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { criterionId } = await params;
  const body = (await request.json().catch(() => null)) as { weight?: number; rubric?: Record<string, unknown> } | null;
  if (body?.weight === undefined && body?.rubric === undefined) {
    return badRequest("invalid_request", "weight(가중치, 양수) 또는 rubric(임계값) 중 하나는 필수입니다.");
  }
  if (body?.weight !== undefined) {
    if (typeof body.weight !== "number") return badRequest("invalid_request", "weight는 숫자여야 합니다.");
    const result = updateCriterionWeight(criterionId, body.weight);
    if (!result.ok) {
      if (result.reason === "not_found") return notFound();
      return badRequest("invalid_weight", "weight는 0보다 큰 값이어야 합니다.");
    }
  }
  if (body?.rubric !== undefined) {
    const result = updateCriterionRubric(criterionId, body.rubric);
    if (!result.ok) {
      if (result.reason === "not_found") return notFound();
      if (result.reason === "not_rubric_capable") return badRequest("not_rubric_capable", "임계값은 재무 빌트인 항목에만 설정할 수 있습니다.");
      return badRequest("invalid_input", "rubric의 임계값이 범위를 벗어났거나 인식할 수 없습니다.");
    }
    appendAudit(getDb(), { actor: auth.auth.userId, action: "eval_criterion.rubric_update", target: criterionId, now: new Date().toISOString() });
  }
  return ok({ ok: true }, 200);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ oppId: string; criterionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "평가 항목 삭제는 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { criterionId } = await params;
  const result = deleteCriterion(criterionId);
  if (!result.ok) {
    if (result.reason === "not_found") return notFound();
    if (result.reason === "not_deletable") return badRequest("not_deletable", "필수·시딩 항목은 삭제할 수 없습니다.");
    return badRequest("has_assessment", "이미 판정 기록이 있는 항목은 삭제할 수 없습니다.");
  }
  return ok({ ok: true }, 200);
}
