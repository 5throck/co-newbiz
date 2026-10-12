// Generated from process/flow.spec.yaml. Do not edit by hand; regenerate with:
// bun scripts/co-newbiz/generate-spec-activities.ts (--check exits 1 on drift;
// tests/unit/mcp-prompts.test.ts runs it). Source of the MCP stage_guide_s*
// prompts and flowspec:// resources (ADR-0154, Wave M M-3).
import type { StageGuideSpec } from "./stage-guides.ts";

export const GUIDE_SPEC_VERSION = "2.8.0";
export const GUIDE_STAGES: StageGuideSpec[] = [
  {
    "id": "S1",
    "name": "시장분석",
    "objective": "어디에 기회가 있는가? — 시장 규모·성장·경쟁구조와 가치사슬을 파악한다",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "gates": [
      "screening"
    ],
    "activities": [
      {
        "id": "market-research",
        "agent": "market-intelligence-agent",
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "competitive-intelligence",
        "agent": "market-intelligence-agent",
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "value-chain-analysis",
        "agent": "market-intelligence-agent",
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      }
    ],
    "requiredArtifacts": [
      "시장 규모·성장 추정",
      "경쟁 구조",
      "가치사슬 구조"
    ],
    "completionCriteria": [
      "최소 1개의 정량화된 수요 추정(직접 또는 프록시 체인)이 존재한다",
      "최신 완료 버전의 매트릭스에 경쟁 구조(집중도 요약·주요 플레이어)가 기록되었다",
      "데이터 신뢰도 등급이 기록되었다"
    ]
  },
  {
    "id": "S2",
    "name": "기회 발굴",
    "objective": "무엇을 할 것인가? — 가치사슬상 사업 기회를 등록·평가한다",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "gates": [
      "screening"
    ],
    "activities": [
      {
        "id": "opportunity-discovery",
        "agent": "market-intelligence-agent",
        "procedure": [
          "opportunity-discovery",
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "business-model-sketch",
        "agent": "greenfield-agent",
        "procedure": [
          "opportunity-discovery",
          "greenfield-screening",
          "brownfield-screening"
        ]
      }
    ],
    "requiredArtifacts": [
      "기회 등록(가치사슬 노드·매력도)"
    ],
    "completionCriteria": [
      "최소 1개 기회가 등록되고 매력도가 평가되었다"
    ]
  },
  {
    "id": "S3",
    "name": "시너지·전략적 적합성",
    "objective": "우리가 해야 하는가? — 자사 역량과의 시너지를 평가한다",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "gates": [
      "screening"
    ],
    "activities": [
      {
        "id": "strategic-fit-screening",
        "agent": "process-governance-manager",
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "synergy-analysis",
        "agent": "risk-officer",
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "our-company-profile",
        "agent": "financial-analyst",
        "procedure": [
          "company-profile-analysis"
        ]
      }
    ],
    "requiredArtifacts": [
      "시너지 평가",
      "전략적 적합성 판단"
    ],
    "completionCriteria": [
      "기회에 synergy_score와 근거가 기록되었다",
      "적합성 판단 근거(rationale)가 기록되고 결정론 권고(매력도·시너지 조합)가 제시되었다",
      "최소 1개 기회가 selected 상태이다 (시너지·적합성 평가 후 선정)"
    ]
  },
  {
    "id": "S4",
    "name": "진출방식 결정",
    "objective": "어떻게 들어갈 것인가? — Greenfield(자체 역량 진출) vs Brownfield(기존 기업·자산 결합)를 결정한다. Brownfield ≠ M&A — M&A·JV·전략적 투자·소수점 지분·파트너십·R&BD·사내벤처(CVC) 중 Route를 고른다",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "gates": [
      "screening",
      "pre_fs"
    ],
    "activities": [
      {
        "id": "route-strategy",
        "agent": "pm",
        "procedure": [
          "greenfield-pre-fs",
          "brownfield-pre-fs",
          "deal-shape-chain"
        ]
      },
      {
        "id": "deal-shape-evaluation",
        "agent": "brownfield-agent",
        "procedure": [
          "greenfield-pre-fs",
          "brownfield-pre-fs",
          "deal-shape-chain"
        ]
      },
      {
        "id": "route-advisory",
        "agent": "pm",
        "procedure": [
          "greenfield-pre-fs",
          "brownfield-pre-fs",
          "deal-shape-chain"
        ]
      }
    ],
    "requiredArtifacts": [
      "트랙 결정(GF/BF)·근거",
      "Brownfield 선택 시 Route 유형(M&A/JV/전략적 투자/소수점 지분/파트너십/R&BD/CVC)",
      "5criteria 채점 결과(통제 필요도·역량 결정성·시장 불확실성·통합 역량·역량확보 속도 각 20%)",
      "검토한 대안"
    ],
    "completionCriteria": [
      "route_decision 레코드가 존재한다 (track 필수, greenfield는 sub_track, brownfield는 Route 유형)",
      "Brownfield인 경우 5criteria 채점 결과와 사전배제 점검이 기록되었다",
      "Greenfield인 경우에도 5criteria 채점 결과를 기록한다 (ADR-0104 — 트랙 간 비교 가능성)"
    ]
  },
  {
    "id": "S5",
    "name": "자체 진출",
    "objective": "스스로 진입할 수 있는가? — 자체 역량을 평가하고 격차를 구축 방안(Build/Partner/Hire/Invest)으로 해소해 진출전략을 세운다 (Greenfield 전용 — Target Company 객체가 존재하지 않는다)",
    "applicableTracks": [
      "greenfield"
    ],
    "gates": [
      "pre_fs"
    ],
    "activities": [
      {
        "id": "capability-assessment",
        "agent": "greenfield-agent",
        "procedure": [
          "greenfield-capability-assessment"
        ]
      },
      {
        "id": "entry-strategy",
        "agent": "greenfield-agent",
        "procedure": [
          "greenfield-capability-assessment"
        ]
      },
      {
        "id": "business-case-lines",
        "agent": "financial-analyst",
        "procedure": [
          "greenfield-capability-assessment"
        ]
      }
    ],
    "requiredArtifacts": [
      "역량 격차 평가",
      "진출전략(Build/Partner/Hire/Invest 결정·근거)"
    ],
    "completionCriteria": [
      "필요 역량 대비 보유 역량 격차와 해소 방안이 기록되었다",
      "진출전략이 결정되고 검토한 대안이 기록되었다"
    ]
  },
  {
    "id": "S6",
    "name": "대상 후보 발굴",
    "objective": "누구와 결합할 것인가? — Opportunity에 진입 가능한 기존 기업·자산의 Target Universe를 정의하고 Target Company Long List를 작성한다 (Brownfield 전용)",
    "applicableTracks": [
      "brownfield"
    ],
    "gates": [
      "pre_fs"
    ],
    "activities": [
      {
        "id": "target-universe-definition",
        "agent": "brownfield-agent",
        "procedure": [
          "brownfield-target-identification"
        ]
      },
      {
        "id": "target-longlist",
        "agent": "market-intelligence-agent",
        "procedure": [
          "brownfield-target-identification"
        ]
      }
    ],
    "requiredArtifacts": [
      "Target Universe 정의",
      "Target Company Long List"
    ],
    "completionCriteria": [
      "후보 Universe의 정의·선정 기준이 기록되었다",
      "최소 커버리지 기준을 충족하는 Long List가 존재한다",
      "Long List 후보에 필수 속성과 출처/근거가 기록되었다"
    ]
  },
  {
    "id": "S7",
    "name": "대상 선정",
    "objective": "어떤 대상이 유망한가? — Long List를 전략·역량·재무·소유권·규제 기준으로 스크리닝해 Target Company Short List로 좁힌다 (Brownfield 전용 — CDD/TDD는 Short List 확정 후 S9에서 수행한다)",
    "applicableTracks": [
      "brownfield"
    ],
    "gates": [
      "target_screening"
    ],
    "activities": [
      {
        "id": "target-screening",
        "agent": "brownfield-agent",
        "procedure": [
          "brownfield-target-screening"
        ]
      },
      {
        "id": "ownership-regulatory-screening",
        "agent": "antitrust-agent",
        "procedure": [
          "brownfield-target-screening"
        ]
      },
      {
        "id": "target-ranking",
        "agent": "brownfield-agent",
        "procedure": [
          "brownfield-target-screening"
        ]
      }
    ],
    "requiredArtifacts": [
      "Target Company Short List",
      "Target Ranking/Score",
      "Exclusion Reasons"
    ],
    "completionCriteria": [
      "모든 Long List 후보에 랭킹 점수 또는 제외 사유가 기록되었다",
      "Short List 후보가 knock-out 스크리닝을 통과했다",
      "스크리닝 근거(evidence)가 후보별로 기록되었다"
    ]
  },
  {
    "id": "S8",
    "name": "사업성 분석",
    "objective": "돈이 되는가? — Greenfield는 진출전략 기반 Business Case, Brownfield는 Short List 대상별 밸류에이션을 정량화해 비교·선정한다",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "gates": [
      "fs"
    ],
    "activities": [
      {
        "id": "business-case-modeling",
        "agent": "financial-analyst",
        "procedure": [
          "greenfield-fs",
          "brownfield-fs"
        ]
      },
      {
        "id": "valuation",
        "agent": "valuation-agent",
        "procedure": [
          "greenfield-fs",
          "brownfield-fs"
        ]
      },
      {
        "id": "quant-methods",
        "agent": "quant-methodologist",
        "procedure": [
          "greenfield-fs",
          "brownfield-fs"
        ]
      },
      {
        "id": "target-comparison",
        "agent": "financial-analyst",
        "procedure": [
          "brownfield-fs-comparative"
        ]
      },
      {
        "id": "target-selection",
        "agent": "pm",
        "procedure": [
          "brownfield-fs-comparative"
        ]
      }
    ],
    "requiredArtifacts": [
      "Business Case(비용·수익 라인 또는 밸류에이션 — brownfield는 대상별)",
      "시뮬레이션 NPV 분위수",
      "BEP 시점과 시뮬레이션 입력 스냅샷",
      "Target 비교 분석 (brownfield)",
      "대상 선정 기록 (brownfield)"
    ],
    "completionCriteria": [
      "민감도가 포함된 정량 평가가 존재한다 (시뮬레이션 또는 밸류에이션 범위)",
      "BEP 시점과 시뮬레이션 입력 스냅샷이 산출되어 있다",
      "brownfield: Short List의 모든 대상이 각각 분석되어 있다 (대상별 Business Case + 시뮬레이션)",
      "brownfield: 대상 비교 분석과 사람의 대상 선정 기록이 존재한다"
    ]
  },
  {
    "id": "S9",
    "name": "실사·검증",
    "objective": "사실인가? 위험은 무엇인가? — 트랙별 실사 체크리스트를 수행한다 (brownfield는 S8에서 선정된 대상 DD, 선택적으로 다른 Short List 대상 DD를 비교 근거로 열 수 있다. greenfield는 실현가능성 검증)",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "gates": [
      "dd"
    ],
    "activities": [
      {
        "id": "commercial-dd",
        "agent": "commercial-dd-agent",
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "technical-dd",
        "agent": "technical-dd-agent",
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "legal-dd",
        "agent": "legal-counsel",
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "financial-dd",
        "agent": "financial-analyst",
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "hr-dd",
        "agent": "hr-integration-agent",
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "market-dd",
        "agent": "market-intelligence-agent",
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "financing-dd",
        "agent": "financing-agent",
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "dd-waiver-review",
        "agent": "compliance-officer",
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      }
    ],
    "requiredArtifacts": [
      "DD 체크리스트 판정(필수 항목 해소)"
    ],
    "completionCriteria": [
      "적용 체크리스트의 모든 항목이 판정되고 필수 미충족이 0건이다"
    ]
  },
  {
    "id": "S10",
    "name": "투자구조 설계",
    "objective": "어떤 그릇으로, 어떤 자금으로 들어갈 것인가? — 비히클(direct/SPC/holdco/내부 스핀오프/JV)과 ADR-0045 4대 축(절세 구조·책임 격리·재무 레버리지·엑싯 구조)을 검토하고 자금조달 계획(sources & uses)을 균형시킨다 (IC 심의의 입력 설계)",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "gates": [],
    "activities": [
      {
        "id": "deal-structure-hypothesis",
        "agent": "brownfield-agent",
        "procedure": [
          "deal-structuring",
          "brownfield-fs",
          "deal-shape-chain"
        ]
      },
      {
        "id": "financing-plan",
        "agent": "valuation-agent",
        "procedure": [
          "deal-structuring"
        ]
      }
    ],
    "requiredArtifacts": [
      "투자구조 가설(4축 검토 완료)",
      "자금조달 계획(sources & uses 균형)"
    ],
    "completionCriteria": [
      "최신 투자구조 가설의 4축 검토(절세 구조·책임 격리·재무 레버리지·엑싯 구조)가 근거 아티팩트 참조와 함께 완료되었다",
      "자금조달 sources와 uses 합계가 균형을 이루고 0보다 크다"
    ]
  },
  {
    "id": "S11",
    "name": "투자심사·실행",
    "objective": "투자할 것인가? — S10에서 설계한 투자 구조와 자금 조달 계획을 IC 패키지로 묶어 Entity/Group IC 심사를 통과하고, 승인되면 트랙에 맞는 실행에 들어간다(인수 종결, 법인 설립, greenfield 실행 기준선 확정)",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "gates": [
      "entity_ic",
      "group_ic"
    ],
    "activities": [
      {
        "id": "ic-preparation",
        "agent": "pm",
        "procedure": [
          "entity-ic-review",
          "group-investment-review"
        ]
      },
      {
        "id": "charter-baseline",
        "agent": "pm",
        "procedure": [
          "entity-ic-review"
        ]
      },
      {
        "id": "investment-structuring",
        "agent": "brownfield-agent",
        "procedure": [
          "entity-ic-review",
          "jv-lifecycle-governance"
        ]
      },
      {
        "id": "risk-review",
        "agent": "risk-officer",
        "procedure": [
          "entity-ic-review",
          "group-investment-review"
        ]
      },
      {
        "id": "group-review",
        "agent": "group-review-agent",
        "procedure": [
          "entity-ic-review",
          "group-investment-review"
        ]
      },
      {
        "id": "entity-establishment-execution",
        "agent": "process-governance-manager",
        "procedure": [
          "entity-establishment-execution"
        ]
      },
      {
        "id": "pmi-kickoff",
        "agent": "pmi-agent",
        "procedure": [
          "pmi-integration-execution"
        ]
      },
      {
        "id": "greenfield-execution-baseline",
        "agent": "greenfield-agent",
        "procedure": [
          "greenfield-execution-baseline"
        ]
      }
    ],
    "requiredArtifacts": [
      "IC 패키지",
      "추진계획(차터) 기준선 — 목적·트랙 근거·진출 범위·KPI 선커밋",
      "사람 최종 승인(reviewer 기록)",
      "설립 실행 기록(설립준비·등기·인허가 분류·인력이전·완료확인 — chk-entity-formation 증적, origin∈{internal,joint})"
    ],
    "completionCriteria": [
      "Entity IC와 Group IC 승인이 모두 기록되었다",
      "추진계획(차터) 기준선이 확정되고 append-only 변경 이력이 시작되었다",
      "origin∈{internal,joint}인 프로젝트는 entity-establishment-execution 5단계 완료 기록이 존재한다"
    ]
  },
  {
    "id": "S12",
    "name": "사후 관리",
    "objective": "투자 후 사업이 궤도에 올랐는가? — 포트폴리오 성과를 모니터링한다",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "gates": [],
    "activities": [
      {
        "id": "portfolio-monitoring",
        "agent": "group-review-agent",
        "procedure": [
          "portfolio-venture-monitoring"
        ]
      },
      {
        "id": "integration-monitoring",
        "agent": "pmi-agent",
        "procedure": [
          "pmi-integration-execution"
        ]
      },
      {
        "id": "partnership-monitoring",
        "agent": "partnership-agent",
        "procedure": [
          "jv-lifecycle-governance"
        ]
      }
    ],
    "requiredArtifacts": [
      "벤처 스코어카드",
      "사람 전환 결정 기록(어휘 5종, decided_by=venture-portfolio-ic, rationale 필수 — venture_transition_decision 원장)",
      "전환별 결정 부속 기록: 차기 트랜치 조건(next_tranche_released/held_evidence_incomplete), 핵심사업 인계 기록(graduate_to_core), 매각/청산 계획(reduce_or_divest), 학습 포착 기록(kill_with_learning_captured — group-review-agent 기록, risk-officer가 S1/S2 기본률에 환류)",
      "실행 기준선 대비 차이(greenfield)"
    ],
    "completionCriteria": [
      "리뷰 주기별로 스코어카드 검토가 존재한다",
      "각 검토마다 사람 전환 결정이 근거(rationale)와 함께 기록되어 있다",
      "지속 결정(next_tranche_released/held_evidence_incomplete)은 차기 트랜치 조건을 기록한다",
      "확장 결정(graduate_to_core)은 핵심사업 인계를 기록한다",
      "축소/철수 결정(reduce_or_divest)은 매각 또는 청산 계획을 기록한다",
      "중단 결정(kill_with_learning_captured)은 포착된 학습을 기록하고 S1/S2 기본률에 환류한다",
      "greenfield는 각 스코어카드 주기에 S11 실행 기준선·S8 채택 케이스·S8 사업 목표(참고) 대비 차이를 보고한다"
    ]
  }
];
