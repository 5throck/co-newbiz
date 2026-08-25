// Port of app/server/market.ts GET/POST /api/projects/:id/chain-sensitivities
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
  const url = new URL(request.url);
  const industryId = url.searchParams.get("industry_id");
  const rows = industryId
    ? getDb().query("SELECT s.id, s.industry_id, d.code AS driver_code, s.sensitivity, s.lag_months, s.assessed_by, s.assessed_at FROM chain_node_sensitivity s JOIN industry_driver d ON d.id = s.driver_id WHERE s.project_id = ? AND s.industry_id = ? ORDER BY s.assessed_at DESC").all(project.id, industryId)
    : getDb().query("SELECT s.id, s.industry_id, d.code AS driver_code, s.sensitivity, s.lag_months, s.assessed_by, s.assessed_at FROM chain_node_sensitivity s JOIN industry_driver d ON d.id = s.driver_id WHERE s.project_id = ? ORDER BY s.assessed_at DESC").all(project.id);
  return ok(rows, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Sensitivity writes require the analyst role.");
  const body = (await request.json().catch(() => null)) as
    | { industry_id?: string; driver_code?: string; sensitivity?: number; lag_months?: number }
    | null;
  if (!body?.industry_id || !body?.driver_code?.trim() || typeof body.sensitivity !== "number") {
    return badRequest("invalid_request", "industry_id, driver_code and sensitivity are required.");
  }
  const db = getDb();
  const driver = db.query("SELECT id FROM industry_driver WHERE code = ?").get(body.driver_code.trim()) as { id: string } | undefined;
  if (!driver) return badRequest("unknown_driver", `Unknown driver code '${body.driver_code}'.`);
  const existing = db.query(
    "SELECT id FROM chain_node_sensitivity WHERE project_id = ? AND industry_id = ? AND driver_id = ?",
  ).get(project.id, body.industry_id, driver.id) as { id: string } | undefined;
  if (existing) {
    db.run("UPDATE chain_node_sensitivity SET sensitivity = ?, lag_months = ?, assessed_by = ?, assessed_at = ? WHERE id = ?",
      [body.sensitivity, body.lag_months ?? 0, ctx.userId, new Date().toISOString(), existing.id]);
    appendAudit(db, { actor: ctx.userId, action: "chain_sensitivity_update", target: `${project.id}:${existing.id}`, now: new Date().toISOString() });
    return ok({ id: existing.id, updated: true }, 200);
  }
  const rowId = ulid();
  db.run("INSERT INTO chain_node_sensitivity (id, project_id, industry_id, driver_id, sensitivity, lag_months, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?,?)",
    [rowId, project.id, body.industry_id, driver.id, body.sensitivity, body.lag_months ?? 0, ctx.userId, new Date().toISOString()]);
  appendAudit(db, { actor: ctx.userId, action: "chain_sensitivity_create", target: `${project.id}:${rowId}`, now: new Date().toISOString() });
  return ok({ id: rowId }, 201);
}
