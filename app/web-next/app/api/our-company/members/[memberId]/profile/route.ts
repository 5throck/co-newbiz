// 계열사 프로파일 조회 — 최신 payload + 버전 이력 (분석 완료 폴링용).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { loadLatestProfile, getProfileJobStatus } from "../../../../../../lib/company-profile-pipeline.ts";

export async function GET(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
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
  const profile = loadLatestProfile(db, { kind: "member", id: memberId });
  // escalatedCagrPct 읽기 시점 보강은 제거되었다 (design 2026-11-13-calibration-
  // loop-convergence §3.2) — 결정론 스케일링 에스컬레이션 삭제로 보강할 값이
  // 없다. 저장 페이로드의 bottom-up CAGR을 그대로 노출한다.

  // version 유무만으로는 "실행 중"과 "실패"를 구분할 수 없다 — in-process 작업 상태를 반영한다.
  const job = getProfileJobStatus({ kind: "member", id: memberId });
  const status = profile ? "completed" : job?.status === "failed" ? "failed" : "in_progress";

  return ok(
    {
      member,
      profile,
      versions,
      status,
      ...(status === "failed" ? { error: job?.error } : {}),
    },
    200,
  );
}
