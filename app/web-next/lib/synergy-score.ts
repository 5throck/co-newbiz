// Deterministic synergy scoring engine — ADR-0102 (hybrid scoring, decision 1).
//
// Computes a 0-100 synergy recommendation from STRUCTURED data already in the
// DB (S1 sizing matrices, company-profile financials/exposure, the linked
// opportunity) with a per-factor breakdown, so the score is explainable and
// reproducible without an LLM. The synergy pipeline layers an optional LLM
// narrative + bounded (±10) adjustment on top; the score itself remains a
// recommendation until a human confirms it (boundary #2, ADR-0090).
//
// Fail-closed: with fewer than MIN_FACTORS usable factors the score is null
// and the missing inputs are listed — never a fabricated number.
//
// All tunable methodology numbers (factor weights, curve breakpoints,
// financial-capacity slopes) live in lib/scoring-weights.ts — the single
// data module for scoring defaults (ADR-0024/0044 profile-first principle).
import {
  FINANCIAL_CAPACITY_PARAMS,
  MARKET_ATTRACTIVENESS_CURVE,
  SYNERGY_FACTOR_WEIGHTS,
} from "./scoring-weights.ts";

export interface ScoreFactor {
  key: "market_attractiveness" | "industry_match" | "financial_capacity" | "scope_match" | "capability_coverage";
  label: string;
  weight: number; // renormalized weight actually applied
  baseWeight: number;
  value: number | null; // 0-100, null = input missing
  note: string;
}

export interface SynergyScoreResult {
  score: number | null;
  method: "rule-based";
  factors: ScoreFactor[];
  missing: string[];
}

const MIN_FACTORS = 2;

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

interface MarketSnapshot {
  industry: string;
  cagr: number | null; // fraction (0.35 = 35%)
  externalTargetYear?: number | null;
  externalMarketSize?: number | null; // $B
  relatedIndustries: string[]; // 후방/전방 산업 이름 목록 (chainDirection)
}

/** bottomUpCagr 저장 단위는 ×100 %p이고 작성자는 market-sizing-pipeline 하나다
 *  (단일 작성자, 단일 단위 — DEC-20261104-06 item B). 따라서 /100 환산은
 *  무조건 적용한다(구 `> 1` 휴리스틱 제거 — 0.8%p·음수를 분수로 오인했던 결함).
 *  작성자 봉투는 [-1, 0.25] 분수, 즉 저장값 [-100, 25] %p다(cagrBase 상한 0.25
 *  하드캡). 그러므로 환산 결과가 비유한수이거나 |분수| > 1(저장값 |pct| > 100)이면
 *  외부 주입 단위 계약 위반 입력으로 보고 null — 팩터는 미반영 제외 경로로 간다.
 *  (검토 2차: 세척 밴드 (0.25, 10]을 닫기 위해 |분수| > 10에서 > 1로 강화.) */
export function toCagrFraction(cagrPct: number | null): number | null {
  if (cagrPct === null) return null;
  const c = cagrPct / 100;
  return Number.isFinite(c) && Math.abs(c) <= 1 ? c : null;
}

export interface ScoreInputs {
  opportunity: { market_scope: string | null; value_chain_node: string | null; name: string } | null;
  profile: {
    industryExposure: string[];
    strengths?: string[];
    ratios?: Array<{ year: string; debtRatio?: number | null; roe?: number | null; operatingMargin?: number | null }>;
  } | null;
  markets: MarketSnapshot[]; // completed S1 analyses (latest version each)
  /** ADR-0182 — 필요 역량 충족도 (0-100): the capability register's
   *  holding coverage (holding ratio weighted ×2 for essential rows).
   *  Null/undefined when the register is empty or unjudged → the factor is
   *  excluded (미반영 명시), never fabricated. */
  capabilityCoverage?: number | null;
  capabilityCoverageNote?: string | null;
}

const tokens = (s: string): string[] =>
  s.toLowerCase().replace(/[()·,]/g, " ").split(/\s+/).filter((t) => t.length >= 2);

function overlapScore(a: string[], b: string[]): number {
  const setB = new Set(b.flatMap(tokens));
  if (!setB.size) return 0;
  const hits = a.filter((t) => tokens(t).some((x) => setB.has(x))).length;
  return clamp((hits / Math.max(1, a.length)) * 100);
}

/** Pick the completed market that best matches the opportunity's scope (or the only/newest one). */
function pickMarket(inputs: ScoreInputs): { market: MarketSnapshot | null; matched: boolean } {
  const scope = inputs.opportunity?.market_scope?.trim();
  if (!inputs.markets.length) return { market: null, matched: false };
  if (!scope) return { market: inputs.markets[0], matched: false };
  const exact = inputs.markets.find((m) => m.industry === scope);
  if (exact) return { market: exact, matched: true };
  const partial = inputs.markets.find((m) => m.industry.includes(scope) || scope.includes(m.industry));
  if (partial) return { market: partial, matched: true };
  return { market: inputs.markets[0], matched: false };
}

export function computeSynergyScore(inputs: ScoreInputs): SynergyScoreResult {
  const factors: ScoreFactor[] = [];
  const missing: string[] = [];
  const { market, matched } = pickMarket(inputs);

  // 1) Market attractiveness — linked market's CAGR. Piecewise curve so
  // mature markets are not flattened to 0: 0%→0, 8%→50, 35%+→100.
  // Fail-closed(4element amendment 2026-11-04, DEC-20261104-06 item C): 성장률이
  // null·비유한수·≤0이면 매력도 곡선의 정의역 밖 — 0/100으로 클램프해 날조하지
  // 않고 팩터를 제외한다(누락 입력과 동일한 취급, 위 원칙 준수).
  if (market && market.cagr !== null && Number.isFinite(market.cagr) && market.cagr > 0) {
    const c = market.cagr;
    const { cagrMidpoint, cagrUpperSpan, midpointScore } = MARKET_ATTRACTIVENESS_CURVE;
    const value =
      c <= cagrMidpoint
        ? clamp((c / cagrMidpoint) * midpointScore)
        : clamp(midpointScore + ((c - cagrMidpoint) / cagrUpperSpan) * midpointScore);
    factors.push({
      key: "market_attractiveness", label: "시장 매력도",
      baseWeight: SYNERGY_FACTOR_WEIGHTS.market_attractiveness, weight: SYNERGY_FACTOR_WEIGHTS.market_attractiveness, value,
      note: `${market.industry} 성장률 ${(c * 100).toFixed(1)}% → 정규화 ${value.toFixed(0)}/100`,
    });
  } else if (market) {
    // 시장은 연결됐지만 성장률이 비정상/비양수 — 입력 부재가 아닌 입력 결함으로 제외.
    missing.push("성장률 비정상/비양수 — 시장 매력도 팩터 미반영");
    factors.push({
      key: "market_attractiveness", label: "시장 매력도",
      baseWeight: SYNERGY_FACTOR_WEIGHTS.market_attractiveness, weight: 0, value: null, note: "성장률 비정상/비양수 — 시장 매력도 팩터 미반영" });
  } else {
    missing.push("완료된 S1 시장분석(CAGR) 없음 — 시장 매력도 팩터 미반영");
    factors.push({
      key: "market_attractiveness", label: "시장 매력도",
      baseWeight: SYNERGY_FACTOR_WEIGHTS.market_attractiveness, weight: 0, value: null, note: "입력 부재로 제외" });
  }

  // 2) Industry match — S1 후방/전방 산업 × 프로파일 산업노출/강점 교집합.
  const exposure = inputs.profile?.industryExposure ?? [];
  const strengths = inputs.profile?.strengths ?? [];
  const related = market?.relatedIndustries ?? [];
  if (related.length && (exposure.length || strengths.length)) {
    const value = overlapScore(related, [...exposure, ...strengths]);
    factors.push({
      key: "industry_match", label: "산업·역량 교집합",
      baseWeight: SYNERGY_FACTOR_WEIGHTS.industry_match, weight: SYNERGY_FACTOR_WEIGHTS.industry_match, value,
      note: `S1 인접 산업 ${related.length}개 중 프로파일 노출/강점과 매칭 ${Math.round((value / 100) * related.length)}건 (노출 ${exposure.length}·강점 ${strengths.length}개 대조)`,
    });
  } else {
    missing.push("S1 인접 산업 또는 프로파일 산업노출 부재 — 산업 매칭 팩터 미반영");
    factors.push({ key: "industry_match", label: "산업·역량 교집합", baseWeight: SYNERGY_FACTOR_WEIGHTS.industry_match, weight: 0, value: null, note: "입력 부재로 제외" });
  }

  // 3) Financial capacity — 최신 연도 DART 비율 (부채비율 낮을수록, ROE·마진 높을수록 유리).
  const ratios = inputs.profile?.ratios?.filter((r) => r.debtRatio !== null || r.roe !== null) ?? [];
  const latest = ratios[ratios.length - 1];
  if (latest) {
    const debt = latest.debtRatio ?? null;
    const roe = latest.roe ?? null;
    const margin = latest.operatingMargin ?? null;
    const P = FINANCIAL_CAPACITY_PARAMS;
    const debtPenalty = debt !== null ? clamp((debt - P.debtFloor) * P.debtPenaltySlope, P.debtPenaltyMin, P.debtPenaltyMax) : 0;
    const roePoints = roe !== null ? clamp(roe * P.roeSlope) : 0;
    const marginPoints = margin !== null ? clamp(margin * P.marginSlope) : 0;
    const value = clamp(P.base + roePoints * P.roeContribution + marginPoints * P.marginContribution - debtPenalty);
    factors.push({
      key: "financial_capacity", label: "재무 여력",
      baseWeight: SYNERGY_FACTOR_WEIGHTS.financial_capacity, weight: SYNERGY_FACTOR_WEIGHTS.financial_capacity, value,
      note: `${latest.year}년 부채비율 ${debt !== null ? (debt * 100).toFixed(0) + "%" : "—"}, ROE ${roe !== null ? (roe * 100).toFixed(1) + "%" : "—"}, 영업이익률 ${margin !== null ? (margin * 100).toFixed(1) + "%" : "—"}`,
    });
  } else {
    missing.push("DART 재무 비율 없음 — 재무 여력 팩터 미반영");
    factors.push({ key: "financial_capacity", label: "재무 여력", baseWeight: SYNERGY_FACTOR_WEIGHTS.financial_capacity, weight: 0, value: null, note: "입력 부재로 제외" });
  }

  // 3.5) ADR-0182 — 필요 역량 충족도 (capability coverage): the register's
  // holding coverage 0-100. Absent register → factor excluded with a missing
  // note (never a fabricated 0/100).
  if (typeof inputs.capabilityCoverage === "number" && Number.isFinite(inputs.capabilityCoverage)) {
    const value = clamp(inputs.capabilityCoverage);
    factors.push({
      key: "capability_coverage", label: "필요 역량 충족도",
      baseWeight: SYNERGY_FACTOR_WEIGHTS.capability_coverage, weight: SYNERGY_FACTOR_WEIGHTS.capability_coverage, value,
      note: inputs.capabilityCoverageNote ?? `필요 역량 레지스터 보유율 기준 ${value.toFixed(0)}/100`,
    });
  } else {
    missing.push("필요 역량 레지스터 미입력 — 충족도 팩터 미반영");
    factors.push({
      key: "capability_coverage", label: "필요 역량 충족도",
      baseWeight: SYNERGY_FACTOR_WEIGHTS.capability_coverage, weight: 0, value: null, note: "입력 부재로 제외" });
  }

  // 4) Scope match — 기회 market_scope와 시장분석 산업명 일치도.
  if (inputs.opportunity?.market_scope) {
    const value = matched ? 100 : overlapScore([inputs.opportunity.market_scope, inputs.opportunity.value_chain_node ?? ""], market ? [market.industry] : []);
    factors.push({
      key: "scope_match", label: "기회-시장 일치도",
      baseWeight: SYNERGY_FACTOR_WEIGHTS.scope_match, weight: SYNERGY_FACTOR_WEIGHTS.scope_match, value,
      note: matched ? `기회 범위 '${inputs.opportunity.market_scope}' ↔ S1 산업명 직접 일치` : `직접 일치 없음 — 어휘 겹침 기준 ${value.toFixed(0)}/100`,
    });
  } else {
    missing.push("기회 market_scope 미기재 — 일치도 팩터 미반영");
    factors.push({ key: "scope_match", label: "기회-시장 일치도", baseWeight: SYNERGY_FACTOR_WEIGHTS.scope_match, weight: 0, value: null, note: "입력 부재로 제외" });
  }

  const usable = factors.filter((f) => f.value !== null);
  const weightSum = usable.reduce((s, f) => s + f.weight, 0);
  if (usable.length < MIN_FACTORS || weightSum <= 0) {
    return { score: null, method: "rule-based", factors, missing: [...missing, `사용 가능 팩터 ${usable.length}개 — 최소 ${MIN_FACTORS}개 필요`], };
  }

  // Renormalize weights over available factors so a missing input doesn't
  // silently deflate the score.
  const score = clamp(usable.reduce((s, f) => s + (f.value as number) * (f.weight / weightSum), 0));
  for (const f of factors) if (f.value !== null) f.weight = f.weight / weightSum;
  return { score: Math.round(score), method: "rule-based", factors, missing };
}
