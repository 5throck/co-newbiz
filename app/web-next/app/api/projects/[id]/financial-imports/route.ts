// Port of app/server/market.ts POST /api/projects/:id/financial-imports
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Financial imports require the analyst role.");
  const body = (await request.json().catch(() => null)) as {
    industry_id?: string;
    source?: string;
    rows?: Array<{ fiscal_year?: number; metric_key?: string; value?: number }>;
  } | null;
  if (!body?.industry_id || !Array.isArray(body.rows) || body.rows.length === 0) {
    return badRequest("invalid_request", "industry_id and a non-empty rows array are required.");
  }
  const db = getDb();
  const industryExists = db.query("SELECT id FROM md_industry WHERE id = ?").get(body.industry_id);
  if (!industryExists) return notFound("Unknown industry.");

  let sourceId: string | null = null;
  if (body.source?.trim()) {
    const code = body.source.trim();
    const existing = db.query("SELECT id FROM md_source WHERE code = ?").get(code) as { id: string } | undefined;
    if (existing) sourceId = existing.id;
    else {
      sourceId = ulid();
      db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [sourceId, code, "C", new Date().toISOString()]);
    }
  }

  const inserted: Array<{ period_id: string; metric_key: string }> = [];
  db.transaction(() => {
    for (const r of body.rows!) {
      if (typeof r.fiscal_year !== "number" || !r.metric_key?.trim() || typeof r.value !== "number") continue;
      const year = Math.trunc(r.fiscal_year);
      let period = db.query("SELECT id FROM md_period WHERE period_type='year' AND fiscal_year=?").get(year) as { id: string } | undefined;
      if (!period) {
        period = { id: ulid() };
        db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
          [period.id, "year", `${year}-01-01`, `${year}-12-31`, year, new Date().toISOString()]);
      }
      db.run(
        "INSERT INTO fact_industry (id, industry_id, period_id, metric_key, value, revision_no, source_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), body.industry_id!, period.id, r.metric_key.trim(), r.value, 1, sourceId, new Date().toISOString()],
      );
      inserted.push({ period_id: period.id, metric_key: r.metric_key });
    }
  })();
  appendAudit(db, { actor: ctx.userId, action: "financial_import", target: `${project.id}:${body.industry_id}:${inserted.length}`, now: new Date().toISOString() });
  return ok({ imported: inserted.length }, 201, { note: "Rows appended with revision_no=1 — re-importing the same period/metric adds a newer revision." });
}
