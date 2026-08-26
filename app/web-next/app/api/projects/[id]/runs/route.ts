// Port of app/server/analysis.ts GET/POST /api/projects/:id/runs
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { createRun, type CreateRunResult } from "../../../../../../../db/lib/versioning.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id: projectId } = await params;
  if (!visibleProject(auth.auth, projectId)) return notFound();
  const rows = getDb()
    .query(
      `SELECT r.id, r.label, r.input_hash, r.created_by, r.created_at, r.superseded_by,
              (SELECT COUNT(*) FROM run_input ri WHERE ri.run_id = r.id) AS input_count
       FROM run r
       WHERE r.project_id = ?
       ORDER BY r.created_at DESC, r.id DESC`,
    )
    .all(projectId);
  return ok(rows, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id: projectId } = await params;
  if (!visibleProject(ctx, projectId)) return notFound();
  if (ctx.role === "viewer") {
    return forbidden("role_required", "Run creation requires the analyst role.");
  }
  const body = (await request.json().catch(() => null)) as
    | { label?: string; from_run_id?: string; set?: Record<string, number> }
    | null;
  if (!body?.label?.trim()) {
    return badRequest("invalid_request", "label is required.");
  }
  if (body.set !== undefined && (typeof body.set !== "object" || Array.isArray(body.set))) {
    return badRequest("invalid_request", "set must be an object of assumption_key -> number.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  let result: CreateRunResult;
  try {
    result = createRun(db, {
      projectId,
      label: body.label.trim(),
      createdBy: ctx.userId,
      fromRunId: body.from_run_id,
      overrides: body.set,
      now,
    });
  } catch (err) {
    return badRequest("run_rejected", err instanceof Error ? err.message : "Run creation failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "run_create", target: `${projectId}:${result.run_id}`, now });
  return ok(result, 201);
}
