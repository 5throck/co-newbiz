// Admin schedule-jobs per-job routes (design 2026-10-29-scheduled-jobs-design §4.1/§4.3).
// PATCH is the canonical partial update (cron_expr / timeout_sec / max_retries / enabled, the
// design names PATCH); PUT below is the legacy enable-only toggle kept byte-compatible — the UI
// has migrated (components/admin/console/useAdminActions.ts toggleJob → api.patch), so PUT has
// no in-repo caller left and exists only for external compatibility. New callers must use PATCH.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { fetchScheduleJobRow } from "../../../../../lib/schedule/job-rows.ts";
import { nextFireTimes, validateCron } from "../../../../../lib/schedule/cron.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";

/** Crons must not fire more often than every 5 minutes (§4.1 interval floor) except these keys. */
const INTERVAL_FLOOR_MS = 300_000;
// §13.2: notify.deliver is INTENTIONALLY `* * * * *` (one fire per tick — delivery worker);
// watch.evaluate is likewise exempt (flagged in the P3 Row 0 drift notes, never had a route to
// live in until this PATCH).
const INTERVAL_FLOOR_EXEMPT_KEYS = new Set(["watch.evaluate", "notify.deliver"]);

const UPDATE_FIELDS = new Set(["cron_expr", "timeout_sec", "max_retries", "enabled"]);

/** Fires the next two times and requires >= 300 s between them — the honest minimal check with the shared parser. */
function cronTooFrequent(expr: string, now: Date): boolean {
  const fires = nextFireTimes(expr, now, 2);
  return fires.length === 2 && fires[1].getTime() - fires[0].getTime() < INTERVAL_FLOOR_MS;
}

interface UpdateBody {
  cron_expr?: unknown;
  timeout_sec?: unknown;
  max_retries?: unknown;
  enabled?: unknown;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ jobKey: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const { jobKey } = await params;
  const body = (await request.json().catch(() => null)) as UpdateBody | null;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("invalid_request", "request body must be a JSON object.");
  }
  const unknownFields = Object.keys(body).filter((k) => !UPDATE_FIELDS.has(k));
  if (unknownFields.length > 0) {
    return badRequest("invalid_request", `unknown field(s): ${unknownFields.join(", ")}.`);
  }
  const requested = Object.keys(body).filter((k) => UPDATE_FIELDS.has(k));
  if (requested.length === 0) {
    return badRequest("invalid_request", "at least one of cron_expr, timeout_sec, max_retries, enabled is required.");
  }
  // Type/range validation (all server-side, §4.3 floor: timeout 1–120 min stored as seconds, retries 0–5).
  if ("timeout_sec" in body) {
    const v = body.timeout_sec;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 60 || v > 7200) {
      return badRequest("invalid_request", "timeout_sec must be an integer between 60 and 7200 (1–120 minutes).");
    }
  }
  if ("max_retries" in body) {
    const v = body.max_retries;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 5) {
      return badRequest("invalid_request", "max_retries must be an integer between 0 and 5.");
    }
  }
  if ("enabled" in body && typeof body.enabled !== "boolean") {
    return badRequest("invalid_request", "enabled must be a boolean.");
  }
  const db = getDb();
  const existing = db
    .query(
      "SELECT id, job_key, cron_expr, enabled, created_at, display_name, description, timeout_sec, max_retries, updated_at, updated_by FROM schedule_job WHERE job_key = ?",
    )
    .get(jobKey) as {
    id: string;
    job_key: string;
    cron_expr: string;
    enabled: number;
    timeout_sec: number;
    max_retries: number;
  } | null;
  if (!existing) return notFound();

  const now = new Date();
  const sets: string[] = [];
  const values: (string | number)[] = [];
  let cronExpr: string | null = null;
  if ("cron_expr" in body) {
    const expr = body.cron_expr;
    if (typeof expr !== "string") {
      return badRequest("invalid_cron", "cron_expr must be a string.");
    }
    const check = validateCron(expr); // same parser the tick uses — §4.1 one-parser mandate
    if (!check.ok) {
      return badRequest("invalid_cron", `invalid cron expression: ${check.error}`);
    }
    if (!INTERVAL_FLOOR_EXEMPT_KEYS.has(jobKey) && cronTooFrequent(expr, now)) {
      return badRequest("cron_too_frequent", "schedule interval must be at least 5 minutes.");
    }
    cronExpr = expr;
    sets.push("cron_expr = ?");
    values.push(expr);
  }
  if ("timeout_sec" in body) {
    sets.push("timeout_sec = ?");
    values.push(body.timeout_sec as number);
  }
  if ("max_retries" in body) {
    sets.push("max_retries = ?");
    values.push(body.max_retries as number);
  }
  let enabledNum: number | null = null;
  if ("enabled" in body) {
    enabledNum = body.enabled ? 1 : 0;
    sets.push("enabled = ?");
    values.push(enabledNum);
  }
  sets.push("updated_at = ?", "updated_by = ?");
  values.push(now.toISOString(), auth.auth.userId);
  db.run(`UPDATE schedule_job SET ${sets.join(", ")} WHERE job_key = ?`, [...values, jobKey]);

  // ADR-0012: before/after for every changed field; unchanged fields are omitted from the target.
  const parts: string[] = [];
  if (cronExpr !== null) parts.push(`cron ${existing.cron_expr}→${cronExpr}`);
  if ("timeout_sec" in body) parts.push(`timeout ${existing.timeout_sec}→${body.timeout_sec}`);
  if ("max_retries" in body) parts.push(`retries ${existing.max_retries}→${body.max_retries}`);
  if (enabledNum !== null) parts.push(`enabled ${existing.enabled}→${enabledNum}`);
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "schedule_job_update",
    target: `${jobKey}: ${parts.join("; ")}`,
    now: now.toISOString(),
  });
  return ok(fetchScheduleJobRow(db, jobKey, now));
}

// Legacy enable-only toggle (the pre-§4.3 contract, kept byte-compatible): body {enabled} only,
// audited as schedule_job_toggle, response { ok, job_key, enabled }. The existing UI toggle
// (useAdminActions api.put) still calls this; PATCH above is the documented surface going forward.
export async function PUT(request: Request, { params }: { params: Promise<{ jobKey: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const { jobKey } = await params;
  const body = (await request.json().catch(() => null)) as { enabled?: boolean } | null;
  if (typeof body?.enabled !== "boolean") {
    return badRequest("invalid_request", "enabled (boolean) is required.");
  }
  const db = getDb();
  const res = db.run("UPDATE schedule_job SET enabled = ? WHERE job_key = ?", [body.enabled ? 1 : 0, jobKey]);
  if (res.changes === 0) return notFound();
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "schedule_job_toggle",
    target: `${jobKey}:enabled=${body.enabled ? 1 : 0}`,
    now: new Date().toISOString(),
  });
  return ok({ ok: true, job_key: jobKey, enabled: body.enabled });
}
