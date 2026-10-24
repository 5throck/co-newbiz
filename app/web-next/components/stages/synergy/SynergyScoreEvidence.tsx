"use client";

// SynergyScoreEvidence — ADR-0182 Phase 2: the synergy score's factor
// breakdown and methodology, rendered beside the score confirm editor in the
// S3 시너지 점수 평가 tab (scoreEval). Data comes from the stored analysis payload
// (synergyScoreFactors + scoreAdjustment + capabilityCoverage). When the
// payload predates ADR-0182 the panel says so instead of recomputing.
//
// 2026-10-18 decider feedback: the panel must show the EQUATION —
// 규칙 점수 = Σ(팩터 점수 × 가중치) → (+LLM 보정) → 권고 → 사람 확정 — so the
// contributions table visibly adds up to the recommendation, and a
// person-confirmed value is never labelled a recommendation.
interface ScoreFactorView {
  key: string;
  label: string;
  baseWeight: number;
  weight: number;
  value: number | null;
  note: string;
}

import { FINANCIAL_CAPACITY_PARAMS, MARKET_ATTRACTIVENESS_CURVE, SYNERGY_FACTOR_WEIGHTS } from "../../../lib/scoring-weights.ts";
import { TranslatorFn } from "../../../i18n/config.ts";
import { useTranslations } from "next-intl";

export interface ScoreConfirmedInfo {
  score: number;
  at: string | null;
  by: string | null;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const CURVE = MARKET_ATTRACTIVENESS_CURVE;
const F = FINANCIAL_CAPACITY_PARAMS;

/** 팩터 점수 산출 규칙 — numbers come from lib/scoring-weights.ts so the legend cannot drift from the engine. Resolved through the component's translator at render. */
const FACTOR_RULES = (t: TranslatorFn): Array<{ key: string; label: string; rule: string }> => [
  {
    key: "market_attractiveness",
    label: t("marketAttractivenessWeightP1", { p1: pct(SYNERGY_FACTOR_WEIGHTS.market_attractiveness) }),
    rule: t("convertsTheLinkedMarketCagr", { p1: pct(CURVE.cagrMidpoint), p2: pct(CURVE.cagrMidpoint + CURVE.cagrUpperSpan) }),
  },
  {
    key: "industry_match",
    label: t("intersectionWeightP1", { p1: pct(SYNERGY_FACTOR_WEIGHTS.industry_match) }),
    rule: t("industriesInTheS1List"),
  },
  {
    key: "financial_capacity",
    label: t("financialHeadroomWeightP1", { p1: pct(SYNERGY_FACTOR_WEIGHTS.financial_capacity) }),
    rule: t("computedFromTheDartRatios", { p1: F.base, p2: pct(F.debtFloor), p3: F.debtPenaltySlope, p4: F.debtPenaltyMax, p5: F.roeSlope, p6: pct(F.roeContribution), p7: F.marginSlope, p8: pct(F.marginContribution) }),
  },
  {
    key: "scope_match",
    label: t("fitWeightP1", { p1: pct(SYNERGY_FACTOR_WEIGHTS.scope_match) }),
    rule: t("scores100WhenTheOpportunity"),
  },
  {
    key: "capability_coverage",
    label: t("requiredCapabilityFulfillmentWeightP1", { p1: pct(SYNERGY_FACTOR_WEIGHTS.capability_coverage) }),
    rule: t("holdingRate05Fulfillment"),
  },
];

interface ScoreEvidenceProps {
  /** synergyScoreFactors from the stored analysis payload — ADR-0103 형식. */
  factors: unknown;
  /** 권고 점수 — the stored payload's synergyScore (rule ± the recorded LLM adjustment). */
  recommendedScore: number | null;
  /** 사람 확정 기록 (opportunity.synergy_score_confirmed_*) — null이면 미확정. */
  confirmed: ScoreConfirmedInfo | null;
  rationale: string | null;
  capabilityCoverage: number | null;
  capabilityCoverageNote: string | null;
  adjustment: { delta: number; reason: string } | null;
}

function isFactorArray(v: unknown): v is ScoreFactorView[] {
  return Array.isArray(v) && v.length > 0 && v.every((f) => typeof f === "object" && f !== null && "key" in f && "label" in f && "value" in f && "weight" in f);
}

export function SynergyScoreEvidence({ factors, recommendedScore, confirmed, rationale, capabilityCoverage, capabilityCoverageNote, adjustment }: ScoreEvidenceProps) {const t = useTranslations("stages.s3.synergyScoreEvidence"); const tc = useTranslations("common");
  // ADR-0182 — STORED factors only. An old payload without a breakdown shows
  // an honest note instead of a client-side recompute with wrong inputs.
  const breakdown: ScoreFactorView[] = isFactorArray(factors) ? factors : [];
  const hasStored = breakdown.length > 0;
  const usable = breakdown.filter((f) => f.value !== null);
  // 규칙 점수 = Σ(팩터 점수 × 가중치) — the engine renormalizes weights over the
  // available factors, so the displayed 기여도 column sums exactly to this.
  const ruleSum = usable.reduce((s, f) => s + (f.value as number) * f.weight, 0);
  const ruleScore = hasStored && usable.length > 0 ? Math.round(ruleSum) : null;
  const recordedDelta = adjustment ? adjustment.delta : null;
  // 보정 유무의 1차 증거는 권고와 규칙 점수의 차이 — scoreAdjustment가 없는
  // 구버전(2026-10-18 이전 산출분)은 사유가 없다는 사실 자체를 명시한다.
  const hasAdjustmentGap = ruleScore !== null && recommendedScore !== null && recommendedScore !== ruleScore;
  // 2026-10-18 디시더 리포트 — 구 4팩터 체계(가중치 35/30/20/15, 충족도 미포함)로
  // 저장된 분석은 현재 체계(30/25/15/10/20)와 가중치가 다르고 충족도가 계산에
  // 없다. 화면이 이 시대 차이를 설명하지 않으면 범례와 표가 어긋나 보인다.
  const hasCapabilityFactor = breakdown.some((f) => f.key === "capability_coverage");
  const legacyScheme = hasStored && !hasCapabilityFactor;
  const storedWeightsText = usable
    .map((f) => `${f.label} ${Math.round(f.weight * 100)}%`)
    .join(" · ");

  return (
    <div className="p-2 border border-[color:var(--border)] rounded mt-2" data-testid="synergy-score-evidence" aria-label={t("synergyScoreCalculationEvidence")}>
      <h4 className="text-[length:var(--fs-caption)] font-semibold mb-1">{t("synergyScoreCalculationEvidenceBy")}</h4>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {t("scoringMethodIncludingRequiredCapability")} {breakdown.length}{t("theSumOfEachFactor")}
      </p>
      {legacyScheme && (
        <p className="text-[length:var(--fs-caption)] mb-2" role="note">
          <span className="status-chip status-amber">{t("savedRecordsFromTheLegacy")}</span>{" "}
          {t("thisAnalysisWasSavedBefore")}{storedWeightsText}{t("differsFromTheCurrentScheme")} <strong>{t("requiredCapabilityFulfillmentIsNot")}</strong>{t("theTableBelowIsThe")}
        </p>
      )}
      {/* 2026-10-18 디시더 피드백 — 팩터 점수가 어떻게 매겨지는지 화면에서 확인 가능하게. 숫자는
          scoring-weights.ts에서 가져와 범례가 엔진과 어긋나지 않는다. */}
      <details className="mb-2">
        <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("viewFactorScoringRulesHow")}</summary>
        <ul className="sizing-note-list mt-1">
          {FACTOR_RULES(t).map((r) => (
            <li key={r.key}><span className="font-semibold">{r.label}</span> — {r.rule}</li>
          ))}
        </ul>
      </details>
      {hasStored ? (
        <table className="data-table w-full text-[length:var(--fs-caption)]" aria-label={t("synergyScoreEvidenceByFactor")}>
          <thead>
            <tr><th scope="col">{t("factor")}</th><th scope="col">{t("score")}</th><th scope="col">{tc("weight")}</th><th scope="col">{t("contributionScoreWeight")}</th><th scope="col">{t("inputEvidence")}</th></tr>
          </thead>
          <tbody>
            {breakdown.map((f) => (
              <tr key={f.key} className={f.value === null ? "text-[color:var(--muted-fg)]" : ""}>
                <td className="font-semibold">{f.label}</td>
                <td className="mono-num">{f.value !== null ? f.value.toFixed(0) : "—"}</td>
                <td className="mono-num">{f.value !== null ? `${Math.round(f.weight * 100)}%` : tc("exclude")}</td>
                <td className="mono-num">{f.value !== null ? (f.value * f.weight).toFixed(1) : "—"}</td>
                <td className="text-[color:var(--muted-fg)]">{f.note}</td>
              </tr>
            ))}
            {legacyScheme && (
              <tr className="text-[color:var(--muted-fg)]">
                <td className="font-semibold">{t("requiredCapabilityFulfillment")}</td>
                <td className="mono-num">{t("notIncluded")}</td>
                <td className="mono-num">—</td>
                <td className="mono-num">—</td>
                <td className="text-[color:var(--muted-fg)]">{t("thisFactorDidNotExist")}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td>{t("ruleWeightedSum")}</td>
              <td />
              <td className="mono-num">{Math.round(usable.reduce((s, f) => s + f.weight, 0) * 100)}%</td>
              <td className="mono-num">{ruleSum.toFixed(1)} → {ruleScore}{t("pt")}</td>
              <td className="text-[color:var(--muted-fg)]">{t("contributionSumRuleScore")}</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
          {t("thisAnalysisPredatesEvidenceStorage")}
        </p>
      )}
      {capabilityCoverage != null && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
          {t("requiredCapabilityFulfillment2")} {capabilityCoverageNote ?? `${capabilityCoverage}%`}
        </p>
      )}
      {/* 권고 도출 단계: 규칙 가중합 → (LLM 보정) → 권고 — 등식이 화면에서 닫힌다 */}
      {hasAdjustmentGap && (
        <p className="text-[length:var(--fs-caption)] mt-1 mb-0">
          {t("llmCalibration")} {recommendedScore !== null && ruleScore !== null && recommendedScore > ruleScore ? "+" : ""}{(recommendedScore ?? 0) - (ruleScore ?? 0)}{t("pt2")}{" "}
          {recordedDelta !== null && adjustment?.reason ? (
            <>{tc("reasonColon")} {adjustment.reason}</>
          ) : (
            <span className="text-[color:var(--muted-fg)]">{t("aVersionFromBeforeCalibration")}</span>
          )}
        </p>
      )}
      {recommendedScore != null ? (
        <p className="text-[length:var(--fs-caption)] mt-1 mb-0">
          {t("recommendationScore")} <strong className="mono-num">{recommendedScore}</strong>/100
          <span className="text-[color:var(--muted-fg)]"> {t("aRecommendationBeforeHumanConfirmation")}</span>
        </p>
      ) : null}
      {confirmed && (
        <p className="text-[length:var(--fs-caption)] mt-1 mb-0">
          <span className="status-chip status-green">{t("humanConfirmationFinal")} <span className="mono-num">{confirmed.score}</span>{t("pt3")}</span>
          {confirmed.at && <span className="text-[color:var(--muted-fg)]"> — {confirmed.at.slice(0, 10)}{confirmed.by ? ` · ${confirmed.by}` : ""}</span>}
          {recommendedScore != null && confirmed.score !== recommendedScore && (
            <span className="text-[color:var(--muted-fg)]"> {t("recommendation")} {recommendedScore}{t("ptIsAnotherPersonS")}</span>
          )}
        </p>
      )}
      {rationale && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">{t("overallEvidence")} {rationale}</p>
      )}
    </div>
  );
}
