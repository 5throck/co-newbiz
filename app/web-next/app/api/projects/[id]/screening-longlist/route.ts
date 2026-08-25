// Port of app/server/market.ts GET/POST /api/projects/:id/screening-longlist
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
  const rows = getDb().query("SELECT id, candidate_name, knock_out_passed, notes, created_at FROM screening_longlist WHERE project_id = ? ORDER BY created_at DESC").all(project.id);
  return ok(rows);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Longlist writes require the analyst role.");
  const body = (await request.json().catch(() => null)) as { candidate_name?: string; knock_out_passed?: boolean; notes?: string } | null;
  if (!body?.candidate_name?.trim() || typeof body.knock_out_passed !== "boolean") {
    return badRequest("invalid_request", "candidate_name and knock_out_passed are required.");
  }
  const db = getDb();
  const rowId = ulid();
  db.run("INSERT INTO screening_longlist (id, project_id, candidate_name, knock_out_passed, notes, created_at) VALUES (?,?,?,?,?,?)",
    [rowId, project.id, body.candidate_name.trim(), body.knock_out_passed ? 1 : 0, body.notes?.trim() || null, new Date().toISOString()]);
  appendAudit(db, { actor: ctx.userId, action: "screening_longlist_write", target: `${project.id}:${rowId}`, now: new Date().toISOString() });
  return ok({ id: rowId }, 201);
}
