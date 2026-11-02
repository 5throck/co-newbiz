// GET /api/admin/schedule-jobs/health — the health-banner data (ADR-0189 P7; design
// 2026-10-29-scheduled-jobs-design §4.1 health row, §4.2 banner, §6 SRE rules b+c). Read-only,
// admin-only, therefore not audited (audit is for mutations).
//
// Environment is server-resolved via CO_NEWBIZ_SCHEDULER_ENV (the seed-route pattern; no
// implicit environment, §2.3) — the heartbeat and job_run checks are per-environment.
//
// Overdue rule (kept simple and documented): for an ENABLED job whose schedule_job.last_fire_minute
// is set (the tick's compare-and-set cursor — "a fire was consumed at this minute"), the job is
// overdue when now > last_fire_minute + timeout_sec AND no job_run row of the resolved env has
// started_at >= last_fire_minute — i.e. a fire the tick dispatched never produced a run in this
// environment. last_fire_minute also advances on skip-missed catch-up, so the flag is
// conservative (a skipped fire reads as overdue until the next run); it never fires for jobs the
// tick has never dispatched (last_fire_minute NULL) or for disabled jobs — the tick heartbeat
// covers "scheduler not firing at all".
import { getDb } from "../../../../../../../db/client.ts";
import { consecutiveFailures, resolveSchedulerEnv } from "../../../../../../../scripts/co-newbiz/scheduler-core.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { nextFireTimes } from "../../../../../lib/schedule/cron.ts";
import { CronError } from "../../../../../lib/schedule/cron.ts";
import { fail, ok } from "../../../../../lib/envelope.ts";

/** §4.2: show the banner when the tick heartbeat is older than 3 minutes. */
const TICK_STALE_MS = 180_000;

/** How many trailing job_run rows the consecutive-failure rule (§6 rule c) inspects. */
const CONSECUTIVE_FAILURE_WINDOW = 3;

interface RawJob {
  job_key: string;
  cron_expr: string;
  enabled: number;
  timeout_sec: number;
  last_fire_minute: string | null;
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;

  // Same refusal as the CLI seed and the tick: no implicit environment, ever (design §2.3).
  let env: ReturnType<typeof resolveSchedulerEnv>;
  try {
    env = resolveSchedulerEnv();
  } catch (e) {
    return fail(500, "scheduler_env_missing", (e as Error).message);
  }

  const db = getDb();
  const now = new Date();

  const tickRow = db.query("SELECT last_tick_at FROM schedule_heartbeat WHERE env = ?").get(env) as {
    last_tick_at: string;
  } | null;
  const ageSeconds = tickRow ? Math.round((now.getTime() - Date.parse(tickRow.last_tick_at)) / 1000) : null;
  const tick = {
    env,
    last_tick_at: tickRow?.last_tick_at ?? null,
    age_seconds: ageSeconds,
    healthy: ageSeconds !== null && ageSeconds <= TICK_STALE_MS / 1000,
  };

  const jobs = db
    .query("SELECT job_key, cron_expr, enabled, timeout_sec, last_fire_minute FROM schedule_job ORDER BY job_key")
    .all() as RawJob[];
  const jobRows = jobs.map((j) => {
    // next_run_at mirrors the list row (shared parser; null when disabled or the stored cron is invalid).
    let nextRunAt: string | null = null;
    if (j.enabled) {
      try {
        nextRunAt = nextFireTimes(j.cron_expr, now, 1)[0]?.toISOString() ?? null;
      } catch (e) {
        if (!(e instanceof CronError)) throw e;
      }
    }
    const lastRun = db
      .query(
        "SELECT started_at, status FROM job_run WHERE job_key = ? AND env = ? ORDER BY started_at DESC, id DESC LIMIT 1",
      )
      .get(j.job_key, env) as { started_at: string; status: string } | null;

    // Overdue per the documented rule above (enabled jobs only).
    let overdue = false;
    if (j.enabled && j.last_fire_minute !== null) {
      const fireMs = Date.parse(j.last_fire_minute);
      if (
        Number.isFinite(fireMs) &&
        now.getTime() > fireMs + j.timeout_sec * 1000 &&
        !db
          .query("SELECT 1 FROM job_run WHERE job_key = ? AND env = ? AND started_at >= ? LIMIT 1")
          .get(j.job_key, env, j.last_fire_minute)
      ) {
        overdue = true;
      }
    }

    return {
      job_key: j.job_key,
      enabled: j.enabled,
      timeout_sec: j.timeout_sec,
      next_run_at: nextRunAt,
      overdue,
      last_fire_at: j.last_fire_minute,
      last_run_started_at: lastRun?.started_at ?? null,
      last_run_status: lastRun?.status ?? null,
      consecutive_failures: consecutiveFailures(db, j.job_key, CONSECUTIVE_FAILURE_WINDOW),
    };
  });

  return ok({ env, tick, jobs: jobRows });
}
