// Port of app/server/monitoring.ts GET/POST /api/watch
import { getDb } from "../../../../../db/client.ts";
import { appendAudit } from "../../../../../db/lib/access-control.ts";
import { addWatchRule, createWatch } from "../../../../../db/lib/watch-engine.ts";
import { getProjectIfVisible } from "../../../../../db/repositories/project.repository.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const userId = auth.auth.userId;
  const watches = db
    .query(
      `SELECT w.id, w.project_id, p.project_no, w.last_checked_at, w.created_at
       FROM watch w JOIN md_project p ON p.id = w.project_id
       WHERE w.user_id = ? ORDER BY w.created_at DESC, w.id DESC`,
    )
    .all(userId) as { id: string; project_id: string; project_no: string; last_checked_at: string | null; created_at: string }[];
  const watchIds = watches.map((w) => w.id);
  const rules = (
    watchIds.length
      ? db.query(
          `SELECT watch_id, trigger_type, threshold, cooldown_hours, channel, enabled
           FROM watch_rule WHERE watch_id IN (${watchIds.map(() => "?").join(",")})`,
        ).all(...watchIds)
      : []
  ) as { watch_id: string; trigger_type: string; threshold: number | null; cooldown_hours: number; channel: string; enabled: number }[];
  const byWatch = new Map<string, typeof rules>();
  for (const rule of rules) {
    const list = byWatch.get(rule.watch_id) ?? [];
    list.push(rule);
    byWatch.set(rule.watch_id, list);
  }
  return ok(watches.map((w) => ({ ...w, rules: byWatch.get(w.id) ?? [] })));
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const body = (await request.json().catch(() => null)) as
    | { project_id?: string; rules?: { trigger_type?: string; threshold?: number; cooldown_hours?: number; channel?: string; adr_ref?: string }[] }
    | null;
  if (!body?.project_id) {
    return badRequest("invalid_request", "project_id is required.");
  }
  if (!getProjectIfVisible(ctx.userId, body.project_id, { excludeMnpi: false })) {
    return notFound();
  }
  const db = getDb();
  try {
    const now = new Date().toISOString();
    const watchId = createWatch(db, { projectId: body.project_id, userId: ctx.userId, now });
    appendAudit(db, { actor: ctx.userId, action: "watch_create", target: `${watchId}:${body.project_id}`, now });
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
        adrRef: rule.adr_ref ?? null,
      });
    }
    return ok({ id: watchId, project_id: body.project_id, rules: (body.rules ?? []).length }, 201);
  } catch (err) {
    return badRequest("watch_failed", err instanceof Error ? err.message : "Watch creation failed.");
  }
}
