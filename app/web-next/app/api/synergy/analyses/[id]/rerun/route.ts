// Synergy analysis rerun — reuses the existing row (ADR-0094).
// The old UI "rerun" always created a NEW analysis row because the list API did
// not expose member_id/group_id; rerunning now re-runs the same target in place
// and the pipeline appends a new synergy_version (append-only). Legacy rows
// (target_type NULL — the deleted md_company registration path) are refused.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "시너지 재분석은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const db = getDb();
  const row = db
    .query("SELECT id, status, target_type, member_id, group_id FROM synergy_analysis WHERE id = ?")
    .get(id) as { id: string; status: string; target_type: "affiliate" | "group" | null; member_id: string | null; group_id: string | null } | null;
  if (!row) return notFound();
  if (!row.target_type) {
    return badRequest("legacy_target", "레거시(회사 직접 등록) 분석은 재분석할 수 없습니다 — 그룹/계열사 레지스트리 대상으로 새 분석을 생성하세요.");
  }
  const hasProfile = row.target_type === "affiliate"
    ? !!db.query("SELECT 1 FROM company_profile_version WHERE member_id = ? LIMIT 1").get(row.member_id)
    : !!db.query(
        "SELECT 1 FROM company_group_member m WHERE m.group_id = ? AND EXISTS (SELECT 1 FROM company_profile_version v WHERE v.member_id = m.id) LIMIT 1",
      ).get(row.group_id);
  if (!hasProfile) return badRequest("profile_required", "프로파일이 없습니다 — 그룹/계열사 분석 화면에서 먼저 분석하세요.");

  const now = new Date().toISOString();
  // ADR-0132 — 이미 완료된 분석의 재분석은 status/completed_at을 건드리지
  // 않는다(ADR-0131과 동일 패턴). 진행 중에도 이전 완료 버전이 그대로
  // 조회되고, LLM 장애로 저하되면 파이프라인이 새 버전을 만들지 않는다.
  const protectPriorVersion = row.status === "completed";
  if (protectPriorVersion) {
    db.run("UPDATE synergy_analysis SET rerun_in_progress = 1, error_message = NULL WHERE id = ?", [id]);
  } else {
    db.run("UPDATE synergy_analysis SET status = 'in_progress', current_step = 0, completed_at = NULL WHERE id = ?", [id]);
  }
  appendAudit(db, { actor: ctx.userId, action: "synergy_analysis.rerun", target: id, now });

  const { runSynergyPipeline } = await import("../../../../../../lib/synergy-pipeline.ts");
  void runSynergyPipeline(db, id).catch((err) => {
    console.error(`synergy rerun ${id} failed:`, err);
    if (protectPriorVersion) {
      db.run("UPDATE synergy_analysis SET rerun_in_progress = 0, error_message = ? WHERE id = ?", [err instanceof Error ? err.message.slice(0, 300) : String(err), id]);
    }
  });
  return ok({ analysis_id: id, reused: true, rerunInProgress: protectPriorVersion }, 200, { status: protectPriorVersion ? "completed" : "in_progress" });
}
