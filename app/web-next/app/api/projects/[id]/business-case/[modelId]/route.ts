// Business-case lines + derived projection. GET returns the lines and the
// year-by-year model: per year, revenue − (labor + opex) = EBITDA; capex is
// an investment outflow; cumulative cash flow = Σ(EBITDA − capex); BEP year
// is the first year cumulative ≥ 0. All figures persisted; the projection is
// pure arithmetic over them (computed per request, nothing stored).
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

const CATEGORIES = new Set(["labor", "opex", "capex", "revenue"]);

function loadOwned(projectId: string, modelId: string) {
  return getDb()
    .query("SELECT id, kind, name, horizon_years FROM business_case_model WHERE id = ? AND project_id = ?")
    .get(modelId, projectId) as { id: string; kind: string; name: string; horizon_years: number } | null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string; modelId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id, modelId } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const model = loadOwned(project.id, modelId);
  if (!model) return notFound();

  const lines = getDb()
    .query(
      "SELECT id, category, name, annual_amount_krw_m, headcount, start_year, growth_rate, note FROM business_case_line WHERE model_id = ? ORDER BY category, created_at",
    )
    .all(modelId) as Array<{
    id: string; category: string; name: string; annual_amount_krw_m: number;
    headcount: number | null; start_year: number; growth_rate: number; note: string | null;
  }>;

  const H = model.horizon_years;
  const years: Array<{
    year: number; revenue: number; labor: number; opex: number; capex: number;
    ebitda: number; netCashflow: number; cumulative: number;
  }> = [];
  let cumulative = 0;
  let bepYear: number | null = null;
  for (let y = 1; y <= H; y++) {
    const amountAt = (l: { annual_amount_krw_m: number; start_year: number; growth_rate: number }) =>
      y >= l.start_year ? l.annual_amount_krw_m * Math.pow(1 + l.growth_rate, y - l.start_year) : 0;
    // capex is a one-off investment outflow booked in its start_year (no
    // recurrence, no growth) — labor/opex/revenue recur and compound.
    const capexAt = (l: { annual_amount_krw_m: number; start_year: number }) =>
      y === l.start_year ? l.annual_amount_krw_m : 0;
    const revenue = lines.filter((l) => l.category === "revenue").reduce((a, l) => a + amountAt(l), 0);
    const labor = lines.filter((l) => l.category === "labor").reduce((a, l) => a + amountAt(l), 0);
    const opex = lines.filter((l) => l.category === "opex").reduce((a, l) => a + amountAt(l), 0);
    const capex = lines.filter((l) => l.category === "capex").reduce((a, l) => a + capexAt(l), 0);
    const ebitda = revenue - labor - opex;
    const netCashflow = ebitda - capex;
    cumulative += netCashflow;
    if (bepYear === null && cumulative >= 0 && y > 1) bepYear = y;
    if (y === 1 && cumulative >= 0) bepYear = 1;
    years.push({
      year: y,
      revenue: round(revenue), labor: round(labor), opex: round(opex), capex: round(capex),
      ebitda: round(ebitda), netCashflow: round(netCashflow), cumulative: round(cumulative),
    });
  }

  return ok({ model, lines, projection: { years, bep_year: bepYear } }, 200, { count: lines.length });
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; modelId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Business-case lines are managed by analysts.");
  const { id, modelId } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (!loadOwned(project.id, modelId)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    category?: string; name?: string; annual_amount_krw_m?: number;
    headcount?: number; start_year?: number; growth_rate?: number; note?: string;
  } | null;
  if (!body?.category || !CATEGORIES.has(body.category) || !body?.name?.trim() ||
      typeof body.annual_amount_krw_m !== "number" || !Number.isFinite(body.annual_amount_krw_m)) {
    return badRequest("invalid_request", `category (${[...CATEGORIES].join("|")}), name and annual_amount_krw_m are required.`);
  }
  const db = getDb();
  const now = new Date().toISOString();
  const lineId = ulid();
  db.run(
    `INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, headcount, start_year, growth_rate, note, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [lineId, modelId, body.category, body.name.trim(), body.annual_amount_krw_m,
      body.headcount ?? null, body.start_year ?? 1, body.growth_rate ?? 0, body.note?.trim() ?? null,
      ctx.userId, now],
  );
  appendAudit(db, { actor: ctx.userId, action: "business_case_line_add", target: `${modelId}:${lineId}`, now });
  return ok({ id: lineId }, 201);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; modelId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Business-case lines are managed by analysts.");
  const { id, modelId } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (!loadOwned(project.id, modelId)) return notFound();
  const url = new URL(request.url);
  const lineId = url.searchParams.get("line_id");
  if (!lineId) return badRequest("invalid_request", "line_id query param is required.");
  const db = getDb();
  const res = db.run("DELETE FROM business_case_line WHERE id = ? AND model_id = ?", [lineId, modelId]);
  if (res.changes === 0) return notFound();
  appendAudit(db, { actor: ctx.userId, action: "business_case_line_delete", target: `${modelId}:${lineId}`, now: new Date().toISOString() });
  return ok({ deleted: lineId });
}
