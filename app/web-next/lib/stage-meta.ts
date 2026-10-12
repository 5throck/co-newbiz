// 단계 메타데이터 (클라이언트 안전 — getDb 비의존). flow.spec.yaml (v2.4.1 기준)
// 의 발췌본이며 tests/unit/process-flow.test.ts의 stage-meta 정합 테스트가
// 스펙과의 일치를 강제한다.
// 표준 화면 패턴 P0 StageFrame/StageRail의 유일한 데이터원 (ADR-0086).

export type StageMetaId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9" | "S10" | "S11" | "S12";
export type GateMetaId = "screening" | "pre_fs" | "target_screening" | "fs" | "dd" | "entity_ic" | "group_ic";
export type TrackId = "greenfield" | "brownfield";

export interface StageMeta {
  id: StageMetaId;
  sequence: number;
  name: string;
  objective: string;
  applicableTracks: Array<TrackId>;
  gateIds: GateMetaId[];
  onComplete: StageMetaId | "terminal";
}

export const GATE_LABEL: Record<GateMetaId, string> = {
  screening: "Screening",
  pre_fs: "Pre-FS",
  target_screening: "Target Screening",
  fs: "FS",
  dd: "DD",
  entity_ic: "법인 심의",
  group_ic: "그룹 심의",
};

export const STAGE_META: StageMeta[] = [
  { id: "S1", sequence: 1, name: "시장분석", objective: "어디에 기회가 있는가?", applicableTracks: ["greenfield", "brownfield"], gateIds: ["screening"], onComplete: "S2" },
  { id: "S2", sequence: 2, name: "기회 발굴", objective: "무엇을 할 것인가?", applicableTracks: ["greenfield", "brownfield"], gateIds: ["screening"], onComplete: "S3" },
  { id: "S3", sequence: 3, name: "시너지·전략적 적합성", objective: "우리가 해야 하는가?", applicableTracks: ["greenfield", "brownfield"], gateIds: ["screening"], onComplete: "S4" },
  { id: "S4", sequence: 4, name: "진출방식 결정", objective: "어떻게 들어갈 것인가?", applicableTracks: ["greenfield", "brownfield"], gateIds: ["screening", "pre_fs"], onComplete: "S5" },
  { id: "S5", sequence: 5, name: "자체 진출", objective: "스스로 진입할 수 있는가?", applicableTracks: ["greenfield"], gateIds: ["pre_fs"], onComplete: "S6" },
  { id: "S6", sequence: 6, name: "대상 후보 발굴", objective: "누구와 결합할 것인가?", applicableTracks: ["brownfield"], gateIds: ["pre_fs"], onComplete: "S7" },
  { id: "S7", sequence: 7, name: "대상 선정", objective: "어떤 대상이 유망한가?", applicableTracks: ["brownfield"], gateIds: ["target_screening"], onComplete: "S8" },
  { id: "S8", sequence: 8, name: "사업성 분석", objective: "돈이 되는가?", applicableTracks: ["greenfield", "brownfield"], gateIds: ["fs"], onComplete: "S9" },
  { id: "S9", sequence: 9, name: "실사·검증", objective: "사실인가? 위험은 무엇인가?", applicableTracks: ["greenfield", "brownfield"], gateIds: ["dd"], onComplete: "S10" },
  { id: "S10", sequence: 10, name: "투자구조 설계", objective: "어떤 그릇으로, 어떤 자금으로 들어갈 것인가?", applicableTracks: ["greenfield", "brownfield"], gateIds: [], onComplete: "S11" },
  { id: "S11", sequence: 11, name: "투자심사·실행", objective: "투자할 것인가?", applicableTracks: ["greenfield", "brownfield"], gateIds: ["entity_ic", "group_ic"], onComplete: "S12" },
  { id: "S12", sequence: 12, name: "사후 관리", objective: "투자 후 사업이 궤도에 올랐는가?", applicableTracks: ["greenfield", "brownfield"], gateIds: [], onComplete: "terminal" },
];

export function getStageMeta(id: StageMetaId): StageMeta {
  return STAGE_META.find((s) => s.id === id)!;
}
