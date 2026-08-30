// S5 Business Case (greenfield cost model). GET returns the model with its
// lines plus a derived year-by-year projection (revenue − labor − opex −
// capex → EBITDA → cumulative cash flow → BEP year), computed from the
// persisted lines only. POST creates the model, PUT updates it,
// DELETE removes it. Line CRUD lives under /api/projects/:id/business-case/[modelId]/lines.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

const KINDS = new Set(["greenfield_cost", "revenue", "valuation", "investment_return"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const models = getDb()
    .query(
      `SELECT m.id, m.kind, m.name, m.horizon_years, m.created_by, m.created_at,
              (SELECT COUNT(*) FROM business_case_line l WHERE l.model_id = m.id) AS line_count
       FROM business_case_model m WHERE m.project_id = ? ORDER BY m.created_at DESC`,
    )
    .all(project.id);
  return ok(models, 200, { count: (models as unknown[]).length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Business-case models are created by analysts.");
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  const body = (await request.json().catch(() => null)) as {
    kind?: string; name?: string; horizon_years?: number;
  } | null;
  if (!body?.name?.trim() || !body?.kind || !KINDS.has(body.kind)) {
    return badRequest("invalid_request", `name and kind (${[...KINDS].join("|")}) are required.`);
  }
  const db = getDb();
  const now = new Date().toISOString();
  const modelId = ulid();
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    [modelId, project.id, body.kind, body.name.trim(), body.horizon_years ?? 5, ctx.userId, now],
  );
  appendAudit(db, { actor: ctx.userId, action: "business_case_create", target: `${project.project_no}:${modelId}`, now });
  return ok({ id: modelId, kind: body.kind, name: body.name.trim() }, 201);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Business-case models are deleted by analysts.");
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  const url = new URL(request.url);
  const modelId = url.searchParams.get("model_id");
  if (!modelId) return badRequest("invalid_request", "model_id query param is required.");
  const db = getDb();
  const owned = db
    .query("SELECT id FROM business_case_model WHERE id = ? AND project_id = ?")
    .get(modelId, project.id);
  if (!owned) return notFound();
  db.run("DELETE FROM business_case_line WHERE model_id = ?", [modelId]);
  db.run("DELETE FROM business_case_model WHERE id = ?", [modelId]);
  appendAudit(db, { actor: ctx.userId, action: "business_case_delete", target: `${project.project_no}:${modelId}`, now: new Date().toISOString() });
  return ok({ deleted: modelId });
}
