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