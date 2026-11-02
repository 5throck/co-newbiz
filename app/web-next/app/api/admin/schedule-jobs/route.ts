// Admin schedule-jobs list (design 2026-10-29-scheduled-jobs-design §4.1/§4.3 — the pulled-forward
// list-and-edit screen). Each row adds the migration-0183 registry fields, `next_run_at` computed
// by the shared cron module, and `last_run` from the latest job_run. The human cron preview is a
// frontend (cronstrue) concern — see lib/schedule/job-rows.ts.
//
// POST (ADR-0189 P7, §4.1 create row, §5 last bullet): creates a schedule_job row for a REGISTERED
// handler key only — `job_key` must be in the scheduler handler registry (listJobHandlers); a
// free-text command field would be remote code execution from the admin console, so this guard is
// the RCE boundary and the response names the rejected key. The registry import is metadata read
// at create time (key/display name/description/defaults), never executed handler code — the same
// posture as the seed route. Defaults come from the registry entry (cron/timeout/retries/display
// name/description); `enabled` defaults to FALSE (create-then-enable is the safe flow, matching
// the D3 seed invariant — enabling stays a separate, deliberate PATCH). Validation reuses the
// PATCH rules via lib/schedule/job-validate.ts. Audited schedule_job_create with the full row in
// the target (ADR-0012). Responds 201 with the GET-shaped row (job-rows serializer).
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { listJobHandlers } from "../../../../../../scripts/co-newbiz/jobs/index.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { fetchScheduleJobRow, fetchScheduleJobRows } from "../../../../lib/schedule/job-rows.ts";
import { checkCronForJob, isValidMaxRetries, isValidTimeoutSec } from "../../../../lib/schedule/job-validate.ts";
import { validateCron } from "../../../../lib/schedule/cron.ts";
import { badRequest, fail, ok } from "../../../../lib/envelope.ts";

const CREATE_FIELDS = new Set(["job_key", "cron_expr", "timeout_sec", "max_retries", "enabled"]);

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const db = getDb();
  return ok(fetchScheduleJobRows(db, new Date()));
}

interface CreateBody {
  job_key?: unknown;
  cron_expr?: unknown;
  timeout_sec?: unknown;
  max_retries?: unknown;
  enabled?: unknown;
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const body = (await request.json().catch(() => null)) as CreateBody | null;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("invalid_request", "request body must be a JSON object.");
  }
  const unknownFields = Object.keys(body).filter((k) => !CREATE_FIELDS.has(k));
  if (unknownFields.length > 0) {
    return badRequest("invalid_request", `unknown field(s): ${unknownFields.join(", ")}.`);
  }
  if (typeof body.job_key !== "string" || body.job_key.trim() === "") {
    return badRequest("invalid_request", "job_key (non-empty string) is required.");
  }
  const jobKey = body.job_key;

  // §5 RCE guard: only registered handler keys are acceptable, and the error names the key.
  const handler = listJobHandlers().find((h) => h.key === jobKey);
  if (!handler) {
    return badRequest(
      "unregistered_handler",
      `job_key '${jobKey}' has no registered scheduler handler; create accepts only registered handler keys (no free-text commands).`,
    );
  }

  // Explicitly supplied fields reuse the PATCH validation (shared module); omitted fields fall
  // back to the registry entry. Registry defaults are not subject to the 60 s timeout floor —
  // e.g. notify.deliver legitimately runs with a 50 s timeout (§13.2).
  const now = new Date();
  let cronExpr: string;
  if ("cron_expr" in body) {
    const check = checkCronForJob(body.cron_expr, jobKey, now);
    if (!check.ok) return badRequest(check.code, check.message);
    cronExpr = check.cron_expr;
  } else {
    const check = validateCron(handler.defaultCron); // registry defaults are validated like seed does
    if (!check.ok) {
      return fail(500, "handler_default_invalid", `registered default cron for ${jobKey} is invalid: ${check.error}`);
    }
    cronExpr = handler.defaultCron;
  }
  let timeoutSec: number;
  if ("timeout_sec" in body) {
    if (!isValidTimeoutSec(body.timeout_sec)) {
      return badRequest("invalid_request", "timeout_sec must be an integer between 60 and 7200 (1–120 minutes).");
    }
    timeoutSec = body.timeout_sec;
  } else {
    timeoutSec = handler.timeoutSec;
  }
  let maxRetries: number;
  if ("max_retries" in body) {
    if (!isValidMaxRetries(body.max_retries)) {
      return badRequest("invalid_request", "max_retries must be an integer between 0 and 5.");
    }
    maxRetries = body.max_retries;
  } else {
    maxRetries = handler.maxRetries;
  }
  // enabled defaults to 0: create-then-enable is the safe flow (D3 posture). An explicit boolean
  // is honored — enabling is admin-gated and audited either way.
  if ("enabled" in body && typeof body.enabled !== "boolean") {
    return badRequest("invalid_request", "enabled must be a boolean.");
  }
  const enabledNum = body.enabled === true ? 1 : 0;

  const db = getDb();
  if (db.query("SELECT 1 FROM schedule_job WHERE job_key = ?").get(jobKey)) {
    return fail(409, "job_key_exists", `a schedule_job row for '${jobKey}' already exists.`);
  }
  db.run(
    `INSERT INTO schedule_job (id, job_key, cron_expr, enabled, created_at, display_name, description, timeout_sec, max_retries, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    [
      ulid(),
      jobKey,
      cronExpr,
      enabledNum,
      now.toISOString(),
      handler.displayName,
      handler.description,
      timeoutSec,
      maxRetries,
    ],
  );

  // ADR-0012: the target carries the full created row (there is no "before").
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "schedule_job_create",
    target: `${jobKey}: cron ${cronExpr}; timeout ${timeoutSec}; retries ${maxRetries}; enabled ${enabledNum}`,
    now: now.toISOString(),
  });
  return ok(fetchScheduleJobRow(db, jobKey, now), 201);
}
