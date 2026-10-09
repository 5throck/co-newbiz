// GET /api/projects/[id]/wacc/beta-series — collected KRX beta inputs for the
// beta regression panel. Joins fact_market_observation ↔ md_period for the
// subject company's daily-close series (krx:stock:<companyId>:close) and the
// KOSPI index series (krx:index:KOSPI:close), aligns rows by date, and returns
// date/price/index triples ready for parseSeriesInput-style paste or direct
// regression. Read-only — collection runs through scripts/co-newbiz/beta-series.ts.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

interface ObsRow {
  date: string;
  value: number;
}

function loadSeries(db: ReturnType<typeof getDb>, seriesId: string): ObsRow[] {
  const rows = db
    .query(
      `SELECT p.start_date AS date, o.value AS value
       FROM fact_market_observation o
       JOIN md_period p ON p.id = o.period_id
       WHERE o.series_id = ?
       ORDER BY p.start_date`,
    )
    .all(seriesId) as Array<{ date: string; value: number }>;
  return rows
    .map((r) => ({ date: String(r.date).slice(0, 10), value: Number(r.value) }))
    .filter((r) => Number.isFinite(r.value));
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();

  // Subject company: md_project.company_id, falling back to rank-1 shortlist.
  const project = db
    .query("SELECT company_id, source_opportunity_id FROM md_project WHERE id = ?")
    .get(id) as { company_id: string | null; source_opportunity_id: string | null } | undefined;
  if (!project) return notFound();
  let companyId = project.company_id;
  if (!companyId && project.source_opportunity_id) {
    const rank1 = db
      .query("SELECT company_name FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted' ORDER BY rank LIMIT 1")
      .get(project.source_opportunity_id) as { company_name: string } | undefined;
    if (rank1) {
      const c = db.query("SELECT id FROM md_company WHERE name_ko = ?").get(rank1.company_name) as { id: string } | undefined;
      if (c) companyId = c.id;
    }
  }
  if (!companyId) {
    return badRequest("no_subject_company", "주식회사(subject company)가 지정되어 있지 않아 베타 시계열을 조회할 수 없습니다.");
  }

  const stockSeriesId = `krx:stock:${companyId}:close`;
  const price = loadSeries(db, stockSeriesId);
  const index = loadSeries(db, "krx:index:KOSPI:close");

  // Align by date — regression needs both legs on the same trading day.
  const indexByDate = new Map(index.map((r) => [r.date, r.value]));
  const rows = price
    .filter((p) => indexByDate.has(p.date))
    .map((p) => ({ date: p.date, price: p.value, index: indexByDate.get(p.date)! }));

  return ok({
    stock_series_id: stockSeriesId,
    price_count: price.length,
    index_count: index.length,
    aligned_count: rows.length,
    rows,
  });
}
