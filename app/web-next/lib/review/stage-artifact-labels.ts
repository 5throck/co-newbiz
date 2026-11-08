// Client-safe labels for the stage-artifact registry (F-3/F-4). NO imports —
// this file is consumed by client components (server modules like
// lib/process-flow pull bun:sqlite and cannot enter the client bundle).
// Parity with the server registry (app/web-next/lib/review/stage-artifacts.ts)
// is enforced by tests/unit/review-coverage.test.ts — regenerate that side,
// then regenerate this list to match; never let the two lists drift.

export interface StageArtifactLabel {
  key: string;
  stageId: string;
  label: string;
}

export const STAGE_ARTIFACT_LABELS: readonly StageArtifactLabel[] = [
  { key: "stage:S1:1", stageId: "S1", label: "S1 시장 규모·성장 추정" },
  { key: "stage:S1:2", stageId: "S1", label: "S1 경쟁 구조" },
  { key: "stage:S1:3", stageId: "S1", label: "S1 가치사슬 구조" },
  { key: "stage:S2:1", stageId: "S2", label: "S2 기회 등록" },
  { key: "stage:S2:2", stageId: "S2", label: "S2 진입시장 산정" },
  { key: "stage:S3:1", stageId: "S3", label: "S3 시너지 평가" },
  { key: "stage:S3:2", stageId: "S3", label: "S3 시너지 점수 확정·근거 (전략적 적합성 판단)" },
  { key: "stage:S4:1", stageId: "S4", label: "S4 트랙 결정" },
  { key: "stage:S4:2", stageId: "S4", label: "S4 브라운필드 진출 경로 유형" },
  { key: "stage:S4:3", stageId: "S4", label: "S4 5대 기준 채점 결과" },
  { key: "stage:S4:4", stageId: "S4", label: "S4 검토한 대안" },
  { key: "stage:S4:5", stageId: "S4", label: "S4 법무·규제 스크리닝 판정" },
  { key: "stage:S5:1", stageId: "S5", label: "S5 역량 격차 평가" },
  { key: "stage:S5:2", stageId: "S5", label: "S5 진출전략" },
  { key: "stage:S5:3", stageId: "S5", label: "S5 그린필드 실현가능성 체크리스트 판정" },
  { key: "stage:S5:4", stageId: "S5", label: "S5 부지 선정 체크리스트 판정" },
  { key: "stage:S6:1", stageId: "S6", label: "S6 대상 기업군(Target Universe) 정의" },
  { key: "stage:S6:2", stageId: "S6", label: "S6 대상 기업 롱리스트" },
  { key: "stage:S7:1", stageId: "S7", label: "S7 대상 기업 숏리스트" },
  { key: "stage:S7:2", stageId: "S7", label: "S7 대상 순위·점수" },
  { key: "stage:S7:3", stageId: "S7", label: "S7 제외 사유" },
  { key: "stage:S7:4", stageId: "S7", label: "S7 딜 형태 평가" },
  { key: "stage:S8:1", stageId: "S8", label: "S8 사업성 분석 결과" },
  { key: "stage:S8:2", stageId: "S8", label: "S8 시뮬레이션 NPV 분위수" },
  { key: "stage:S8:3", stageId: "S8", label: "S8 BEP 시점과 시뮬레이션 입력 스냅샷" },
  { key: "stage:S8:4", stageId: "S8", label: "S8 Target 비교 분석" },
  { key: "stage:S8:5", stageId: "S8", label: "S8 대상 선정 기록" },
  { key: "stage:S9:1", stageId: "S9", label: "S9 DD 체크리스트 판정" },
  { key: "stage:S10:1", stageId: "S10", label: "S10 투자구조 가설" },
  { key: "stage:S10:2", stageId: "S10", label: "S10 자금조달 계획" },
  { key: "stage:S11:1", stageId: "S11", label: "S11 투자심의 자료" },
  { key: "stage:S11:2", stageId: "S11", label: "S11 추진계획" },
  { key: "stage:S11:3", stageId: "S11", label: "S11 사람 최종 승인" },
  { key: "stage:S11:4", stageId: "S11", label: "S11 설립 실행 기록" },
  { key: "stage:S12:1", stageId: "S12", label: "S12 벤처 스코어카드" },
  { key: "stage:S12:2", stageId: "S12", label: "S12 사람 전환 결정 기록" },
  { key: "stage:S12:3", stageId: "S12", label: "S12 전환별 결정 부속 기록" },
  { key: "stage:S12:4", stageId: "S12", label: "S12 실행 기준선 대비 차이(greenfield)" },
];

export const stageArtifactLabel = (key: string): string =>
  STAGE_ARTIFACT_LABELS.find((l) => l.key === key)?.label ?? key;

/** Tabs for the given stage(s), in registry order — for <ReviewBuckets artifacts>. */
export const stageArtifactTabs = (...stageIds: readonly string[]): StageArtifactLabel[] =>
  STAGE_ARTIFACT_LABELS.filter((l) => stageIds.includes(l.stageId));
