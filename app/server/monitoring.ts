// @version 1.0.0
/**
 * Monitoring routes — docs/api-spec.md §7 (Wave 5.6A).
 *
 * Watch creation on a project the caller cannot see returns 404 — a watch
 * must never become an existence oracle for a hidden project (FR-SEC-01).
 * Watches and notifications are strictly per-user: every query filters by
 * the authenticated caller.
 */

import { Hono } from "hono";
import { getDb } from "../../db/client.ts";
import { getProjectIfVisible } from "../../db/repositories/project.repository.ts";
import { addWatchRule, createWatch } from "../../db/lib/watch-engine.ts";
import { badRequest, notFound, ok } from "./envelope.ts";
import { requireAuth, type AppEnv } from "./middleware.ts";

export const monitoringRoutes = new Hono<AppEnv>();
monitoringRoutes.use("*", requireAuth);

/** GET /api/watch — the caller's watches (with rules), newest first. */
monitoringRoutes.get("/api/watch", (c) => {
  const db = getDb();
  const userId = c.get("auth").userId;
  const watches = db
    .query(
      `SELECT w.id, w.project_id, p.project_no, w.last_checked_at, w.created_at
       FROM watch w JOIN md_project p ON p.id = w.project_id
       WHERE w.user_id = ? ORDER BY w.created_at DESC, w.id DESC`,
    )
    .all(userId) as { id: string; project_id: string; project_no: string; last_checked_at: string | null; created_at: string }[];
  const rules = db
    .query("SELECT watch_id, trigger_type, threshold, cooldown_hours, channel, enabled FROM watch_rule")
    .all() as { watch_id: string; trigger_type: string; threshold: number | null; cooldown_hours: number; channel: string; enabled: number }[];
  const byWatch = new Map<string, typeof rules>();
  for (const rule of rules) {
    const list = byWatch.get(rule.watch_id) ?? [];
    list.push(rule);
    byWatch.set(rule.watch_id, list);
  }
  return ok(c, watches.map((w) => ({ ...w, rules: byWatch.get(w.id) ?? [] })));
});

/**
 * POST /api/watch — {project_id, rules?[]}. The project must be visible to
 * the caller first; invalid trigger/channel values hit the schema CHECK and
 * map to 400 rather than a 500.
 */
monitoringRoutes.post("/api/watch", async (c) => {
  const ctx = c.get("auth");
  const body = await c.req.json().catch(() => null) as
    | { project_id?: string; rules?: { trigger_type?: string; threshold?: number; cooldown_hours?: number; channel?: string }[] }
    | null;
  if (!body?.project_id) {
    return badRequest(c, "invalid_request", "project_id is required.");
  }
  if (!getProjectIfVisible(ctx.userId, body.project_id, { excludeMnpi: false })) {
    return notFound(c);
  }
  const db = getDb();
  try {
    const watchId = createWatch(db, { projectId: body.project_id, userId: ctx.userId, now: new Date().toISOString() });
    for (const rule of body.rules ?? []) {
      if (!rule.trigger_type || !rule.channel) {
        throw new Error("Each watch rule needs trigger_type and channel.");
      }
      addWatchRule(db, {
        watchId,
        triggerType: rule.trigger_type as never,
        threshold: rule.threshold ?? null,
        cooldownHours: rule.cooldown_hours ?? 24,
        channel: rule.channel as never,
      });
    }
    return ok(c, { id: watchId, project_id: body.project_id, rules: (body.rules ?? []).length }, 201);
  } catch (err) {
    return badRequest(c, "watch_failed", err instanceof Error ? err.message : "Watch creation failed.");
  }
});

/** DELETE /api/watch/:id — own watch only (rules first: no cascade in schema). */
monitoringRoutes.delete("/api/watch/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const owned = db.query("SELECT id FROM watch WHERE id = ? AND user_id = ?").get(id, c.get("auth").userId);
  if (!owned) return notFound(c);
  db.run("DELETE FROM watch_rule WHERE watch_id = ?", [id]);
  db.run("DELETE FROM watch WHERE id = ?", [id]);
  return ok(c, { ok: true });
});

/** GET /api/notifications — the caller's notifications, newest first. */
monitoringRoutes.get("/api/notifications", (c) => {
  const rows = getDb()
    .query(
      "SELECT project_id, trigger_type, severity, payload, channel, bundle, sent_at FROM notification WHERE user_id = ? ORDER BY sent_at DESC, id DESC LIMIT 200",
    )
    .all(c.get("auth").userId);
  return ok(c, rows);
});
