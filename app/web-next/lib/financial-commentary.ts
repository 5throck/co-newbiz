// financial-commentary.ts — deterministic commentary layer for the company
// financials screen (Phase 1 of ADR-0116; the "해설 레이어" from the approved
// 2026-09-11 company-financials mockup). Financial performance analysis is
// dense, so every headline number ships with a plain-language sentence and
// threshold-based callouts. Pure rules over the derived analysis — no LLM,
// no randomness; missing inputs yield explicit nulls, never guesses.
import type { FinancialAnalysis, FinancialRatioRow } from "./company-financials.ts";

export interface SummaryCard {
  key: "revenue_cagr" | "operating_margin" | "debt_ratio" | "roe";
  label: string;
  /** null when the analysis cannot compute it — the UI shows N/A. */
  value: number | null;
  format: "percent" | "ratio";
  trend: "up" | "down" | "flat" | null;
  trendText: string | null;
  say: string;
}

export interface Callout {
  tone: "warn" | "good" | "info";
  text: string;
}

export interface MetricCommentary {
  key: string;
  name: string;
  sub: string;
  say: string;
}

export interface FinancialCommentary {
  summary: SummaryCard[];
  callouts: Callout[];
  metrics: MetricCommentary[];
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const signedPct = (v: number): string => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%p`;

function cagr(series: Map<string, number>): number | null {
  const years = [...series.keys()].sort();
  if (years.length < 2) return null;
  const first = series.get(years[0]);
  const last = series.get(years[years.length - 1]);
  if (!first || !last || first <= 0) return null;
  return Math.pow(last / first, 1 / (years.length - 1)) - 1;
}

function stdevOfGrowth(series: Map<string, number>): number | null {
  const years = [...series.keys()].sort();
  const growths: number[] = [];
  for (let i = 1; i < years.length; i++) {
    const prev = series.get(years[i - 1]);
    const cur = series.get(years[i]);
    if (!prev || !cur || prev <= 0) continue;
    growths.push(cur / prev - 1);
  }
  if (growths.length < 2) return null;
  const mean = growths.reduce((a, b) => a + b, 0) / growths.length;
  return Math.sqrt(growths.reduce((a, b) => a + (b - mean) ** 2, 0) / growths.length);
}

function seriesMap(analysis: FinancialAnalysis, key: string): Map<string, number> {
  const s = analysis.series.find((x) => x.key === key);
  return new Map((s?.points ?? []).filter((p): p is { year: string; value: number } => p.value !== null).map((p) => [p.year, p.value]));
}

function ratioTrend(rows: FinancialRatioRow[], pick: (r: FinancialRatioRow) => number | null): { current: number | null; delta: number | null; streak: "up" | "down" | "flat" | null } {
  const vals = rows.map(pick).filter((v): v is number => v !== null && v !== undefined);
  const current = vals.length > 0 ? vals[vals.length - 1] : null;
  const delta = vals.length >= 2 ? vals[vals.length - 1] - vals[vals.length - 2] : null;
  let streak: "up" | "down" | "flat" | null = null;
  for (let i = vals.length - 1; i >= 1; i--) {
    const step = vals[i] - vals[i - 1];
    const dir = step > 0.0005 ? "up" : step < -0.0005 ? "down" : "flat";
    if (streak === null) streak = dir;
    else if (streak !== dir) break;
  }
  return { current, delta, streak };
}

/** Build the commentary layer. `subjectRole` only affects wording (인수 대상 vs
 *  분석 기준 회사); rules are identical for both. */
export function buildFinancialCommentary(analysis: FinancialAnalysis, subjectRole: "target" | "baseline" = "target"): FinancialCommentary {
  const out: FinancialCommentary = { summary: [], callouts: [], metrics: [] };
  const rev = seriesMap(analysis, "revenue");
  const years = analysis.years;
  const lastYear = years[years.length - 1] ?? null;
  const revCagr = cagr(rev);

  const { current: opMargin, delta: opMarginDelta } = ratioTrend(analysis.ratios, (r) => r.operatingMargin ?? null);
  const { current: debtRatio, delta: debtDelta, streak: debtStreak } = ratioTrend(analysis.ratios, (r) => r.debtRatio ?? null);
  const { current: roe, delta: roeDelta } = ratioTrend(analysis.ratios, (r) => r.roe ?? null);
  const revGrowthLatest = analysis.ratios.length >= 1 ? analysis.ratios[analysis.ratios.length - 1].revenueGrowth ?? null : null;

  out.summary.push({
    key: "revenue_cagr",
    label: revCagr !== null ? `매출액 ${rev.size}년 CAGR` : "매출액 CAGR",
    value: revCagr,
    format: "percent",
    trend: revCagr === null ? null : revCagr > 0 ? "up" : revCagr < 0 ? "down" : "flat",
    trendText: revGrowthLatest !== null && revCagr !== null ? `${revGrowthLatest >= 0 ? "▲" : "▼"} 최근 연도 ${pct(revGrowthLatest)}` : null,
    say:
      revCagr === null
        ? "매출 계열이 2년 미만이어서 CAGR을 계산할 수 없습니다 — DART 동기화를 확인하세요."
        : `${subjectRole === "target" ? "대상 회사" : "분석 기준 회사"}의 매출이 연평균 ${pct(revCagr)} 수준으로 ${
            revCagr >= 0.1 ? "두 자릿수" : revCagr >= 0 ? "완만한" : "마이너스"
          } 성장 추세입니다.`,
  });
  out.summary.push({
    key: "operating_margin",
    label: `영업이익률 (${lastYear ?? "최근"})`,
    value: opMargin,
    format: "percent",
    trend: opMarginDelta === null ? null : opMarginDelta > 0 ? "up" : opMarginDelta < 0 ? "down" : "flat",
    trendText: opMarginDelta !== null ? `${opMarginDelta >= 0 ? "▲" : "▼"} 전년 대비 ${signedPct(opMarginDelta)}` : null,
    say:
      opMargin === null
        ? "매출액 또는 영업이익 계열이 없어 계산할 수 없습니다."
        : opMargin >= 0.1
          ? "업계 선두 수준의 수익성입니다."
          : opMargin >= 0.05
            ? "수익성이 안정권에 있으나 업계 선두(10~12%) 대비 여지가 있습니다."
            : "수익성이 낮은 편입니다 — 원가·판관비 구조를 실사에서 확인하세요.",
  });
  out.summary.push({
    key: "debt_ratio",
    label: `부채비율 (${lastYear ?? "최근"})`,
    value: debtRatio,
    format: "ratio",
    trend: debtDelta === null ? null : debtDelta > 0 ? "up" : debtDelta < 0 ? "down" : "flat",
    trendText: debtDelta !== null ? `${debtDelta >= 0 ? "▲" : "▼"} 전년 대비 ${(debtDelta * 100).toFixed(0)}%p` : null,
    say:
      debtRatio === null
        ? "부채·자본 총계가 없어 계산할 수 없습니다."
        : debtRatio >= 1.5
          ? "부채 의존도가 높습니다 — 인수 후 자본구조 개선 수단을 점검하세요."
          : debtRatio >= 1.0
            ? "설비투자 등으로 타인자본 비중이 커진 상태입니다 — 추세와 상환 계획을 확인하세요."
            : "재무 건전성이 양호한 편입니다.",
  });
  out.summary.push({
    key: "roe",
    label: `ROE (${lastYear ?? "최근"})`,
    value: roe,
    format: "percent",
    trend: roeDelta === null ? null : roeDelta > 0 ? "up" : roeDelta < 0 ? "down" : "flat",
    trendText: roeDelta !== null ? `${roeDelta >= 0 ? "▲" : "▼"} 전년 대비 ${signedPct(roeDelta)}` : null,
    say:
      roe === null
        ? "순이익 또는 자본 계열이 없어 계산할 수 없습니다."
        : roe >= 0.1
          ? "자본 대비 수익 창출력이 양호합니다."
          : "자본 대비 수익성은 보통 수준입니다 — 부채비율과 함께 해석이 필요합니다.",
  });

  // Callouts — threshold rules, most severe first.
  if (debtRatio !== null && debtStreak === "up" && debtRatio >= 1.0) {
    out.callouts.push({
      tone: "warn",
      text: `주의 — 부채비율이 ${debtStreak === "up" ? "연속 상승" : "상승"} 중(현재 ${(debtRatio * 100).toFixed(0)}%). 유상증자·대출 상환 계획 등 인수 후 자본구조 개선 수단을 실사(S9)에서 확인하세요.`,
    });
  }
  if (opMargin !== null && opMarginDelta !== null && opMarginDelta > 0.005 && opMargin < 0.1) {
    out.callouts.push({ tone: "info", text: `참고 — 영업이익률이 전년 대비 ${signedPct(opMarginDelta)} 개선 중입니다. 원가율 안정화 여부를 후속 분기 실적으로 확인하세요.` });
  }
  if (revCagr !== null && revCagr >= 0.1) {
    out.callouts.push({ tone: "good", text: "긍정 — 매출이 연평균 두 자릿수로 성장하고 있어 외형 성장 모멘텀이 유지되고 있습니다." });
  }

  // Per-metric commentary rows.
  const revFirst = [...rev.entries()].sort(([a], [b]) => a.localeCompare(b));
  out.metrics.push({
    key: "growth",
    name: "성장성",
    sub: "매출액 연평균 증가율",
    say:
      rev.size >= 2 && revFirst.length >= 2
        ? `${rev.size}년간 매출이 ${revFirst[0][1].toFixed(0)}억원 → ${revFirst[revFirst.length - 1][1].toFixed(0)}억원으로 ${revCagr !== null ? `연평균 ${pct(revCagr)}` : "변화"} 추세입니다. 시장 성장률과의 격차는 사업성 분석의 성장률 근거로 사용됩니다.`
        : "매출 계열이 2년 미만이라 추세 해설을 제공할 수 없습니다.",
  });
  out.metrics.push({
    key: "profitability",
    name: "수익성",
    sub: "영업이익률 추이",
    say:
      opMargin !== null
        ? `최근 영업이익률은 ${pct(opMargin)}${opMarginDelta !== null ? ` (전년 대비 ${signedPct(opMarginDelta)})` : ""}입니다. 매출 성장 대비 비용 관리 상태를 의미하며, 업계 선두 기업(10~12%) 대비 수준을 함께 보세요.`
        : "영업이익 계열이 없어 해설을 제공할 수 없습니다.",
  });
  out.metrics.push({
    key: "solvency",
    name: "재무 건전성",
    sub: "부채비율 = 부채총계 / 자본총계",
    say:
      debtRatio !== null
        ? `부채비율은 현재 ${(debtRatio * 100).toFixed(0)}%입니다. WACC 참조의 관측 D/E가 이 값(부채총계/자본총계)에서 계산되며, 목표 자본구조는 프로젝트 WACC 세션에서 사람이 확정합니다.`
        : "부채·자본 계열이 없어 해설을 제공할 수 없습니다.",
  });
  out.metrics.push({
    key: "excess_return",
    name: "수익 잉여력",
    sub: "ROE = 당기순이익 / 자본총계",
    say:
      roe !== null
        ? `ROE는 ${pct(roe)}${roeDelta !== null ? ` (전년 대비 ${signedPct(roeDelta)})` : ""}입니다. 부채가 ROE를 떠받치는 왜곡이 없는지 부채비율과 함께 해석하세요.`
        : "순이익 계열이 없어 해설을 제공할 수 없습니다.",
  });
  return out;
}

/** Volatility inputs reused by Phase 2's growth model — historical revenue
 *  CAGR and YoY standard deviation, or explicit nulls. Exported here so the
 *  company fact layer owns the derivation once. */
export function historicalGrowthStats(analysis: FinancialAnalysis): { cagr: number | null; revenueVol: number | null } {
  const rev = seriesMap(analysis, "revenue");
  return { cagr: cagr(rev), revenueVol: stdevOfGrowth(rev) };
}
