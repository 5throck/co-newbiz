// Admin watch management (design 2026-10-29-scheduled-jobs-design §13.6, P4; admin-only this round).
//
// GET — every watch with its project join, owner user, and rule counts. ENABLED STATE:
// the watch table has NO enabled column (0007, rebuilt verbatim in 0033 — do not invent
// one), so watch-level enable/disable is implemented at RULE level per §13.6's own soft-
// delete semantics ("a disabled rule or watch is skipped at evaluation time"): `enabled`
// here is derived as enabled_rule_count > 0, and PATCH/DELETE on [id] toggle all the
// watch's rules.
//
// POST — create with one-watch-per (project_id, user_id): enforced in code (409) because
// the schema carries no unique index on that pair (adding one is a migration — reported,
// not improvised). The creation itself goes through watch-engine.createWatch.
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { createWatch } from "../../../../../../db/lib/watch-engine.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { badRequest, fail, ok } from "../../../../lib/envelope.ts";

interface CreateBody {
  project_id?: unknown;
  user_id?: unknown;
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const db = getDb();
  const rows = db
    .query(
      `SELECT w.id, w.project_id, w.user_id, w.last_checked_at, w.created_at, p.project_no,
              (SELECT COUNT(*) FROM watch_rule wr WHERE wr.watch_id = w.id) AS rule_count,
              (SELECT COUNT(*) FROM watch_rule wr WHERE wr.watch_id = w.id AND wr.enabled = 1) AS enabled_rule_count
       FROM watch w LEFT JOIN md_project p ON p.id = w.project_id
       ORDER BY w.created_at DESC, w.id DESC`,
    )
    .all() as Array<{
    id: string;
    project_id: string;
    user_id: string;
    last_checked_at: string | null;
    created_at: string;
    project_no: string | null;
    rule_count: number;
    enabled_rule_count: number;
  }>;
  return ok({
    rows: rows.map((r) => ({
      id: r.id,
      project: { id: r.project_id, project_no: r.project_no },
      user_id: r.user_id,
      created_at: r.created_at,
      last_checked_at: r.last_checked_at,
      rule_count: r.rule_count,
      enabled_rule_count: r.enabled_rule_count,
      // Derived — see module docstring (no watch.enabled column exists).
      enabled: r.enabled_rule_count > 0,
    })),
  });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as CreateBody | null;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("invalid_request", "request body must be a JSON object.");
  }
  const known = new Set(["project_id", "user_id"]);
  const unknownFields = Object.keys(body).filter((k) => !known.has(k));
  if (unknownFields.length > 0) {
    return badRequest("invalid_request", `unknown field(s): ${unknownFields.join(", ")}.`);
  }
  if (typeof body.project_id !== "string" || body.project_id.trim() === "") {
    return badRequest("invalid_request", "project_id is required.");
  }
  if (typeof body.user_id !== "string" || body.user_id.trim() === "") {
    return badRequest("invalid_request", "user_id is required.");
  }
  const projectId = body.project_id.trim();
  const userId = body.user_id.trim();

  const db = getDb();
  const project = db.query("SELECT id FROM md_project WHERE id = ?").get(projectId);
  if (!project) return badRequest("invalid_project", `project '${projectId}' does not exist.`);
  const user = db.query("SELECT user_id FROM app_user WHERE user_id = ? AND status = 'active'").get(userId);
  if (!user) return badRequest("invalid_user", `user '${userId}' does not exist or is not active.`);

  // One watch per (project, user) — §13.6. Code-enforced; no schema unique index exists.
  const dupe = db.query("SELECT id FROM watch WHERE project_id = ? AND user_id = ?").get(projectId, userId);
  if (dupe) {
    return fail(409, "watch_exists", `a watch for (project '${projectId}', user '${userId}') already exists.`);
  }

  const nowIso = new Date().toISOString();
  const id = createWatch(db, { projectId, userId, now: nowIso });
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "watch_create",
    target: `${projectId}:${userId} (watch ${id})`,
    now: nowIso,
  });
  return ok({ id, project_id: projectId, user_id: userId, created_at: nowIso }, 201);
}
