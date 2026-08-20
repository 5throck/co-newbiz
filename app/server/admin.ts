// @version 1.0.0
/**
 * Admin console routes — docs/api-spec.md §8, FR-SEC-02/07 (Wave 5.6A).
 *
 * Hard rules encoded here:
 *   - admin role NEVER grants project data. These endpoints return user,
 *     audit, schedule, source and retention surfaces only — project reads
 *     stay on the membership-filtered /api/projects path.
 *   - audit_log is GET-only. There is no delete or update route at any
 *     privilege level, and migration 0008's triggers abort direct SQL too —
 *     append-only is enforced twice (FR-SEC-07).
 *   - data-sources report key PRESENCE only (never the value, not even
 *     masked) plus reliability grade.
 */

import { Hono } from "hono";
import { getDb } from "../../db/client.ts";
import { approveUser, listUsers } from "../../db/lib/accounts.ts";
import { appendAudit } from "../../db/lib/access-control.ts";
import { badRequest, notFound, ok } from "./envelope.ts";
import { requireAdmin, requireAuth, type AppEnv } from "./middleware.ts";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireAuth, requireAdmin);

const ACCOUNT_ROLES = new Set(["admin", "analyst", "viewer"]);

/** GET /api/admin/users — identity columns only, no hash material. */
adminRoutes.get("/api/admin/users", (c) => {
  return ok(c, listUsers(getDb()));
});

/** PUT /api/admin/users/:userId — approve | set_role | disable | enable. */
adminRoutes.put("/api/admin/users/:userId", async (c) => {
  const ctx = c.get("auth");
  const userId = c.req.param("userId");
  const body = await c.req.json().catch(() => null) as { action?: string; role?: string } | null;
  const db = getDb();
  const now = new Date().toISOString();

  if (body?.action === "approve") {
    try {
      approveUser(db, { userId, approvedBy: ctx.userId, now });
    } catch (err) {
      return badRequest(c, "approve_failed", err instanceof Error ? err.message : "Approval failed.");
    }
    return ok(c, { ok: true, status: "active" });
  }

  if (body?.action === "set_role") {
    if (!body.role || !ACCOUNT_ROLES.has(body.role)) {
      return badRequest(c, "invalid_request", `role must be one of ${[...ACCOUNT_ROLES].join("|")}.`);
    }
    if (userId === ctx.userId && body.role !== "admin") {
      return badRequest(c, "self_demotion_blocked", "An admin cannot demote their own account via this endpoint.");
    }
    const res = db.run("UPDATE app_user SET role = ? WHERE user_id = ?", [body.role, userId]);
    if (res.changes === 0) return notFound(c);
    appendAudit(db, { actor: ctx.userId, action: "account_set_role", target: `${userId}:${body.role}`, now });
    return ok(c, { ok: true, role: body.role });
  }

  if (body?.action === "disable") {
    const res = db.run("UPDATE app_user SET status = 'disabled' WHERE user_id = ? AND status != 'disabled'", [userId]);
    if (res.changes === 0) return notFound(c);
    db.run("UPDATE session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [now, userId]);
    db.run("UPDATE api_token SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [now, userId]);
    appendAudit(db, { actor: ctx.userId, action: "account_disable", target: userId, now });
    return ok(c, { ok: true, status: "disabled" });
  }

  if (body?.action === "enable") {
    const res = db.run("UPDATE app_user SET status = 'active', locked_until = NULL, failed_attempts = 0 WHERE user_id = ?", [userId]);
    if (res.changes === 0) return notFound(c);
    appendAudit(db, { actor: ctx.userId, action: "account_enable", target: userId, now });
    return ok(c, { ok: true, status: "active" });
  }

  return badRequest(c, "invalid_request", "action must be approve|set_role|disable|enable.");
});

/**
 * GET /api/admin/audit-log?limit=&before= — append-only viewer. No DELETE
 * route exists on this resource at any privilege level (FR-SEC-07).
 */
adminRoutes.get("/api/admin/audit-log", (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100), 1), 500);
  const before = c.req.query("before");
  const rows = getDb()
    .query(
      `SELECT id, actor_user_id, action, target, created_at FROM audit_log
       WHERE (? IS NULL OR created_at < ?)
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(before ?? null, before ?? null, limit);
  return ok(c, rows, 200, { limit });
});

/** GET /api/admin/schedule-jobs — job registry + latest run per job. */
adminRoutes.get("/api/admin/schedule-jobs", (c) => {
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
  return ok(c, jobs.map((j) => ({ ...j, last_run: byKey.get(j.job_key) ?? null })));
});

/** PUT /api/admin/schedule-jobs/:jobKey — enable/disable toggle (audited). */
adminRoutes.put("/api/admin/schedule-jobs/:jobKey", async (c) => {
  const ctx = c.get("auth");
  const jobKey = c.req.param("jobKey");
  const body = await c.req.json().catch(() => null) as { enabled?: boolean } | null;
  if (typeof body?.enabled !== "boolean") {
    return badRequest(c, "invalid_request", "enabled (boolean) is required.");
  }
  const db = getDb();
  const res = db.run("UPDATE schedule_job SET enabled = ? WHERE job_key = ?", [body.enabled ? 1 : 0, jobKey]);
  if (res.changes === 0) return notFound(c);
  appendAudit(db, {
    actor: ctx.userId,
    action: "schedule_job_toggle",
    target: `${jobKey}:enabled=${body.enabled ? 1 : 0}`,
    now: new Date().toISOString(),
  });
  return ok(c, { ok: true, job_key: jobKey, enabled: body.enabled });
});

/**
 * GET /api/admin/data-sources — registry rows plus API-key PRESENCE under
 * the documented convention CO_NEWBIZ_<CODE>_API_KEY. The value never
 * crosses this boundary in either direction (ui-spec admin console).
 */
adminRoutes.get("/api/admin/data-sources", (c) => {
  const sources = getDb()
    .query("SELECT code, reliability_grade, created_at FROM md_source ORDER BY code")
    .all() as { code: string; reliability_grade: string; created_at: string }[];
  return ok(
    c,
    sources.map((s) => ({
      code: s.code,
      reliability_grade: s.reliability_grade,
      key_var: `CO_NEWBIZ_${s.code.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_API_KEY`,
      key_present: process.env[`CO_NEWBIZ_${s.code.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_API_KEY`] !== undefined,
    })),
  );
});

/** GET /api/admin/retention — the archival policy table. */
adminRoutes.get("/api/admin/retention", (c) => {
  const rows = getDb()
    .query("SELECT table_key, basis, retention_months, action, last_run_at FROM retention_policy ORDER BY table_key")
    .all();
  return ok(c, rows);
});

/** POST /api/admin/retention — upsert one policy row (audited). */
adminRoutes.post("/api/admin/retention", async (c) => {
  const ctx = c.get("auth");
  const body = await c.req.json().catch(() => null) as
    | { table_key?: string; basis?: string; retention_months?: number; action?: string }
    | null;
  if (!body?.table_key?.trim() || !body?.basis?.trim() || !Number.isInteger(body?.retention_months) || body.retention_months! < 0) {
    return badRequest(c, "invalid_request", "table_key, basis and a non-negative integer retention_months are required.");
  }
  if (body.action !== "archive" && body.action !== "delete") {
    return badRequest(c, "invalid_request", "action must be archive|delete.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO retention_policy (table_key, basis, retention_months, action, last_run_at)
     VALUES (?,?,?,?,NULL)
     ON CONFLICT (table_key) DO UPDATE SET
       basis = excluded.basis,
       retention_months = excluded.retention_months,
       action = excluded.action`,
    [body.table_key.trim(), body.basis.trim(), body.retention_months!, body.action],
  );
  appendAudit(db, { actor: ctx.userId, action: "retention_policy_set", target: `${body.table_key}:${body.action}:${body.retention_months}m`, now });
  return ok(c, { ok: true, table_key: body.table_key.trim() }, 201);
});
