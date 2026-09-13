// 단계 연계 스트립 표시 데이터 (ADR-0120 단계 연계, flow.spec inputs/outputs의
// 프레젠테이션 발췌). 스펙이 SSOT이며 이 레코드는 화면 표시용 문자열이다 —
// StageFrame이 모든 단계 화면에 자동 렌더링한다.
import type { StageMetaId } from "./stage-meta.ts";

export interface StageHandoff {
  inputs: string[];
  output: string;
}

export const STAGE_HANDOFF: Record<StageMetaId, StageHandoff> = {
  S1: { inputs: ["외부 시장 데이터", "KSIC 코드 마스터", "산업 프로파일"], output: "S2 기회 발굴" },
  S2: { inputs: ["S1 시장 규모·성장", "S1 가치사슬 구조"], output: "S3 시너지·적합성" },
  S3: { inputs: ["S2 기회 퍼널", "그룹/계열사 프로파일"], output: "S4 진출방식 결정" },
  S4: { inputs: ["S3 시너지 점수·적합성", "S1 시장 불확실성"], output: "S5 (그린필드) / S6 (브라운필드)" },
  S5: { inputs: ["S4 트랙 (greenfield)", "S3 필요 역량", "자사 역량·조직"], output: "S8 사업성 분석 (승격 후)" },
  S6: { inputs: ["S4 트랙·라우트", "S1 시장 정의·가치사슬", "S3 필요 역량·진입 조건"], output: "S7 대상 선정" },
  S7: { inputs: ["S6 Universe 정의", "S6 Long List"], output: "S8 사업성 분석 (승격)" },
  S8: { inputs: ["S5 진출전략·BC 라인 (GF)", "S7 Short List 재무 (BF)", "WACC 확정값"], output: "S9 실사·검증" },
  S9: { inputs: ["S8 채택 BC (체크리스트 테일러링)", "진행 체크리스트"], output: "S10 투자구조 설계" },
  S10: { inputs: ["S8 채택 BC", "S9 발견사항 (가치 영향)", "WACC·hurdle"], output: "S11 투자심사 (IC 패키지)" },
  S11: { inputs: ["S10 구조 가설·자금조달", "채택 BC", "차터 기준선", "DD 발견사항"], output: "S12 사후 관리" },
  S12: { inputs: ["S11 IC 승인", "차터 KPI 선커밋 (목표값 자동 병합)", "PMI 시너지 추적"], output: "포트폴리오 전환 결정 (종료)" },
};
