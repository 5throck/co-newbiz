// S7 — Short List 승격 (knock-out 통과 + 필수 항목 판정 완료가 조건).
import { ulid } from "../../../../../../../../../db/lib/ulid.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { screeningSummary, type TargetRow } from "../../../../../../../lib/brownfield-targets.ts";

const now = () => new Date().toISOString();

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "Short List 승격은 analyst 역할 이상이어야 합니다.");
  const { oppId, targetId } = await params;
  const body = (await request.json().catch(() => null)) as { rank?: number; universe_note?: string } | null;
  const db = getDb();
  const target = db
    .query("SELECT * FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(targetId, oppId) as unknown as TargetRow | undefined;
  if (!target) return notFound();
  const summary = screeningSummary(target);
  if (summary.anyKnockOutFail) return badRequest("knock_out_fail", "knock-out 항목(t-01~t-05) 중 fail이 있습니다 — 제외 사유를 기록하세요.");
  if (summary.mandatoryOpen.length > 0) return badRequest("mandatory_pending", `필수 항목 미판정: ${summary.mandatoryOpen.join(", ")}`);
  const row = db.query("SELECT COALESCE(MAX(rank),0) m FROM brownfield_target WHERE opportunity_id = ? AND status='shortlisted'").get(oppId) as { m: number };
  const rank = body?.rank ?? row.m + 1;
  db.run("UPDATE brownfield_target SET status = 'shortlisted', rank = ?, exclusion_reason = NULL, updated_at = ? WHERE id = ?", [rank, now(), targetId]);

  // S7 → 시너지 정합성 자동 연결 — 대상 회사를 md_company에 등록/재사용하고
  // synergy_analysis를 in_progress로 준비해 시너지 정합성 화면에서 바로 심층 분석이 가능하게 한다.
  let company_id: string | null = null;
  const mc = db.query("SELECT id FROM md_company WHERE name_ko = ?").get(target.company_name) as { id: string } | undefined;
  if (mc) {
    company_id = mc.id;
    if (target.dart_corp_code) db.run("UPDATE md_company SET dart_corp_code = ? WHERE id = ?", [target.dart_corp_code, mc.id]);
  } else {
    company_id = ulid();
    db.run("INSERT INTO md_company (id, dart_corp_code, name_ko, created_at) VALUES (?,?,?,?)", [company_id, target.dart_corp_code, target.company_name, now()]);
  }
  let synergyLinked = false;
  const syn = db
    .query("SELECT id FROM synergy_analysis WHERE company_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(company_id) as { id: string } | undefined;
  if (syn) {
    db.run("UPDATE synergy_analysis SET status = 'in_progress', current_step = 0, completed_at = NULL WHERE id = ?", [syn.id]);
    synergyLinked = true;
  }

  return ok({ ...db.query("SELECT * FROM brownfield_target WHERE id = ?").get(targetId), company_id, synergy_linked: synergyLinked }, 200);
}
