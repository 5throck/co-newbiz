// ROIC driver-tree (deferred feature, web-implementation-plan §3). Builds a
// derived ROIC tree + margin bridge from the project's industry financials
// (fact_industry). The exact metric_key vocabulary is data-dependent, so the
// computation is honest: it derives what it can from present metrics and sets
// `computable=false` with reasons when the base metrics (revenue, NOPAT,
// invested capital) are absent — never fabricating a figure.
//
// Projection v1 (ADR-0018 anchoring): a 3-year forward ROIC projection is
// derived from the historical fact_industry ROIC series via CAGR when at
// least two historical data points exist — never fabricated from a single
// point. Every projected value carries `anchor_ref` back to the historical
// series it was derived from, and a projection landing above the historical
// max by more than 10% of the historical range trips `base_rate_warning`
// (ADR-0018's mechanical outlier check; no peer distribution is wired yet,
// so the check is historical-only for v1).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

interface FinRow {
  fiscal_year: number;
  metric_key: string;
  value: number;
}

function pick(rows: FinRow[], needles: string[]): number | null {
  const row = rows.find((r) => needles.some((n) => r.metric_key.toLowerCase().includes(n)));
  return row ? row.value : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();

  const industries = getDb()
    .query("SELECT industry_id FROM project_industry WHERE project_id = ? AND superseded_by IS NULL")
    .all(project.id) as { industry_id: string }[];
  if (industries.length === 0) {
    return ok({ computable: false, reason: "프로젝트에 바인딩된 산업이 없습니다.", tree: [], waterfall: [] }, 200, {});
  }

  const industryId = industries[0].industry_id;
  const currentYear = new Date().getUTCFullYear();
  const rows = getDb()
    .query(
      `SELECT p.fiscal_year AS fiscal_year, f.metric_key AS metric_key, MAX(f.value) AS value
       FROM fact_industry f JOIN md_period p ON p.id = f.period_id
       WHERE f.industry_id = ? AND p.fiscal_year >= ?
       GROUP BY p.fiscal_year, f.metric_key ORDER BY p.fiscal_year DESC, f.metric_key`,
    )
    .all(industryId, currentYear - 5 + 1) as FinRow[];

  const latestYear = rows.length ? Math.max(...rows.map((r) => r.fiscal_year)) : null;
  const latest = rows.filter((r) => r.fiscal_year === latestYear);

  const revenue = pick(latest, ["revenue", "sales", "매출"]);
  const operatingProfit = pick(latest, ["ebit", "operating_profit", "op_profit", "영업이익"]);
  const tax = pick(latest, ["tax", "taxes", "법인세"]);
  const nopat = pick(latest, ["nopat", "net_operating"]);
  const investedCapital = pick(latest, ["invested_capital", "invested", "투하자본"]);
  const totalAssets = pick(latest, ["total_assets", "asset", "자산"]);

  const reasons: string[] = [];
  if (revenue === null) reasons.push("revenue 지표 없음");
  const derivedNopat = nopat ?? (operatingProfit !== null ? operatingProfit - (tax ?? 0) : null);
  if (derivedNopat === null) reasons.push("NOPAT/영업이익 지표 없음");
  const ic = investedCapital ?? totalAssets;
  if (ic === null) reasons.push("invested capital/총자산 지표 없음");

  if (revenue === null || derivedNopat === null || ic === null || revenue === 0 || ic === 0) {
    return ok(
      {
        computable: false,
        reason: reasons.join(", ") || "필수 지표 부족",
        industry_id: industryId,
        fiscal_year: latestYear,
        tree: [],
        waterfall: [],
      },
      200,
      { industry_id: industryId, fiscal_year: latestYear },
    );
  }

  const nopatMargin = derivedNopat / revenue;
  const roic = derivedNopat / ic;
  const taxRate = tax !== null && operatingProfit ? tax / operatingProfit : null;

  // Historical ROIC series (one point per fiscal year with computable base
  // metrics) drives the v1 projection below.
  const years = [...new Set(rows.map((r) => r.fiscal_year))].sort((a, b) => a - b);
  const historicalRoic: { fiscal_year: number; roic: number }[] = [];
  for (const y of years) {
    const yearRows = rows.filter((r) => r.fiscal_year === y);
    const yRevenue = pick(yearRows, ["revenue", "sales", "매출"]);
    const yOperatingProfit = pick(yearRows, ["ebit", "operating_profit", "op_profit", "영업이익"]);
    const yTax = pick(yearRows, ["tax", "taxes", "법인세"]);
    const yNopat = pick(yearRows, ["nopat", "net_operating"]) ?? (yOperatingProfit !== null ? yOperatingProfit - (yTax ?? 0) : null);
    const yIc = pick(yearRows, ["invested_capital", "invested", "투하자본"]) ?? pick(yearRows, ["total_assets", "asset", "자산"]);
    if (yRevenue !== null && yNopat !== null && yIc !== null && yIc !== 0) {
      historicalRoic.push({ fiscal_year: y, roic: yNopat / yIc });
    }
  }

  const projection: {
    computable: boolean;
    reason?: string;
    anchor_ref?: string;
    cagr?: number;
    years?: { fiscal_year: number; projected_roic: number; base_rate_warning: boolean }[];
  } = { computable: false };

  if (historicalRoic.length < 2) {
    projection.reason = "역사적 ROIC 데이터 포인트가 2개 미만이라 프로젝션을 산출할 수 없습니다.";
  } else {
    const first = historicalRoic[0];
    const last = historicalRoic[historicalRoic.length - 1];
    const span = last.fiscal_year - first.fiscal_year;
    if (span <= 0 || first.roic <= 0 || last.roic <= 0) {
      projection.reason = "ROIC 값이 음수/0이거나 연도 스팬이 없어 CAGR을 산출할 수 없습니다.";
    } else {
      const cagr = Math.pow(last.roic / first.roic, 1 / span) - 1;
      const roicValues = historicalRoic.map((h) => h.roic);
      const histMax = Math.max(...roicValues);
      const histMin = Math.min(...roicValues);
      const range = histMax - histMin;
      const warnThreshold = histMax + 0.1 * range;
      const anchorRef = `fact_industry:${industryId}:roic_historical:${first.fiscal_year}-${last.fiscal_year}`;
      const projectedYears = [1, 2, 3].map((offset) => {
        const projectedRoic = last.roic * Math.pow(1 + cagr, offset);
        return {
          fiscal_year: last.fiscal_year + offset,
          projected_roic: projectedRoic,
          base_rate_warning: projectedRoic > warnThreshold,
        };
      });
      projection.computable = true;
      projection.anchor_ref = anchorRef;
      projection.cagr = cagr;
      projection.years = projectedYears;
    }
  }

  const tree = [
    { level: 1, label: "Revenue (매출)", value: revenue, parent: null },
    { level: 2, label: "NOPAT (순영업이익)", value: derivedNopat, parent: "Revenue (매출)" },
    { level: 3, label: "NOPAT Margin", value: nopatMargin, parent: "NOPAT (순영업이익)", pct: true },
    { level: 3, label: "Invested Capital (투하자본)", value: ic, parent: "NOPAT (순영업이익)" },
    { level: 4, label: "ROIC", value: roic, parent: "Invested Capital (투하자본)", pct: true },
  ];
  if (taxRate !== null) {
    tree.push({ level: 2, label: "Effective Tax Rate", value: taxRate, parent: "NOPAT (순영업이익)", pct: true });
  }

  // Margin bridge waterfall: Revenue -> (-Operating cost) -> NOPAT
  const opCost = revenue - (operatingProfit ?? derivedNopat);
  const waterfall = [
    { step: "Revenue", value: revenue, kind: "total" },
    { step: "Operating Cost", value: -opCost, kind: "delta" },
    { step: "Tax", value: -(tax ?? 0), kind: "delta" },
    { step: "NOPAT", value: derivedNopat, kind: "subtotal" },
    { step: "ROIC %", value: roic * 100, kind: "pct" },
  ];

  return ok(
    {
      computable: true,
      industry_id: industryId,
      fiscal_year: latestYear,
      roic,
      nopat_margin: nopatMargin,
      tree,
      waterfall,
      historical_roic: historicalRoic,
      projection,
    },
    200,
    { industry_id: industryId, fiscal_year: latestYear },
  );
}
