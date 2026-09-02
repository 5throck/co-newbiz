// 시스템 대시보드 집계 — 관리 전용 (ADR-0091). 프로젝트 데이터는 포함하지 않는다
// (api-spec §8: admin 엔드포인트는 프로젝트 가시성을 부여하지 않는다; 기회 퍼널은
//  개인 식별 없는 상태 집계만 반환).
import { getDb } from "../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const db = getDb();

  const auditDaily = db.query(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
     FROM audit_log WHERE created_at >= date('now', '-29 days')
     GROUP BY day ORDER BY day`,
  ).all() as Array<{ day: string; count: number }>;

  const usersByRole = db.query(
    "SELECT role, COUNT(*) AS count FROM app_user GROUP BY role",
  ).all() as Array<{ role: string; count: number }>;

  const usersByStatus = db.query(
    "SELECT status, COUNT(*) AS count FROM app_user GROUP BY status",
  ).all() as Array<{ status: string; count: number }>;

  const tokens = db.query(
    `SELECT
       SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked
     FROM api_token`,
  ).get() as { active: number | null; revoked: number | null };

  const jobRuns = db.query(
    `SELECT job_key,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM job_run GROUP BY job_key ORDER BY job_key`,
  ).all() as Array<{ job_key: string; success: number; failed: number }>;

  const opportunityFunnel = db.query(
    "SELECT status, COUNT(*) AS count FROM opportunity GROUP BY status",
  ).all() as Array<{ status: string; count: number }>;

  return ok({
    auditDaily,
    usersByRole,
    usersByStatus,
    tokens: { active: tokens.active ?? 0, revoked: tokens.revoked ?? 0 },
    jobRuns,
    opportunityFunnel,
  });
}
