// Port of app/server/pmi.ts GET/POST /api/projects/:id/deal-shape-evaluations
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

const SHAPE_ENUM = ["full_acquisition", "majority_stake", "spv", "holdco_route", "joint_venture", "minority_stake", "license_in", "co_development"] as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query("SELECT id, shape, intent, viable, evaluated_by, evaluated_at FROM deal_shape_evaluation WHERE project_id = ? ORDER BY evaluated_at DESC, id")
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
  if (ctx.role === "viewer") return forbidden("role_required", "Deal-shape evaluation writes require the analyst role.");
  const body = (await request.json().catch(() => null)) as
    | { shape?: string; intent?: string; viable?: boolean; evaluated_at?: string }
    | null;
  if (!body?.shape || !SHAPE_ENUM.includes(body.shape as never)) {
    return badRequest("invalid_shape", `shape must be one of ${SHAPE_ENUM.join(", ")}.`);
  }
  if (body.intent !== "integration" && body.intent !== "capability_access") {
    return badRequest("invalid_intent", "intent must be 'integration' or 'capability_access'.");
  }
  if (typeof body.viable !== "boolean") {
    return badRequest("invalid_viable", "viable is required (boolean).");
  }
  const db = getDb();
  const id2 = ulid();
  try {
    db.run(
      "INSERT INTO deal_shape_evaluation (id, project_id, shape, intent, viable, evaluated_by, evaluated_at) VALUES (?,?,?,?,?,?,?)",
      [id2, project.id, body.shape, body.intent, body.viable ? 1 : 0, ctx.userId, body.evaluated_at ?? new Date().toISOString()],
    );
  } catch (err) {
    return badRequest("shape_evaluation_failed", err instanceof Error ? err.message : "Evaluation insert failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "deal_shape_evaluation_write", target: `${project.id}:${id2}`, now: new Date().toISOString() });
  return ok({ id: id2 }, 201);
}
