// 관리자 — 스케줄 작업 실행 이력 (최근 50건, ADR-0091 CRUD 보강).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ jobKey: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const { jobKey } = await params;
  const db = getDb();
  const exists = db.query("SELECT 1 FROM schedule_job WHERE job_key = ?").get(jobKey);
  if (!exists) return notFound();
  const runs = db.query(
    `SELECT started_at, finished_at, status, error
     FROM job_run WHERE job_key = ? ORDER BY started_at DESC LIMIT 50`,
  ).all(jobKey) as Array<{ started_at: string; finished_at: string | null; status: string; error: string | null }>;
  const success = runs.filter((r) => r.status === "success").length;
  return ok({ job_key: jobKey, runs, success_rate: runs.length ? Math.round((success / runs.length) * 100) : null }, 200, { count: runs.length });
}
