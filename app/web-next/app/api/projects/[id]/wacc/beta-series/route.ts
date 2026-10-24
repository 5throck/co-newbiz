// GET /api/projects/[id]/wacc/beta-series — collected KRX beta inputs for the
// beta regression panel. Joins fact_market_observation ↔ md_period for the
// subject company's daily-close series (krx:stock:<companyId>:close) and a
// market index series (krx:index:KOSPI|KOSDAQ:close), aligns rows by date, and returns
// date/price/index triples ready for parseSeriesInput-style paste or direct
// regression. Read-only — collection runs through scripts/co-newbiz/beta-series.ts.
//
// Index choice: default = the stock's listing-market index (KOSDAQ-listed ->
// KOSDAQ), read from the raw_payload stock-master record the collector writes
// (db/repositories/krx-listing.repository.ts). Unknown market -> KOSPI. Never
// pairs silently with an empty index: if the default has no data and the other
// one does, it falls back and reports hint_code 'index_fallback'. ?index=KOSPI|KOSDAQ
// overrides (allow-list; anything else -> 400 invalid_request).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { readKrxListingMarket } from "../../../../../../../../db/repositories/krx-listing.repository.ts";

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

const INDEX_MARKETS = ["KOSPI", "KOSDAQ"] as const;
type IndexMarket = (typeof INDEX_MARKETS)[number];
const indexSeriesId = (m: IndexMarket) => `krx:index:${m}:close`;
const MIN_ROWS = 63;

type CollectionStatus = "ready" | "insufficient" | "no_index" | "no_stock" | "none";
type HintCode = "run_collection" | "ticker_unresolved" | "insufficient_overlap" | "ok" | "index_fallback";

interface SeriesStat {
  count: number;
  first_date: string | null;
  last_date: string | null;
}

// Rows arrive sorted by date, so first/last come straight from the ends.
function statOf(rows: Array<{ date: string }>): SeriesStat {
  return {
    count: rows.length,
    first_date: rows.length > 0 ? rows[0].date : null,
    last_date: rows.length > 0 ? rows[rows.length - 1].date : null,
  };
}

function diagnose(price: number, index: number, aligned: number): { status: CollectionStatus; hint_code: HintCode } {
  if (price === 0 && index === 0) return { status: "none", hint_code: "run_collection" };
  if (price === 0) return { status: "no_stock", hint_code: "ticker_unresolved" };
  if (index === 0) return { status: "no_index", hint_code: "run_collection" };
  if (aligned < MIN_ROWS) return { status: "insufficient", hint_code: "insufficient_overlap" };
  return { status: "ready", hint_code: "ok" };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const indexParam = new URL(request.url).searchParams.get("index");
  if (indexParam !== null && !(INDEX_MARKETS as readonly string[]).includes(indexParam)) {
    return badRequest("invalid_request", "index accepts only KOSPI or KOSDAQ.");
  }
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
    return badRequest("no_subject_company", "No subject company is set, so the beta series cannot be queried.");
  }

  const stockSeriesId = `krx:stock:${companyId}:close`;
  const price = loadSeries(db, stockSeriesId);
  const indexData: Record<IndexMarket, ObsRow[]> = {
    KOSPI: loadSeries(db, indexSeriesId("KOSPI")),
    KOSDAQ: loadSeries(db, indexSeriesId("KOSDAQ")),
  };
  const listingMarket = readKrxListingMarket(db, companyId) ?? "unknown";
  const preferred: IndexMarket = listingMarket === "KOSDAQ" ? "KOSDAQ" : "KOSPI";
  const other: IndexMarket = preferred === "KOSPI" ? "KOSDAQ" : "KOSPI";
  // Default never pairs with an empty index when the other one has data.
  const indexFallback = indexData[preferred].length === 0 && indexData[other].length > 0;
  const defaultIndex: IndexMarket = indexFallback ? other : preferred;
  const selected: IndexMarket = (indexParam as IndexMarket | null) ?? defaultIndex;
  const usedFallback = indexParam === null && indexFallback;
  const index = indexData[selected];

  // Align by date — regression needs both legs on the same trading day.
  const indexByDate = new Map(index.map((r) => [r.date, r.value]));
  const rows = price
    .filter((p) => indexByDate.has(p.date))
    .map((p) => ({ date: p.date, price: p.value, index: indexByDate.get(p.date)! }));

  // Additive diagnostics so the panel can explain an empty result without a migration.
  const company = db.query("SELECT name_ko FROM md_company WHERE id = ?").get(companyId) as { name_ko: string } | undefined;
  const sourceRegistered = db.query("SELECT 1 AS present FROM md_source WHERE code = 'krx'").get() != null;
  const diag = diagnose(price.length, index.length, rows.length);
  const hintCode: HintCode = usedFallback && diag.hint_code === "ok" ? "index_fallback" : diag.hint_code;
  const indexOptions = INDEX_MARKETS.map((m) => ({
    series_id: indexSeriesId(m),
    label: m,
    count: indexData[m].length,
    selected: m === selected,
  }));

  return ok({
    collection: {
      subject_company_id: companyId,
      subject_company_name: company?.name_ko ?? null,
      stock_series_id: stockSeriesId,
      index_series_id: indexSeriesId(selected),
      index_market: selected,
      listing_market: listingMarket,
      index_fallback: usedFallback,
      price: statOf(price),
      index: statOf(index),
      aligned: statOf(rows),
      source_registered: sourceRegistered,
      status: diag.status,
      min_rows: MIN_ROWS,
      hint_code: hintCode,
      // Plain text only; the UI shows it read-only and never executes it.
      runbook_command: `bun scripts/co-newbiz/beta-series.ts --project ${id}`,
    },
    stock_series_id: stockSeriesId,
    listing_market: listingMarket,
    default_index: defaultIndex,
    index_options: indexOptions,
    price_count: price.length,
    index_count: index.length,
    aligned_count: rows.length,
    rows,
  });
}
