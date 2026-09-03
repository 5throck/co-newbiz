// S7 — 제외 (Exclusion Reasons 기록).
import { getDb } from "../../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";

const now = () => new Date().toISOString();

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "제외는 analyst 역할 이상이어야 합니다.");
  const { oppId, targetId } = await params;
  const body = (await request.json().catch(() => null)) as { reason?: string; gate_evaluation_id?: string } | null;
  const reason = body?.reason?.trim();
  if (!reason) return badRequest("invalid_request", "제외 사유(reason)는 필수입니다.");
  const db = getDb();
  // ADR-0097 back-compat: optional provenance link to the S6/S7 committee
  // deliberation that proposed this exclusion (0066 nullable column).
  const gateEvaluationId = body?.gate_evaluation_id?.trim() || null;
  if (gateEvaluationId && !db.query("SELECT id FROM gate_evaluation WHERE id = ?").get(gateEvaluationId)) {
    return badRequest("invalid_request", "gate_evaluation_id가 존재하지 않습니다 — 위원회 세션의 gate_evaluation을 확인하세요.");
  }
  const existing = db
    .query("SELECT id FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(targetId, oppId) as { id: string } | undefined;
  if (!existing) return notFound();
  db.run("UPDATE brownfield_target SET status = 'excluded', exclusion_reason = ?, rank = NULL, gate_evaluation_id = COALESCE(?, gate_evaluation_id), updated_at = ? WHERE id = ?", [reason, gateEvaluationId, now(), targetId]);
  return ok(db.query("SELECT * FROM brownfield_target WHERE id = ?").get(targetId), 200);
}
