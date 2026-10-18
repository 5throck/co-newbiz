"use client";

// SynergyScoreEvidence — ADR-0182 Phase 2: the synergy score's factor
// breakdown and methodology, rendered beside the score confirm editor in the
// S3 시너지 점수 평가 tab (scoreEval). Data comes from the stored analysis payload
// (synergyScoreFactors + scoreAdjustment + capabilityCoverage). When the
// payload predates ADR-0182 the panel recomputes deterministically from
// current DB state via computeSynergyScore and says so.
interface ScoreFactorView {
  key: string;
  label: string;
  baseWeight: number;
  weight: number;
  value: number | null;
  note: string;
}

interface ScoreEvidenceProps {
  /** synergyScoreFactors from the stored analysis payload — ADR-0103 형식. */
  factors: unknown;
  finalScore: number | null;
  rationale: string | null;
  capabilityCoverage: number | null;
  capabilityCoverageNote: string | null;
  adjustment: { delta: number; reason: string } | null;
}

function isFactorArray(v: unknown): v is ScoreFactorView[] {
  return Array.isArray(v) && v.length > 0 && v.every((f) => typeof f === "object" && f !== null && "key" in f && "label" in f && "value" in f && "weight" in f);
}

export function SynergyScoreEvidence({ factors, finalScore, rationale, capabilityCoverage, capabilityCoverageNote, adjustment }: ScoreEvidenceProps) {
  // ADR-0182 — STORED factors only. An old payload without a breakdown shows
  // an honest note instead of a client-side recompute with wrong inputs.
  const breakdown: ScoreFactorView[] = isFactorArray(factors) ? factors : [];
  const hasStored = breakdown.length > 0;

  return (
    <div className="p-2 border border-[color:var(--border)] rounded mt-2" data-testid="synergy-score-evidence" aria-label="시너지 점수 산정 근거">
      <h4 className="text-[length:var(--fs-caption)] font-semibold mb-1">시너지 점수 산정 근거 (팩터별)</h4>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        산정 방법: 필요 역량 충족도를 포함한 {breakdown.length}개 팩터의 0-100 점수를 가중 평가합니다 (결정론적·재현 가능). LLM 가용 시 ±10점 이내 정성 보정이 추가되며, 최종 확정은 사람의 행위입니다 (경계 #2).
      </p>
      <table className="data-table w-full text-[length:var(--fs-caption)]" aria-label="시너지 점수 팩터별 근거">
        <thead>
          <tr><th scope="col">팩터</th><th scope="col">점수 (0-100)</th><th scope="col">가중치</th><th scope="col">기여도</th><th scope="col">입력 근거</th></tr>
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
      </table>
      {capabilityCoverage != null && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
          필요 역량 충족도: {capabilityCoverageNote ?? `${capabilityCoverage}%`}
        </p>
      )}
      {!hasStored && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
          이 분석은 팩터별 근거가 저장되기 이전 버전입니다 — 재분석 시 저장됩니다.
        </p>
      )}
      {rationale && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">종합 근거: {rationale}</p>
      )}
      {finalScore != null && (
        <p className="text-[length:var(--fs-caption)] mt-1 mb-0">
          최종 권고 점수: <strong className="mono-num">{finalScore}</strong>/100
        </p>
      )}
    </div>
  );
}
