// 계열사 프로파일 조회 — 최신 payload + 버전 이력 (분석 완료 폴링용).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { loadLatestProfile } from "../../../../../../lib/company-profile-pipeline.ts";

export async function GET(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { memberId } = await params;
  const db = getDb();
  const member = db
    .query("SELECT id, company_name, dart_corp_code FROM company_group_member WHERE id = ?")
    .get(memberId) as { id: string; company_name: string; dart_corp_code: string | null } | null;
  if (!member) return notFound();

  const versions = db
    .query(
      "SELECT version_no, source_ref, created_by, created_at FROM company_profile_version WHERE member_id = ? ORDER BY version_no DESC",
    )
    .all(memberId) as Array<{ version_no: number; source_ref: string | null; created_by: string; created_at: string }>;
  const profile = loadLatestProfile(db, memberId);

  return ok({ member, profile, versions, status: profile ? "completed" : "in_progress" }, 200);
}
