// brownfield-financial-rubric.ts — S7 재무 평가 자동 초안 루브릭(ADR-0140).
// DART facts(deriveFinancialAnalysis 결과, ADR-0093)를 결정론적 규칙으로
// 판정 제안(pass/partial/fail)으로 바꾼다 — LLM을 쓰지 않는다: 같은 facts와
// 같은 임계값이면 항상 같은 제안이 나와야 하고, 근거 숫자가 note에 그대로
// 남아야 하기 때문. 초안은 어디에도 저장되지 않는다 — 사람이 확인·수정한 뒤
// 기존 판정 저장(PUT eval-state, ADR-0139)으로 확정한다(경계 #2 — 판정은
// 항상 사람). 데이터가 부족(동기화 없음·minYears 미달)하면 제안을 만들지
// 않고 이유만 반환한다 — 어떤 판정값도 날조하지 않는다(screening-draft와
// 같은 원칙).
import type { FinancialAnalysis, FinancialSeries } from "./company-financials.ts";

export type FinancialDataRef = "revenue_5y" | "operating_profit_5y" | "net_income_5y" | "debt_5y";

export const FINANCIAL_DATA_REFS: readonly FinancialDataRef[] = ["revenue_5y", "operating_profit_5y", "net_income_5y", "debt_5y"] as const;

export function isFinancialDataRef(v: string | null | undefined): v is FinancialDataRef {
  return !!v && (FINANCIAL_DATA_REFS as readonly string[]).includes(v);
}

/** 항목별 루브릭 임계값 — 단위: 성장률·마진·부채비율은 %, 상승 폭은 p.p. */
export interface RevenueRubric { minYears: number; cagrPass: number; cagrPartial: number }
export interface ProfitRubric { minYears: number; marginPass: number }
export interface DebtRubric { minYears: number; ratioPass: number; ratioPartial: number; maxRisePp: number }
export type FinancialRubric = RevenueRubric | ProfitRubric | DebtRubric;

// 기본 임계값(ADR-0140) — 항목별로 PATCH(임계값 편집)로 조정 가능하며,
// 조정값은 brownfield_eval_criterion.rubric_json에 저장된다.
const DEFAULTS: Record<FinancialDataRef, Record<string, number>> = {
  revenue_5y: { minYears: 3, cagrPass: 5, cagrPartial: 0 },
  operating_profit_5y: { minYears: 3, marginPass: 5 },
  net_income_5y: { minYears: 3, marginPass: 3 },
  debt_5y: { minYears: 3, ratioPass: 200, ratioPartial: 300, maxRisePp: 50 },
};

export interface RubricFieldSpec {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}

/** 임계값 편집 UI·입력 검증이 공유하는 필드 정의 — 루브릭 모양은 data_ref별로 정해진다. */
export function rubricFields(ref: FinancialDataRef): RubricFieldSpec[] {
  const minYears: RubricFieldSpec = { key: "minYears", label: "최소 데이터 연수", unit: "개년", min: 2, max: 5, step: 1, hint: "이 값 미만이면 자동 초안을 만들지 않습니다" };
  switch (ref) {
    case "revenue_5y":
      return [
        minYears,
        { key: "cagrPass", label: "충족 CAGR", unit: "%", min: -50, max: 100, step: 0.5, hint: "기간 연복리성장률이 이 값 이상 + 최근 연도 감소 없음이면 충족 제안" },
        { key: "cagrPartial", label: "부분충족 CAGR", unit: "%", min: -50, max: 100, step: 0.5, hint: "이 값 미만이면 미충족 제안" },
      ];
    case "operating_profit_5y":
    case "net_income_5y":
      return [
        minYears,
        { key: "marginPass", label: "충족 마진(최근 연도)", unit: "%", min: 0, max: 50, step: 0.5, hint: "전 기간 흑자 + 최근 마진이 이 값 이상이어야 충족 제안" },
      ];
    case "debt_5y":
      return [
        minYears,
        { key: "ratioPass", label: "충족 부채비율 상한", unit: "%", min: 50, max: 500, step: 10, hint: "최근 부채비율이 이 값 이하 + 기간 상승 폭이 허용치 이내면 충족 제안" },
        { key: "ratioPartial", label: "부분충족 부채비율 상한", unit: "%", min: 50, max: 800, step: 10, hint: "이 값 초과면 미충족 제안" },
        { key: "maxRisePp", label: "허용 상승 폭(기간)", unit: "p.p.", min: 0, max: 300, step: 10, hint: "기간 첫해 대비 최근 부채비율 상승 폭 허용치" },
      ];
  }
}

/** 저장된 rubric_json → 검증된 루브릭. 알 수 없거나 범위 밖 필드는 기본값으로
 * 되돌린다 — 깨진 JSON이 하위호환을 깨뜨리지 않게. */
export function parseRubric(ref: FinancialDataRef, json: string | null): Record<string, number> {
  const out = { ...DEFAULTS[ref] };
  if (!json) return out;
  let raw: Record<string, unknown> | null = null;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object") return out;
  for (const f of rubricFields(ref)) {
    const v = Number(raw[f.key]);
    if (Number.isFinite(v) && v >= f.min && v <= f.max) out[f.key] = v;
  }
  return out;
}

/** PATCH 입력 정규화 — 알려진 필드·범위 안의 숫자만 남긴다. 유효 필드가
 * 하나도 없으면 null(거부). 부분 PATCH를 허용한다(병합은 저장 시점). */
export function sanitizeRubricInput(ref: FinancialDataRef, input: unknown): Record<string, number> | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const f of rubricFields(ref)) {
    const v = Number(raw[f.key]);
    if (Number.isFinite(v) && v >= f.min && v <= f.max) out[f.key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ── 초안 엔진 ──

export interface DraftMetric { label: string; value: string }
export interface FinancialDraft {
  dataRef: FinancialDataRef;
  /** pass/partial/fail 제안. null = 데이터 부족 등으로 제안 불가(이유는 reason). */
  status: "pass" | "partial" | "fail" | null;
  reason: string | null;
  metrics: DraftMetric[];
  /** 근거 숫자가 담긴 제안 노트 — 사람이 수정한 뒤 판정과 함께 저장된다. */
  note: string;
}

const VERDICT_KO: Record<"pass" | "partial" | "fail", string> = { pass: "충족", partial: "부분충족", fail: "미충족" };

const fmtEok = (v: number): string => v.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
const fmtPct = (ratio: number, digits = 1): string => `${(ratio * 100).toFixed(digits)}%`;
const fmtSignedPct = (ratio: number, digits = 1): string => `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(digits)}%`;

function seriesPoints(analysis: FinancialAnalysis, key: FinancialSeries["key"]): Array<{ year: string; value: number }> {
  const s = analysis.series.find((x) => x.key === key);
  return (s?.points ?? []).filter((p): p is { year: string; value: number } => p.value !== null);
}

function ratioPoints(analysis: FinancialAnalysis, key: "operatingMargin" | "netMargin" | "debtRatio"): Array<{ year: string; value: number }> {
  const out: Array<{ year: string; value: number }> = [];
  for (const r of analysis.ratios) {
    const v = r[key];
    if (v != null) out.push({ year: r.year, value: v });
  }
  return out;
}

function insufficient(dataRef: FinancialDataRef, reason: string, metrics: DraftMetric[] = []): FinancialDraft {
  return { dataRef, status: null, reason, metrics, note: "" };
}

/** 재무 빌트인 항목 1건의 판정 초안 — 결정론적. facts·임계값이 같으면 같은 결과. */
export function draftFinancialVerdict(ref: FinancialDataRef, analysis: FinancialAnalysis, rubricJson: string | null): FinancialDraft {
  const r = parseRubric(ref, rubricJson);
  if (!analysis.available) return insufficient(ref, "동기화된 DART 재무 facts가 없습니다 — 재무 탭에서 동기화하세요.");

  if (ref === "revenue_5y") {
    const pts = seriesPoints(analysis, "revenue");
    if (pts.length === 0) return insufficient(ref, "매출액 facts가 없습니다.");
    if (pts.length < r.minYears) return insufficient(ref, `매출 데이터 ${pts.length}개년 — 최소 ${r.minYears}개년 필요`);
    const first = pts[0].value;
    const last = pts[pts.length - 1].value;
    const prev = pts.length >= 2 ? pts[pts.length - 2].value : null;
    const yoy = prev != null && prev !== 0 ? last / prev - 1 : null;
    // CAGR은 기점·종점 모두 양수일 때만 정의 — 기점 ≤ 0(사업 정리 등)이면
    // 성장률 대신 추이 방향으로 보수적으로 판정한다.
    const cagr = first > 0 && last > 0 ? Math.pow(last / first, 1 / (pts.length - 1)) - 1 : null;
    let status: "pass" | "partial" | "fail";
    let basis: string;
    if (cagr != null) {
      status = cagr * 100 >= r.cagrPass && (yoy == null || yoy >= 0) ? "pass" : cagr * 100 >= r.cagrPartial ? "partial" : "fail";
      basis = `${pts.length}개년 CAGR ${fmtSignedPct(cagr)}(충족 ≥+${r.cagrPass}%), 최근 YoY ${yoy != null ? fmtSignedPct(yoy) : "—"}`;
    } else {
      status = last > first ? "partial" : "fail";
      basis = `기점 매출 ≤ 0으로 CAGR 산출 불가 — 추이(${fmtEok(first)}억원 → ${fmtEok(last)}억원)로 판정`;
    }
    return {
      dataRef: ref,
      status,
      reason: null,
      metrics: [
        { label: `최근 매출(${pts[pts.length - 1].year})`, value: `${fmtEok(last)}억원` },
        ...(cagr != null ? [{ label: `${pts.length}개년 CAGR`, value: fmtSignedPct(cagr) }] : []),
        ...(yoy != null ? [{ label: "최근 YoY", value: fmtSignedPct(yoy) }] : []),
      ],
      note: `DART 자동초안(수정 가능) — ${basis} → ${VERDICT_KO[status]} 제안`,
    };
  }

  if (ref === "operating_profit_5y" || ref === "net_income_5y") {
    const isOp = ref === "operating_profit_5y";
    const label = isOp ? "영업이익" : "당기순이익";
    const pts = seriesPoints(analysis, isOp ? "operatingProfit" : "netIncome");
    if (pts.length === 0) return insufficient(ref, `${label} facts가 없습니다.`);
    if (pts.length < r.minYears) return insufficient(ref, `${label} 데이터 ${pts.length}개년 — 최소 ${r.minYears}개년 필요`);
    const last = pts[pts.length - 1].value;
    const blacks = pts.filter((p) => p.value > 0).length;
    const marginArr = ratioPoints(analysis, isOp ? "operatingMargin" : "netMargin");
    const margin = marginArr.length > 0 ? marginArr[marginArr.length - 1] : null;
    // 최근 연도 적자면 미충족; 전 기간 흑자 + 최근 마진 기충족만 충족; 그 외(과거
    // 일부 적자·마진 미달)는 부분충족 — 사람이 상황 판단으로 조정한다.
    const status: "pass" | "partial" | "fail" =
      last <= 0 ? "fail" : blacks === pts.length && margin != null && margin.value * 100 >= r.marginPass ? "pass" : "partial";
    return {
      dataRef: ref,
      status,
      reason: null,
      metrics: [
        { label: `최근 ${label}(${pts[pts.length - 1].year})`, value: `${fmtEok(last)}억원` },
        { label: "흑자 연도", value: `${blacks}/${pts.length}개년` },
        ...(margin != null ? [{ label: `최근 ${isOp ? "영업" : "순"}이익률`, value: fmtPct(margin.value) }] : []),
      ],
      note: `DART 자동초안(수정 가능) — 흑자 ${blacks}/${pts.length}개년, 최근 ${isOp ? "영업" : "순"}이익률 ${margin != null ? fmtPct(margin.value) : "—"}(충족 ≥${r.marginPass}%) → ${VERDICT_KO[status]} 제안`,
    };
  }

  // debt_5y — 부채비율(부채총계/자본총계) 수준과 기간 상승 폭으로 판정.
  const pts = ratioPoints(analysis, "debtRatio");
  if (pts.length === 0) return insufficient(ref, "부채비율 산출 불가 — 부채총계·자본총계 facts가 부족합니다.");
  if (pts.length < r.minYears) return insufficient(ref, `부채비율 데이터 ${pts.length}개년 — 최소 ${r.minYears}개년 필요`);
  const latest = pts[pts.length - 1];
  const first = pts[0];
  const latestPct = latest.value * 100;
  const risePp = (latest.value - first.value) * 100;
  // 자본잠식(자본 ≤ 0)이면 부채비율이 음수·무한(0 나눗셈)으로 나온다 —
  // 수치가 낮거나 커 보여도 판정 근거가 될 수 없다.
  const insolvent = !Number.isFinite(latest.value) || latest.value <= 0;
  const dispLatest = insolvent ? "산출불가(자본 ≤ 0)" : fmtPct(latest.value, 0);
  let status: "pass" | "partial" | "fail";
  let extra = "";
  if (insolvent) {
    status = "fail";
    extra = "자본잠식(자본총계 ≤ 0)";
  } else if (latestPct > r.ratioPartial) {
    status = "fail";
  } else if (latestPct <= r.ratioPass && risePp <= r.maxRisePp) {
    status = "pass";
  } else {
    status = "partial";
  }
  return {
    dataRef: ref,
    status,
    reason: null,
    metrics: [
      { label: `최근 부채비율(${latest.year})`, value: dispLatest },
      ...(!insolvent ? [{ label: `기간 변화(${first.year}→)`, value: `${risePp >= 0 ? "+" : ""}${risePp.toFixed(0)}p.p.` }] : []),
    ],
    note: `DART 자동초안(수정 가능) — 최근 부채비율 ${dispLatest}(충족 ≤${r.ratioPass}%), 기간 상승 ${insolvent ? "—" : `${risePp >= 0 ? "+" : ""}${risePp.toFixed(0)}p.p.`}(허용 ≤${r.maxRisePp}p.p.)${extra ? `, ${extra}` : ""} → ${VERDICT_KO[status]} 제안`,
  };
}
