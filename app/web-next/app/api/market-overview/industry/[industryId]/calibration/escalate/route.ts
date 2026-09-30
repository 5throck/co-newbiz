// 결정론 CAGR 스케일링 에스컬레이션 적용 — 사람의 결정(경계 #2)이며 산술은
// 투명하다: 외부 참조 × (1 − 수렴선). LLM 재분석이 수렴선(격차 ≤15%)에
// 도달하지 못하는 산업에서 3사이클 에스컬레이션 트리거(sim-engine separation
// §P3) 이후 사람이 채택하는 종료 경로다. rationale 필수 — 근거 없는 기록은
// 거부한다.
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { applyCalibrationEscalation, EscalationError } from "../../../../../../../lib/market-calibration.ts";

export async function POST(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "에스컬레이션 적용은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { industryId } = await params;
  const body = (await request.json().catch(() => null)) as { rationale?: string } | null;
  const rationale = body?.rationale?.trim();
  if (!rationale) return badRequest("rationale_required", "에스컬레이션 근거(rationale)는 필수입니다.");
  const db = getDb();
  if (!db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId)) return notFound();
  try {
    const { escalation } = applyCalibrationEscalation(db, industryId, auth.auth.userId, rationale, new Date().toISOString());
    return ok(escalation, 200);
  } catch (err: unknown) {
    if (err instanceof EscalationError) {
      if (err.code === "already_converged") return ok({ code: err.code, message: err.message }, 409);
      return badRequest(err.code, err.message);
    }
    throw err;
  }
}
