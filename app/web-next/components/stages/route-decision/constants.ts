// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.

// GF_SUB / BF_SUB live in lib/labels.ts (single label map); re-exported so existing imports keep working.
export { GF_SUB, BF_SUB } from "../../../lib/labels.ts";
// Stage 2 채점 기준 (각 20% × 1–3점)
export const CRITERIA: Array<{ key: string; label: string; hint: string }> = [
  { key: "control_need", label: "통제 필요도", hint: "1=성과만 공유돼도 충분 ~ 3=운영 통제 없으면 위험" },
  { key: "capability_criticality", label: "역량 결정성", hint: "1=대체 가능 ~ 3=암묵적 지식·대체 불가" },
  { key: "market_uncertainty", label: "시장 불확실성", hint: "1=수요 검증됨 ~ 3=수요·규제 불확실" },
  { key: "integration_capacity", label: "통합 역량", hint: "1=통합 경험·여력 충분 ~ 3=통합 수용력 부족" },
  { key: "speed_to_capability", label: "역량확보 속도", hint: "1=천천히 구축 가능 ~ 3=즉시 확보 필요" },
];
export const SCORE_LABEL: Record<number, string> = { 1: "낮음", 2: "중간", 3: "높음" };
// 사전배제 대상 라우트 — 통제 필요도=高 + 역량접근 의도에서 선택 불가
export const OVERRIDDEN_SUBS = ["partnership", "rbd", "corporate_venture"];

// ── Table column sizing (2026-10-11-table-column-sizing-system, batch 2) ──
// 진출방식 결정 이력 (DecisionTab) — 트랙·라우트·의도·채점은 좁게, 근거·대안(긴 텍스트)에
// 폭을 주고 cell-truncate로 한 줄 유지.
export const DECISION_COL_PCT = [9, 9, 7, 9, 21, 21, 16, 8] as const;
// 경쟁 구조 — 주요 기업 (CompetitiveTab, S4) — 티어 칩은 좁게, 비고에 나머지.
export const S4_COMPETITIVE_COL_PCT = [24, 16, 60] as const;
// 필요 역량 수준 레지스터 (EvalTab, S3 연계) — 역량명·보유 주체·근거가 본문.
export const CAPABILITY_REG_COL_PCT = [30, 16, 32, 22] as const;