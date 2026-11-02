// @version 1.0.0
/**
 * Client-side form-unit contract for the schedule-job dialogs (design
 * 2026-10-29-scheduled-jobs-design §4.3): the shared input parsers for the timeout (minutes,
 * stored ×60 as timeout_sec) and retries (raw count) inputs, plus the edit dialog's
 * changed-fields diff. Pure module — no react, no next-intl — so unit tests import it
 * directly (the sibling job-validate.ts is the server-side mirror for the routes).
 */

/** timeout minutes input: integer 1–120 (stored ×60 as timeout_sec, the §4.3 range). */
export function parseTimeoutMin(raw: string): number | null {
  const v = Number(raw);
  return Number.isInteger(v) && v >= 1 && v <= 120 ? v : null;
}

/** retries input: integer 0–5 (the §4.3 range). */
export function parseRetries(raw: string): number | null {
  const v = Number(raw);
  return Number.isInteger(v) && v >= 0 && v <= 5 ? v : null;
}

/**
 * Changed-fields diff for the edit dialog (QA iteration 2, F-3): a field enters the PATCH
 * payload only when its INPUT value differs from the row's own prefill IN THE FORM'S UNIT —
 * cron as the trimmed string, timeout in minutes against the openEdit Math.round prefill,
 * retries as the raw count. The old seconds-level timeout equality (form minutes × 60
 * compared against timeout_sec) silently rewrote a sub-minute registry timeout:
 * notify.deliver's intentional §13.2 50 s prefilled as Math.round(50/60) = 1 min, and
 * 1 minute × 60 ≠ 50 s meant every untouched save PATCHed it up to 60 s — the exact rewrite
 * the create dialog's "below the 60 s input floor" comment warns against. With the form-unit
 * comparison an untouched save sends no timeout field at all and the stored 50 s survives;
 * an explicit minute edit still round-trips honestly through ×60.
 */
export function computeJobEditPayload(
  job: { cron_expr: string; timeout_sec: number; max_retries: number },
  form: { cron: string; timeoutMin: string; retries: string },
): { cron_expr?: string; timeout_sec?: number; max_retries?: number } {
  const payload: { cron_expr?: string; timeout_sec?: number; max_retries?: number } = {};
  const expr = form.cron.trim();
  if (expr !== job.cron_expr) payload.cron_expr = expr;
  const timeoutValue = parseTimeoutMin(form.timeoutMin);
  if (timeoutValue !== null && timeoutValue !== Math.round(job.timeout_sec / 60)) {
    payload.timeout_sec = timeoutValue * 60;
  }
  const retriesValue = parseRetries(form.retries);
  if (retriesValue !== null && retriesValue !== job.max_retries) payload.max_retries = retriesValue;
  return payload;
}
