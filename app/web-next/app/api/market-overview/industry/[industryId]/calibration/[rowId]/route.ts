// 드라이버 귀인 제안 수용/기각 — 수용은 사람의 행위(경계 #2)이며, 수용된
// 드라이버는 다음 재분석의 프롬프트 제약으로 주입된다(수렴 루프의 닫는 고리).
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { decideCalibrationDriver } from "../../../../../../../lib/market-calibration.ts";

export async function POST(request: Request, { params }: { params: Promise<{ industryId: string; rowId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "보정 제안 결정은 analyst 역할 이상이어야 합니다.");
  const { industryId, rowId } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "accept" && body?.action !== "dismiss") {
    return badRequest("invalid_action", "action은 accept | dismiss 중 하나입니다.");
  }
  const db = getDb();
  const row = db.query("SELECT industry_id FROM industry_driver_calibration WHERE id = ?").get(rowId) as { industry_id: string } | undefined;
  if (!row || row.industry_id !== industryId) return notFound();
  const updated = decideCalibrationDriver(db, rowId, body.action, auth.auth.userId);
  return ok(updated);
}
