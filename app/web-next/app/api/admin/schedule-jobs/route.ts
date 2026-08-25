// Port of app/server/admin.ts GET /api/admin/schedule-jobs
import { getDb } from "../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const db = getDb();
  const jobs = db
    .query("SELECT id, job_key, cron_expr, enabled, created_at FROM schedule_job ORDER BY job_key")
    .all() as { id: string; job_key: string; cron_expr: string; enabled: number; created_at: string }[];
  const lastRuns = db
    .query(
      `SELECT job_key, status, finished_at, error FROM job_run
       WHERE id IN (SELECT MAX(id) FROM job_run GROUP BY job_key)`,
    )
    .all() as { job_key: string; status: string; finished_at: string | null; error: string | null }[];
  const byKey = new Map(lastRuns.map((r) => [r.job_key, r]));
  return ok(jobs.map((j) => ({ ...j, last_run: byKey.get(j.job_key) ?? null })));
}
