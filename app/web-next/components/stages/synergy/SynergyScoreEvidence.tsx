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

export interface ScoreConfirmedInfo {
  score: number;
  at: string | null;
  by: string | null;
}

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

export function SynergyScoreEvidence({ factors, recommendedScore, confirmed, rationale, capabilityCoverage, capabilityCoverageNote, adjustment }: ScoreEvidenceProps) {
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

  return (
    <div className="p-2 border border-[color:var(--border)] rounded mt-2" data-testid="synergy-score-evidence" aria-label="시너지 점수 산정 근거">
      <h4 className="text-[length:var(--fs-caption)] font-semibold mb-1">시너지 점수 산정 근거 (팩터별)</h4>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        산정 방법: 필요 역량 충족도를 포함한 {breakdown.length}개 팩터의 점수 × 가중치 합이 규칙 점수가 되고, LLM 가용 시 ±10점 이내 정성 보정이 더해져 권고 점수가 됩니다. 최종 확정은 사람의 행위입니다 (경계 #2).
      </p>
      {hasStored ? (
        <table className="data-table w-full text-[length:var(--fs-caption)]" aria-label="시너지 점수 팩터별 근거">
          <thead>
            <tr><th scope="col">팩터</th><th scope="col">점수 (0-100)</th><th scope="col">가중치</th><th scope="col">기여도 (점수×가중치)</th><th scope="col">입력 근거</th></tr>
          </thead>
          <tbody>
            {breakdown.map((f) => (
              <tr key={f.key} className={f.value === null ? "text-[color:var(--muted-fg)]" : ""}>
                <td className="font-semibold">{f.label}</td>
                <td className="mono-num">{f.value !== null ? f.value.toFixed(0) : "—"}</td>
                <td className="mono-num">{f.value !== null ? `${Math.round(f.weight * 100)}%` : "제외"}</td>
                <td className="mono-num">{f.value !== null ? (f.value * f.weight).toFixed(1) : "—"}</td>
                <td className="text-[color:var(--muted-fg)]">{f.note}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td>규칙 가중합</td>
              <td />
              <td className="mono-num">{Math.round(usable.reduce((s, f) => s + f.weight, 0) * 100)}%</td>
              <td className="mono-num">{ruleSum.toFixed(1)} → {ruleScore}점</td>
              <td className="text-[color:var(--muted-fg)]">기여도 합계 = 규칙 점수</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
          이 분석은 팩터별 근거가 저장되기 이전 버전입니다 — 재분석 시 저장됩니다.
        </p>
      )}
      {capabilityCoverage != null && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
          필요 역량 충족도: {capabilityCoverageNote ?? `${capabilityCoverage}%`}
        </p>
      )}
      {/* 권고 도출 단계: 규칙 가중합 → (LLM 보정) → 권고 — 등식이 화면에서 닫힌다 */}
      {hasAdjustmentGap && (
        <p className="text-[length:var(--fs-caption)] mt-1 mb-0">
          LLM 보정 {recommendedScore !== null && ruleScore !== null && recommendedScore > ruleScore ? "+" : ""}{(recommendedScore ?? 0) - (ruleScore ?? 0)}점 →{" "}
          {recordedDelta !== null && adjustment?.reason ? (
            <>사유: {adjustment.reason}</>
          ) : (
            <span className="text-[color:var(--muted-fg)]">보정 내역이 기록되기 이전 버전입니다 — 사유 미기록, 재분석 시 기록됩니다.</span>
          )}
        </p>
      )}
      {recommendedScore != null ? (
        <p className="text-[length:var(--fs-caption)] mt-1 mb-0">
          권고 점수: <strong className="mono-num">{recommendedScore}</strong>/100
          <span className="text-[color:var(--muted-fg)]"> — 사람 확정 전 권고이며 S4 트랙 근거로는 반영되지 않습니다.</span>
        </p>
      ) : null}
      {confirmed && (
        <p className="text-[length:var(--fs-caption)] mt-1 mb-0">
          <span className="status-chip status-green">사람 확정 <span className="mono-num">{confirmed.score}</span>점</span>
          {confirmed.at && <span className="text-[color:var(--muted-fg)]"> — {confirmed.at.slice(0, 10)}{confirmed.by ? ` · ${confirmed.by}` : ""}</span>}
          {recommendedScore != null && confirmed.score !== recommendedScore && (
            <span className="text-[color:var(--muted-fg)]"> · 권고 {recommendedScore}점과 다른 사람의 판단이며, 확정값이 최종입니다</span>
          )}
        </p>
      )}
      {rationale && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">종합 근거: {rationale}</p>
      )}
    </div>
  );
}
