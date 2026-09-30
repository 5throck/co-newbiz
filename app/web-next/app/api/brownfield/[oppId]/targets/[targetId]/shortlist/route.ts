// S7 — Short List 승격 (재무·기술 평가 전 항목 판정 완료가 조건 — 2026-09-15 사용자 결정: knock-out 게이트 대체).
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { resolveOrCreateCompany, type TargetRow } from "../../../../../../../lib/brownfield-targets.ts";
import { computeEvalScore, targetEvalStates } from "../../../../../../../lib/brownfield-eval-criteria.ts";

const now = () => new Date().toISOString();

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Short List 승격은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
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
  // 승격 조건(2026-09-15 사용자 결정): chk-target-screening(t-01~09) knock-out이
  // 아니라 재무·기술 평가(ADR-0139)의 전 항목 판정 완료로 한다 — 랭킹이 이
  // 평가 점수 기준이므로 승격도 같은 기준을 따른다.
  const evalItems = targetEvalStates(oppId, targetId, auth.auth.userId);
  const scores = computeEvalScore(evalItems);
  const incomplete = (["financial", "technical"] as const).filter(
    (c) => scores[c].totalWeight === 0 || scores[c].scoredWeight !== scores[c].totalWeight,
  );
  if (incomplete.length > 0) {
    return badRequest(
      "eval_pending",
      incomplete
        .map((c) => (scores[c].totalWeight === 0
          ? (c === "technical" ? "기술 평가 항목 없음 — S3에서 필요 역량을 먼저 정의하세요" : "재무 평가 항목 없음")
          : `${c === "technical" ? "기술" : "재무"} 평가 미판정 가중치 ${scores[c].totalWeight - scores[c].scoredWeight}`))
        .join(" · "),
    );
  }
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
