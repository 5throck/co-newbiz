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

export interface ScoreFactor {
  key: "market_attractiveness" | "industry_match" | "financial_capacity" | "scope_match";
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

export interface ScoreInputs {
  opportunity: { market_scope: string | null; value_chain_node: string | null; name: string } | null;
  profile: {
    industryExposure: string[];
    strengths?: string[];
    ratios?: Array<{ year: string; debtRatio?: number | null; roe?: number | null; operatingMargin?: number | null }>;
  } | null;
  markets: MarketSnapshot[]; // completed S1 analyses (latest version each)
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

  // 1) Market attractiveness — linked market's CAGR (10%→0, 45%+→100).
  if (market && market.cagr !== null) {
    const value = clamp(((market.cagr - 0.1) / 0.35) * 100);
    factors.push({
      key: "market_attractiveness", label: "시장 매력도", baseWeight: 0.35, weight: 0.35, value,
      note: `${market.industry} 성장률 ${(market.cagr * 100).toFixed(0)}% → 정규화 ${value.toFixed(0)}/100`,
    });
  } else {
    missing.push("완료된 S1 시장분석(CAGR) 없음 — 시장 매력도 팩터 미반영");
    factors.push({ key: "market_attractiveness", label: "시장 매력도", baseWeight: 0.35, weight: 0, value: null, note: "입력 부재로 제외" });
  }

  // 2) Industry match — S1 후방/전방 산업 × 프로파일 산업노출/강점 교집합.
  const exposure = inputs.profile?.industryExposure ?? [];
  const strengths = inputs.profile?.strengths ?? [];
  const related = market?.relatedIndustries ?? [];
  if (related.length && (exposure.length || strengths.length)) {
    const value = overlapScore(related, [...exposure, ...strengths]);
    factors.push({
      key: "industry_match", label: "산업·역량 교집합", baseWeight: 0.3, weight: 0.3, value,
      note: `S1 인접 산업 ${related.length}개 중 프로파일 노출/강점과 매칭 ${Math.round((value / 100) * related.length)}건 (노출 ${exposure.length}·강점 ${strengths.length}개 대조)`,
    });
  } else {
    missing.push("S1 인접 산업 또는 프로파일 산업노출 부재 — 산업 매칭 팩터 미반영");
    factors.push({ key: "industry_match", label: "산업·역량 교집합", baseWeight: 0.3, weight: 0, value: null, note: "입력 부재로 제외" });
  }

  // 3) Financial capacity — 최신 연도 DART 비율 (부채비율 낮을수록, ROE·마진 높을수록 유리).
  const ratios = inputs.profile?.ratios?.filter((r) => r.debtRatio !== null || r.roe !== null) ?? [];
  const latest = ratios[ratios.length - 1];
  if (latest) {
    const debt = latest.debtRatio ?? null;
    const roe = latest.roe ?? null;
    const margin = latest.operatingMargin ?? null;
    const debtPenalty = debt !== null ? clamp((debt - 0.4) * 180, -40, 40) : 0;
    const roePoints = roe !== null ? clamp(roe * 350) : 0;
    const marginPoints = margin !== null ? clamp(margin * 300) : 0;
    const value = clamp(45 + roePoints * 0.5 + marginPoints * 0.3 - debtPenalty);
    factors.push({
      key: "financial_capacity", label: "재무 여력", baseWeight: 0.2, weight: 0.2, value,
      note: `${latest.year}년 부채비율 ${debt !== null ? (debt * 100).toFixed(0) + "%" : "—"}, ROE ${roe !== null ? (roe * 100).toFixed(1) + "%" : "—"}, 영업이익률 ${margin !== null ? (margin * 100).toFixed(1) + "%" : "—"}`,
    });
  } else {
    missing.push("DART 재무 비율 없음 — 재무 여력 팩터 미반영");
    factors.push({ key: "financial_capacity", label: "재무 여력", baseWeight: 0.2, weight: 0, value: null, note: "입력 부재로 제외" });
  }

  // 4) Scope match — 기회 market_scope와 시장분석 산업명 일치도.
  if (inputs.opportunity?.market_scope) {
    const value = matched ? 100 : overlapScore([inputs.opportunity.market_scope, inputs.opportunity.value_chain_node ?? ""], market ? [market.industry] : []);
    factors.push({
      key: "scope_match", label: "기회-시장 일치도", baseWeight: 0.15, weight: 0.15, value,
      note: matched ? `기회 범위 '${inputs.opportunity.market_scope}' ↔ S1 산업명 직접 일치` : `직접 일치 없음 — 어휘 겹침 기준 ${value.toFixed(0)}/100`,
    });
  } else {
    missing.push("기회 market_scope 미기재 — 일치도 팩터 미반영");
    factors.push({ key: "scope_match", label: "기회-시장 일치도", baseWeight: 0.15, weight: 0, value: null, note: "입력 부재로 제외" });
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
