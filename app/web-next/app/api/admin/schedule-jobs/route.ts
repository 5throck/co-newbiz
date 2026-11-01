// Admin schedule-jobs list (design 2026-10-29-scheduled-jobs-design §4.1/§4.3 — the pulled-forward
// list-and-edit screen). Each row adds the migration-0183 registry fields, `next_run_at` computed
// by the shared cron module, and `last_run` from the latest job_run. The human cron preview is a
// frontend (cronstrue) concern — see lib/schedule/job-rows.ts.
import { getDb } from "../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { fetchScheduleJobRows } from "../../../../lib/schedule/job-rows.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const db = getDb();
  return ok(fetchScheduleJobRows(db, new Date()));
}
