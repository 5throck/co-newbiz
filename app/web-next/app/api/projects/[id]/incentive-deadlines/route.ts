// Port of app/server/pmi.ts GET/POST /api/projects/:id/incentive-deadlines
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query("SELECT id, incentive_ref, deadline, source, created_at FROM project_incentive_deadline WHERE project_id = ? ORDER BY deadline ASC")
    .all(project.id);
  return ok(rows);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Incentive-deadline writes require the analyst role.");
  const body = (await request.json().catch(() => null)) as
    | { incentive_ref?: string; deadline?: string; source?: string }
    | null;
  if (!body?.incentive_ref?.trim() || !body?.deadline || Number.isNaN(Date.parse(body.deadline))) {
    return badRequest("invalid_request", "incentive_ref and a parseable deadline are required.");
  }
  const db = getDb();
  const id2 = ulid();
  try {
    db.run(
      "INSERT INTO project_incentive_deadline (id, project_id, incentive_ref, deadline, source, created_at) VALUES (?,?,?,?,?,?)",
      [id2, project.id, body.incentive_ref.trim(), body.deadline, body.source?.trim() || null, new Date().toISOString()],
    );
  } catch (err) {
    return badRequest("deadline_failed", err instanceof Error ? err.message : "Deadline insert failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "incentive_deadline_write", target: `${project.id}:${id2}`, now: new Date().toISOString() });
  return ok({ id: id2 }, 201);
}
