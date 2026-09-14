// S3 시너지·전략적 적합성 (flow.spec v2.0.0) — 기회별 시너지 산출물 + screening
// 진행 권고. 별도의 "적합성 판정"(Go/Hold/Kill, opportunity.fit_verdict)은
// 2026-09-15 제거했다 — 매력도(S2)·시너지(S3) 두 축을 이미 합산하는 이
// 파일의 gateRecommendation()과 S4 진출방식 추천(track-advisory.ts)이 같은
// 원천 신호를 각각 다시 계산해 겹치는 구조였고, 그중 knock-out 전용의 독립
// 정성 판정 계층(적합성 판정)은 사용자 판단으로 중복 제거 대상이 되었다.
// screening 진행 권고는 이제 매력도·시너지 두 값만으로 계산한다.
import { getDb } from "../../../db/client.ts";

export interface ScreeningState {
  synergy_score: number | null;
  synergy_rationale: string | null;
  /** screening 진행 권고 — 매력도·시너지 산출물이 모두 있을 때만 산출 */
  gate: { recommendation: "Go" | "Hold" | "Kill"; rationale: string } | null;
}

export function loadScreeningState(id: string): ScreeningState | null {
  const row = getDb()
    .query("SELECT synergy_score, synergy_rationale, attractiveness_score FROM opportunity WHERE id = ?")
    .get(id) as Omit<ScreeningState, "gate"> & { attractiveness_score: number | null } | undefined;
  if (!row) return null;
  return { ...row, gate: gateRecommendation(row) };
}

/** screening 진행 권고 — 매력도·시너지 두 값을 조합.
 *  gate-brief.ts의 결정론 폴백도 동일 기준을 재사용한다 (ADR-0118). */
export function gateRecommendation(row: { attractiveness_score: number | null; synergy_score: number | null }): ScreeningState["gate"] {
  if (row.synergy_score === null || row.attractiveness_score === null) return null;
  const attractiveness = row.attractiveness_score;
  const synergy = row.synergy_score;
  const recommendation = (synergy >= 60 && attractiveness >= 60) ? "Go"
    : (synergy < 40 || attractiveness < 60) ? "Kill"
    : "Hold";
  return {
    recommendation,
    rationale: `시장 매력도 ${attractiveness}점 + 시너지 ${synergy}점 → screening 진행 권고 ${recommendation} (합의 기준: 매력도 ≥ 60 AND 시너지 ≥ 60 → Go, 매력도 < 60 OR 시너지 < 40 → Kill, 그 외 Hold)`,
  };
}

export function stampDecision(id: string, userId: string): void {
  getDb().run("UPDATE opportunity SET decided_by = ?, decided_at = ? WHERE id = ?", [userId, new Date().toISOString(), id]);
}
