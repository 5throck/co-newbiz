// One synergy analysis: status (for the "분석 중" polling) + versions with
// parsed payloads. GET is read-only for any authenticated role.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();

  const analysis = db
    .query(
      `SELECT sa.id, sa.status, sa.current_step, sa.created_by, sa.created_at, sa.completed_at, sa.source_ref,
              c.id AS company_id, c.name_ko AS company_name, c.dart_corp_code,
              ac.name_ko AS acquirer_name,
              sa.target_type, sa.opportunity_id, o.name AS opportunity_name,
              m.company_name AS member_name, g.name AS group_name
       FROM synergy_analysis sa
       JOIN md_company c ON c.id = sa.company_id
       LEFT JOIN md_company ac ON ac.id = sa.acquirer_company_id
       LEFT JOIN opportunity o ON o.id = sa.opportunity_id
       LEFT JOIN company_group_member m ON m.id = sa.member_id
       LEFT JOIN company_group g ON g.id = sa.group_id
       WHERE sa.id = ?`,
    )
    .get(id) as
    | { id: string; status: string; current_step: number; created_by: string; created_at: string; completed_at: string | null; source_ref: string | null; company_id: string; company_name: string; dart_corp_code: string | null; acquirer_name: string | null }
    | null;
  if (!analysis) return notFound();

  const versions = db
    .query(
      `SELECT version_no, payload, changelog, created_by, created_at
       FROM synergy_version WHERE analysis_id = ? ORDER BY version_no DESC`,
    )
    .all(id) as Array<{ version_no: number; payload: string; changelog: string | null; created_by: string; created_at: string }>;
  const parsed = versions.map((v) => {
    try {
      return { ...v, payload: JSON.parse(v.payload) as unknown };
    } catch {
      return { ...v, payload: null };
    }
  });

  return ok({ ...analysis, versions: parsed }, 200, { status: analysis.status, versions: parsed.length });
}

// DELETE — 시너지 분석 삭제 (버전 전체). 회사 마스터(md_company)는 유지된다.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "시너지 분석 삭제는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const db = getDb();
  const analysis = db.query("SELECT id FROM synergy_analysis WHERE id = ?").get(id) as { id: string } | null;
  if (!analysis) return notFound();
  db.transaction(() => {
    db.run("DELETE FROM synergy_version WHERE analysis_id = ?", [id]);
    db.run("DELETE FROM synergy_analysis WHERE id = ?", [id]);
  })();
  appendAudit(db, { actor: ctx.userId, action: "synergy.analysis_delete", target: id, now: new Date().toISOString() });
  return ok({ deleted: id }, 200);
}
