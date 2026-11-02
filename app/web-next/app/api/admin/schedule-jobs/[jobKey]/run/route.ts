// POST /api/admin/schedule-jobs/[jobKey]/run — the "Run now" action (ADR-0189 P7; design
// 2026-10-29-scheduled-jobs-design §4.1 run row, §4.2 confirm-then-poll flow).
//
// NO in-process execution (§2.2/§2.3, ADR-0019): the route only enqueues a schedule_job_request
// row that the next tick claims and spawns. This module's imports are the DB handle, audit,
// auth, the envelope, and scheduler-core's `enqueueRequest` — a pure DB INSERT. No jobs/ handler
// module is imported (registry or otherwise): the §9 assertion "run-now never executes
// in-process" is enforced by the schedule-jobs-api test that scans this file's imports.
//
// Semantics (documented):
// - 404 for an unknown job_key; any existing schedule_job row is eligible regardless of
//   `enabled` — a manual run is an explicit admin action and the tick dispatches manual requests
//   without an enabled check (schedule-tick.ts claim loop), matching run-job's semantics.
// - Duplicate cap: scheduler-core's claim loop would stack N queued rows into N runs, so a
//   second request while a request for this job is still 'queued' REUSES that row instead of
//   stacking a duplicate (response `reused: true`).
// - 202-style response `{request_id, job_key, reused, note}` — the UI polls
//   GET /api/admin/schedule-jobs/[jobKey]/runs until a job_run appears for the request
//   (schedule_job_request.job_run_id is linked by the tick's runner path).
// - Audited `schedule_job_run_requested` with target `<jobKey>` (ADR-0012).
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { enqueueRequest } from "../../../../../../../../scripts/co-newbiz/scheduler-core.ts";
import { authenticate, requireAdmin } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";

const PICKUP_NOTE =
  "queued for the next scheduler tick (picked up within 60 s); poll GET /api/admin/schedule-jobs/{jobKey}/runs until a job_run appears for this request.";

export async function POST(request: Request, { params }: { params: Promise<{ jobKey: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const { jobKey } = await params;
  const db = getDb();
  const job = db.query("SELECT job_key FROM schedule_job WHERE job_key = ?").get(jobKey);
  if (!job) return notFound();

  const now = new Date();
  const queued = db
    .query(
      "SELECT id FROM schedule_job_request WHERE job_key = ? AND status = 'queued' ORDER BY requested_at DESC, id DESC LIMIT 1",
    )
    .get(jobKey) as { id: string } | null;

  let requestId: string;
  let reused: boolean;
  if (queued) {
    // Duplicate cap: reuse the still-queued row rather than stacking another (the claim loop
    // would otherwise run both).
    requestId = queued.id;
    reused = true;
  } else {
    requestId = enqueueRequest(db, jobKey, auth.auth.userId, now);
    reused = false;
  }

  appendAudit(db, {
    actor: auth.auth.userId,
    action: "schedule_job_run_requested",
    target: jobKey,
    now: now.toISOString(),
  });
  return ok({ request_id: requestId, job_key: jobKey, reused, note: PICKUP_NOTE }, 202);
}
