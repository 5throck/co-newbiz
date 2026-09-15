// S7 — Short List 승격 (knock-out 통과 + 필수 항목 판정 완료가 조건).
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { screeningSummary, resolveOrCreateCompany, type TargetRow } from "../../../../../../../lib/brownfield-targets.ts";

const now = () => new Date().toISOString();

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "Short List 승격은 analyst 역할 이상이어야 합니다.");
  const { oppId, targetId } = await params;
  const body = (await request.json().catch(() => null)) as { rank?: number; universe_note?: string; gate_evaluation_id?: string } | null;
  const db = getDb();
  // ADR-0097 back-compat: optional provenance link to the S6/S7 committee
  // deliberation that proposed this promotion (0066 nullable column).
  const gateEvaluationId = body?.gate_evaluation_id?.trim() || null;
  if (gateEvaluationId && !db.query("SELECT id FROM gate_evaluation WHERE id = ?").get(gateEvaluationId)) {
    return badRequest("invalid_request", "gate_evaluation_id가 존재하지 않습니다 — 위원회 세션의 gate_evaluation을 확인하세요.");
  }
  const target = db
    .query("SELECT * FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(targetId, oppId) as unknown as TargetRow | undefined;
  if (!target) return notFound();
  const summary = screeningSummary(target);
  if (summary.anyKnockOutFail) return badRequest("knock_out_fail", "knock-out 항목(t-01~t-05) 중 fail이 있습니다 — 제외 사유를 기록하세요.");
  if (summary.mandatoryOpen.length > 0) return badRequest("mandatory_pending", `필수 항목 미판정: ${summary.mandatoryOpen.join(", ")}`);
  const row = db.query("SELECT COALESCE(MAX(rank),0) m FROM brownfield_target WHERE opportunity_id = ? AND status='shortlisted'").get(oppId) as { m: number };
  const rank = body?.rank ?? row.m + 1;
  db.run("UPDATE brownfield_target SET status = 'shortlisted', rank = ?, exclusion_reason = NULL, gate_evaluation_id = COALESCE(?, gate_evaluation_id), updated_at = ? WHERE id = ?", [rank, gateEvaluationId, now(), targetId]);

  // S7 → 시너지 정합성 자동 연결 — 대상 회사를 md_company에 등록/재사용하고
  // synergy_analysis를 in_progress로 준비해 시너지 정합성 화면에서 바로 심층 분석이 가능하게 한다.
  // (Long List 등록 시점에 이미 createTarget()이 md_company를 확보해 두므로,
  // 여기서는 재사용만 함 — 멱등.)
  const company_id = resolveOrCreateCompany(db, target.company_name, target.dart_corp_code);
  let synergyLinked = false;
  const syn = db
    .query("SELECT id FROM synergy_analysis WHERE company_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(company_id) as { id: string } | undefined;
  if (syn) {
    db.run("UPDATE synergy_analysis SET status = 'in_progress', current_step = 0, completed_at = NULL WHERE id = ?", [syn.id]);
    synergyLinked = true;
  }

  appendAudit(db, { actor: auth.auth.userId, action: "brownfield_target.shortlist", target: `${oppId}:${targetId}:rank${rank}`, now: new Date().toISOString() });

  return ok({ ...db.query("SELECT * FROM brownfield_target WHERE id = ?").get(targetId), company_id, synergy_linked: synergyLinked }, 200);
}
