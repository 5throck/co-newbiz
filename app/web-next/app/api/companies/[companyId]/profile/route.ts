// GET /api/companies/[companyId]/profile — 회사(md_company) LLM 프로파일 조회
// (그룹/계열사 화면의 계열사 프로파일과 동일 파이프라인, 일반화 2026-09-15,
// 사용자 요청 "일반화하는게 바람직할 듯 해"). 브라운필드 후보 상세화면 등
// company_group_member에 속하지 않는 회사에서 쓴다 — 최신 payload + 버전 이력.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { loadLatestProfile, getProfileJobStatus } from "../../../../../lib/company-profile-pipeline.ts";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { companyId } = await params;
  const db = getDb();
  const company = db.query("SELECT id, name_ko, dart_corp_code FROM md_company WHERE id = ?").get(companyId) as
    | { id: string; name_ko: string; dart_corp_code: string | null }
    | null;
  if (!company) return notFound();

  const versions = db
    .query(
      "SELECT version_no, source_ref, created_by, created_at FROM company_profile_version WHERE company_id = ? ORDER BY version_no DESC",
    )
    .all(companyId) as Array<{ version_no: number; source_ref: string | null; created_by: string; created_at: string }>;
  const profile = loadLatestProfile(db, { kind: "company", id: companyId });

  // version 유무만으로는 "실행 중"과 "실패"를 구분할 수 없다 — in-process 작업 상태를 반영한다.
  // 계열사 화면(analyze가 등록 직후 자동 실행됨)과 달리, 브라운필드 후보는
  // 분석을 명시적으로 실행하기 전까지는 job도 version도 없다 — 이 경우
  // "in_progress"가 아니라 "not_started"로 구분해 폴링 루프를 막는다.
  const job = getProfileJobStatus({ kind: "company", id: companyId });
  const status = profile ? "completed" : job?.status === "failed" ? "failed" : job?.status === "running" ? "in_progress" : "not_started";

  return ok(
    {
      company,
      profile,
      versions,
      status,
      ...(status === "failed" ? { error: job?.error } : {}),
    },
    200,
  );
}
