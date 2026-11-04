// Deterministic financial analysis derived from DART accounts — no LLM.
// Part of the ADR-0093 company-profile expansion: the profile pipeline used to
// store raw accounts only; this module turns them into YoY trends and ratios
// (per S1's "quantitative content is computed, not asked" discipline).
//
// Never throws: missing accounts are reported in missingAccounts, and every
// derived value is null when its inputs are incomplete rather than guessed.
import type { DartFinancials } from "./dart-client.ts";

export interface FinancialSeriesPoint {
  year: string;
  value: number | null;
}

export interface FinancialSeries {
  key: "revenue" | "operatingProfit" | "netIncome" | "totalEquity" | "totalDebt";
  label: string;
  points: FinancialSeriesPoint[];
}

export interface FinancialRatioRow {
  year: string;
  revenueGrowth?: number | null;
  operatingMargin?: number | null;
  netMargin?: number | null;
  debtRatio?: number | null;
  roe?: number | null;
}

export interface FinancialAnalysis {
  available: boolean;
  years: string[];
  series: FinancialSeries[];
  ratios: FinancialRatioRow[];
  missingAccounts: string[];
  notes: string[];
}

/** Korean DART account names → canonical series keys (first match wins). */
const ALIASES: Array<{ key: FinancialSeries["key"]; label: string; names: string[] }> = [
  { key: "revenue", label: "매출액", names: ["매출액", "영업수익", "수익(매출액)", "매출채권 및 미수금 제외 영업수익"] },
  { key: "operatingProfit", label: "영업이익", names: ["영업이익", "영업이익(손실)"] },
  { key: "netIncome", label: "당기순이익", names: ["당기순이익", "당기순이익(손실)", "반기순이익", "분기순이익", "지배기업 소유주지분 순이익"] },
  { key: "totalEquity", label: "자본총계", names: ["자본총계", "지배기업 소유주지분 자본"] },
  { key: "totalDebt", label: "부채총계", names: ["부채총계"] },
];

const r4 = (v: number): number => Math.round(v * 10000) / 10000;

export function deriveFinancialAnalysis(dart: DartFinancials): FinancialAnalysis {
  const out: FinancialAnalysis = {
    available: false,
    years: [],
    series: [],
    ratios: [],
    missingAccounts: [],
    notes: [],
  };
  if (!dart.found || !dart.items?.length) {
    out.notes.push(dart.error ? `DART 미입수 — ${dart.error}` : "DART 데이터 없음");
    return out;
  }
  const items = dart.items as Array<{ name: string; value: number; unit?: string; year?: string }>;
  // unit normalization — DART filings report in 원(KRW)·백만원·억원 등 제각각;
  // 모두 억원으로 통일한다. Ratios are unit-invariant but YoY/차트 표기는 아니다.
  const units = [...new Set(items.map((i) => i.unit ?? "").filter(Boolean))];
  const to억원 = (v: number, unit?: string): number => {
    if (!unit) return v; // 단위 미기재 — 과거 계약상 억원 가정
    const u = unit.toUpperCase();
    if (u === "KRW" || u === "원") return v / 1e8; // 원 → 억원
    if (u.includes("백만")) return v / 100; // 백만원 → 억원
    return v; // 억원 (기본)
  };
  if (units.length > 1) out.notes.push(`단위 혼합 감지(${units.join(", ")}) — 억원 기준으로 정규화했습니다.`);
  else if (units[0]?.toUpperCase() === "KRW") out.notes.push("DART 원 단위(KRW)를 억원으로 환산해 표시합니다.");

  const years = [...new Set(items.map((i) => i.year ?? "").filter(Boolean))].sort();
  if (years.length === 0) {
    out.notes.push("연도 태그가 없는 단일 연도 데이터 — 추세 분석 불가, 당해 연도 값만 표시");
    return out;
  }
  out.years = years;
  out.available = true;

  for (const alias of ALIASES) {
    const matched = items.filter((i) => alias.names.includes(i.name));
    if (matched.length === 0) {
      out.missingAccounts.push(alias.label);
      continue;
    }
    // Dedup: keep the first item per account+year. Since dart-client v1.3.0 one
    // year adopts exactly one statement basis (per-year CFS→BFS fallback), so the
    // fetch path can no longer produce CFS/BFS overlap for the same account+year —
    // this guard is now dead-letter defense for payloads fetched by older versions.
    const byYear = new Map<string, number>();
    for (const it of matched) {
      const y = it.year ?? years[years.length - 1];
      if (!byYear.has(y)) byYear.set(y, to억원(it.value, it.unit));
    }
    out.series.push({
      key: alias.key,
      label: alias.label,
      points: years.map((y) => ({ year: y, value: byYear.get(y) ?? null })),
    });
  }

  const seriesOf = (key: FinancialSeries["key"]): Map<string, number> => {
    const s = out.series.find((x) => x.key === key);
    return new Map((s?.points ?? []).filter((p): p is { year: string; value: number } => p.value !== null).map((p) => [p.year, p.value]));
  };
  const rev = seriesOf("revenue");
  const op = seriesOf("operatingProfit");
  const ni = seriesOf("netIncome");
  const eq = seriesOf("totalEquity");
  const debt = seriesOf("totalDebt");

  for (const y of years) {
    const prev = years[years.indexOf(y) - 1];
    const r = rev.get(y);
    const row: FinancialRatioRow = { year: y };
    row.revenueGrowth = r !== undefined && prev && rev.get(prev) ? r4(r / rev.get(prev)! - 1) : null;
    row.operatingMargin = r !== undefined && op.get(y) !== undefined ? r4(op.get(y)! / r) : null;
    row.netMargin = r !== undefined && ni.get(y) !== undefined ? r4(ni.get(y)! / r) : null;
    row.debtRatio = eq.get(y) !== undefined && debt.get(y) !== undefined ? r4(debt.get(y)! / eq.get(y)!) : null;
    row.roe = eq.get(y) !== undefined && ni.get(y) !== undefined ? r4(ni.get(y)! / eq.get(y)!) : null;
    out.ratios.push(row);
  }
  if (dart.fsDiv === "BFS") out.notes.push("연결재무제표 미제출 — 개별(BFS) 기준");
  if (dart.fsDiv === "mixed") out.notes.push("연결·개별 재무제표가 혼합되어 있습니다 — 연도별 작성 기준이 다릅니다 (연도별 표기 참조)");
  if (dart.integrity === "warning") out.notes.push(`합산 검증 경고: ${(dart.integrityNotes ?? []).join("; ")}`);
  return out;
}
