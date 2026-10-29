// POST /api/admin/schedule-jobs/seed — idempotent default `schedule_job` rows
// (ADR-0189 P2 item 2; design 2026-10-29-scheduled-jobs-design §4.1 seed row, §8 P2).
//
// D3 invariant (owner decision, design §10): seeded rows are created DISABLED (enabled = 0) and an
// existing row is NEVER touched — `seedScheduleJobs` only inserts missing job keys, so an
// admin-edited cron or enabled flag can never be overwritten here. Enabling a job stays a separate,
// deliberate admin action (the [jobKey] toggle route). This endpoint never enables a job and never
// writes a cron value for a key that already exists.
//
// No in-process job execution (ADR-0019, ADR-0189 decision 4): this module imports ONLY the seed
// function. Seeding is data — it writes registry rows, never runs handler code. The jobs/ registry
// import transitively reached through schedule-seed.ts is metadata (key, cron, display name) read
// at seed time, not the scheduler.
//
// The DB handle is the server's own getDb(); the environment is server-resolved via
// CO_NEWBIZ_SCHEDULER_ENV. No --db-path-style path is ever accepted from the request body.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { resolveSchedulerEnv } from "../../../../../../../scripts/co-newbiz/scheduler-core.ts";
import { seedScheduleJobs } from "../../../../../../../scripts/co-newbiz/schedule-seed.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { badRequest, fail, ok } from "../../../../../lib/envelope.ts";

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;

  const body = (await request.json().catch(() => null)) as { dryRun?: unknown } | null;
  if (body !== null && body?.dryRun !== undefined && typeof body.dryRun !== "boolean") {
    return badRequest("invalid_request", "dryRun must be a boolean when provided.");
  }
  const dryRun = body?.dryRun === true;

  // Same refusal as the CLI seed and the tick: no implicit environment, ever (design §2.3).
  let env: string;
  try {
    env = resolveSchedulerEnv();
  } catch (e) {
    return fail(500, "scheduler_env_missing", (e as Error).message);
  }

  const db = getDb();
  const result = seedScheduleJobs(db, new Date(), { dryRun });

  // Every mutating (non-dry-run) call is audited, including a no-op re-seed: the target carries the
  // inserted keys and the existing-row count (before/after cron is not applicable — nothing existing
  // is ever modified, see the D3 invariant above).
  if (!dryRun) {
    appendAudit(db, {
      actor: auth.auth.userId,
      action: "schedule_job_seed",
      target: `inserted=[${result.inserted.join(",")}]; existing_count=${result.existing.length}`,
      now: new Date().toISOString(),
    });
  }

  return ok({ env, dryRun, inserted: result.inserted, existing: result.existing });
}
