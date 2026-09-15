// S7 재무·기술 평가 항목 삭제(커스텀 항목만, 판정 기록 없을 때만) / 가중치
// 수정(모든 항목 — ADR-0139).
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { deleteCriterion, updateCriterionWeight } from "../../../../../../lib/brownfield-eval-criteria.ts";

export async function PATCH(request: Request, { params }: { params: Promise<{ oppId: string; criterionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "평가 항목 수정은 analyst 역할 이상이어야 합니다.");
  const { criterionId } = await params;
  const body = (await request.json().catch(() => null)) as { weight?: number } | null;
  if (typeof body?.weight !== "number") return badRequest("invalid_request", "weight(가중치, 양수)는 필수입니다.");
  const result = updateCriterionWeight(criterionId, body.weight);
  if (!result.ok) {
    if (result.reason === "not_found") return notFound();
    return badRequest("invalid_weight", "weight는 0보다 큰 값이어야 합니다.");
  }
  return ok({ ok: true }, 200);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ oppId: string; criterionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "평가 항목 삭제는 analyst 역할 이상이어야 합니다.");
  const { criterionId } = await params;
  const result = deleteCriterion(criterionId);
  if (!result.ok) {
    if (result.reason === "not_found") return notFound();
    if (result.reason === "not_deletable") return badRequest("not_deletable", "필수·시딩 항목은 삭제할 수 없습니다.");
    return badRequest("has_assessment", "이미 판정 기록이 있는 항목은 삭제할 수 없습니다.");
  }
  return ok({ ok: true }, 200);
}
