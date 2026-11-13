// 드라이버 귀인 제안 수용/기각 — 수용은 사람의 행위(경계 #2)이며, 수용된
// 드라이버는 다음 재분석의 프롬프트 제약으로 주입된다(수렴 루프의 닫는 고리).
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { decideCalibrationDriver, EXCLUSION_PROPOSAL_BY } from "../../../../../../../lib/market-calibration.ts";

export async function POST(request: Request, { params }: { params: Promise<{ industryId: string; rowId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Calibration-proposal decisions require the analyst role or higher.",
  });
  if (denied) return denied;
  const { industryId, rowId } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "accept" && body?.action !== "dismiss") {
    return badRequest("invalid_action", "action must be one of: accept | dismiss.");
  }
  const db = getDb();
  const row = db.query("SELECT industry_id, proposed_by FROM industry_driver_calibration WHERE id = ?").get(rowId) as
    | { industry_id: string; proposed_by: string }
    | undefined;
  if (!row || row.industry_id !== industryId) return notFound();
  // 제외 제안(amendment 2026-11-13b)은 dismiss만 허용된다 — dismiss 확정이 곧
  // "그 드라이버를 수용 목록에서 뺀다"는 사람의 결정이다. accept는 행 종류의
  // 의미를 뒤집으므로(제외 제안이 드라이버 목록에 재합류) 400으로 막는다.
  if (body.action === "accept" && row.proposed_by === EXCLUSION_PROPOSAL_BY) {
    return badRequest(
      "exclusion_accept_forbidden",
      "An exclusion proposal is dismiss-only — confirming the exclusion records as dismiss.",
    );
  }
  const updated = decideCalibrationDriver(db, rowId, body.action, auth.auth.userId);
  return ok(updated);
}
