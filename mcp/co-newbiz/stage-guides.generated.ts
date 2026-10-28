// Generated from process/flow.spec.yaml. Do not edit by hand; regenerate with:
// bun scripts/co-newbiz/generate-spec-activities.ts (--check exits 1 on drift;
// tests/unit/mcp-prompts.test.ts runs it). Source of the MCP stage_guide_s*
// prompts and flowspec:// resources (ADR-0154, Wave M M-3).
import type { StageGuideSpec } from "./stage-guides.ts";

export const GUIDE_SPEC_VERSION = "2.16.0";
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
          "opportunity-discovery"
        ]
      },
      {
        "id": "entry-market-sizing",
        "agent": "market-intelligence-agent",
        "procedure": [
          "opportunity-discovery",
          "greenfield-screening",
          "brownfield-screening"
        ]
      }
    ],
    "requiredArtifacts": [
      "기회 등록(가치사슬 노드·매력도)",
      "진입시장 산정 (S1 링크·대상 범위·도출 사슬)"
    ],
    "completionCriteria": [
      "최소 1개 기회가 등록되고 매력도가 평가되었다",
      "최소 1개 기회에 S1 시장규모 버전이 연결되고 대상 범위가 기록되었다 (ADR-0180 — 미연결 상태는 미연결로 정직 표시되며 게이트를 막지 않는다)"
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
        "agent": "financial-analyst",
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "synergy-red-team",
        "agent": "risk-officer",
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "capability-register-greenfield",
        "agent": "greenfield-agent",
        "procedure": [
          "greenfield-screening"
        ]
      },
      {
        "id": "capability-register-brownfield",
        "agent": "brownfield-agent",
        "procedure": [
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
      "최소 1개 기회가 selected 상태이다 (시너지·적합성 평가 후 선정)",
      "필요 역량 등록부에 출처(source)가 기록된 역량이 1건 이상 존재한다 (capability-register 활동 — grandfathered 기회 제외)"
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
          "brownfield-pre-fs"
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
      },
      {
        "id": "wacc-hurdle-confirmation",
        "agent": "valuation-agent",
        "procedure": [
          "greenfield-pre-fs",
          "brownfield-pre-fs"
        ]
      },
      {
        "id": "certification-screen",
        "agent": "certification-agent",
        "procedure": [
          "greenfield-pre-fs",
          "brownfield-pre-fs"
        ]
      },
      {
        "id": "regulatory-screening",
        "agent": "legal-counsel",
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      }
    ],
    "requiredArtifacts": [
      "트랙 결정(GF/BF)·근거",
      "Brownfield 선택 시 Route 유형(M&A/JV/전략적 투자/소수점 지분/파트너십/R&BD/CVC)",
      "5criteria 채점 결과(통제 필요도·역량 결정성·시장 불확실성·통합 역량·역량확보 속도 각 20%)",
      "검토한 대안",
      "법무·규제 스크리닝 판정 (chk-legal-regulatory lr-01~lr-07 — regulatory-screening 활동)"
    ],
    "completionCriteria": [
      "route_decision 레코드가 존재한다 (track 필수; brownfield는 Route 유형(sub_track) 필수, greenfield의 sub_track은 선택)",
      "Brownfield인 경우 5criteria 채점 결과와 사전배제 점검이 기록되었다",
      "Greenfield인 경우에도 5criteria 채점 결과를 기록한다 (ADR-0104 — 트랙 간 비교 가능성)",
      "법무·규제 스크리닝 판정(chk-legal-regulatory 필수 항목)이 사람에 의해 기록되었다 — 필수 항목은 pass 또는 사유가 있는 not_applicable이어야 하며 권장 항목은 차단하지 않는다 (ADR-0187 P3, 가족 legal_regulatory가 enforce일 때 차단)"
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
      "진출전략(Build/Partner/Hire/Invest 결정·근거)",
      "그린필드 실현가능성 체크리스트 판정 (chk-greenfield-feasibility gf-01~gf-12)",
      "부지 선정 체크리스트 판정 (chk-site-selection ss-01~ss-09)"
    ],
    "completionCriteria": [
      "필요 역량 대비 보유 역량 격차와 해소 방안이 기록되었다",
      "진출전략이 결정되고 검토한 대안이 기록되었다",
      "그린필드 실현가능성 체크리스트(chk-greenfield-feasibility)의 필수 항목이 사람에 의해 판정되었다 (ADR-0187 P3, 가족 checklist_consumers가 enforce일 때 차단)",
      "부지 선정 체크리스트(chk-site-selection)의 필수 항목이 사람에 의해 판정되었다 — 기존 부지 증설은 사유가 있는 not_applicable로 기록한다 (ADR-0187 P3, 가족 checklist_consumers가 enforce일 때 차단)"
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
      "brownfield: 대상 비교 분석과 사람의 대상 선정 기록이 존재한다",
      "할인율 적용 주체와 WACC·hurdle IRR을 사람이 확인했다 (ADR-0186 D8 — 가족 wacc가 enforce일 때 차단)"
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
      },
      {
        "id": "capability-dd",
        "agent": "brownfield-agent",
        "procedure": [
          "brownfield-dd"
        ]
      },
      {
        "id": "antitrust-dd",
        "agent": "antitrust-agent",
        "procedure": [
          "brownfield-dd"
        ]
      },
      {
        "id": "region-labor-review",
        "agent": "region-lead",
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "customer-retention-dd",
        "agent": "customer-retention-agent",
        "procedure": [
          "brownfield-dd"
        ]
      },
      {
        "id": "incentive-dd",
        "agent": "incentive-agent",
        "procedure": [
          "brownfield-dd"
        ]
      },
      {
        "id": "contingent-liability-dd",
        "agent": "valuation-agent",
        "procedure": [
          "brownfield-dd"
        ]
      },
      {
        "id": "certification-transferability-dd",
        "agent": "legal-counsel",
        "procedure": [
          "brownfield-dd"
        ]
      },
      {
        "id": "ip-fto-dd",
        "agent": "ip-agent",
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
    "objective": "어떤 그릇으로, 어떤 자금으로 들어갈 것인가? — 투자 주체(direct/SPC/holdco/내부 스핀오프/JV)과 ADR-0045 4대 축(절세 구조·책임 격리·재무 레버리지·엑싯 구조)을 검토하고 자금조달 계획(sources & uses)을 균형시킨다 (투자심의의 입력 설계)",
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
          "deal-structuring"
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
      "자금조달 sources와 uses 합계가 균형을 이루고 0보다 크다",
      "자금 사용(uses) 합계가 S8에서 채택한 케이스의 투자금과 ±5% 이내로 대사된다 — 채택 투자금을 도출할 수 없으면 차단하지 않고 사람의 대사를 요구한다 (ADR-0187 D2·P3; 임계값 소유자는 risk-officer와 quant-methodologist)",
      "부채 조달이 있으면 다운사이드 시나리오의 DSCR 커버넌트 여력이 1.2배 이상이다 (ADR-0187 D2·P3; 임계값 소유자는 risk-officer와 quant-methodologist)",
      "모든 조달원(sources)에 자금 확정성 증빙(evidence_kind·evidence_ref)이 기록되었다 (ADR-0187 P3)"
    ]
  },
  {
    "id": "S11",
    "name": "투자심사·실행",
    "objective": "투자할 것인가? — S10에서 설계한 투자 구조와 자금 조달 계획을 투자심의 자료로 묶어 법인·그룹 투자심의위원회 심사를 통과하고, 승인되면 트랙에 맞는 실행에 들어간다(인수 종결, 설립 또는 사업부 신설 실행, greenfield 실행 기준선 확정)",
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
          "entity-ic-review"
        ]
      },
      {
        "id": "risk-review",
        "agent": "risk-officer",
        "procedure": [
          "entity-ic-review"
        ]
      },
      {
        "id": "group-review",
        "agent": "group-review-agent",
        "procedure": [
          "group-investment-review"
        ]
      },
      {
        "id": "entity-establishment-execution",
        "agent": "process-governance-manager",
        "procedure": [
          "entity-establishment-execution",
          "business-unit-establishment-execution"
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
      "투자심의 자료",
      "추진계획(차터) 기준선 — 목적·트랙 근거·진출 범위·KPI 선커밋",
      "사람 최종 승인(reviewer 기록)",
      "설립 실행 기록(신규 법인 설립 — 설립준비·등기·인허가 분류·인력이전·완료확인 — chk-entity-formation 증적, origin∈{internal,joint} / 신규 사업부 추진 — 신설 결의·사업자등록 정리·인허가 명의 확인·인력 배치·완료 확인 — chk-business-unit-formation 증적, origin=internal)"
    ],
    "completionCriteria": [
      "법인 투자심의위원회와 그룹 투자심의위원회 승인이 모두 기록되었다",
      "추진계획(차터) 기준선이 확정되고 append-only 변경 이력이 시작되었다",
      "origin∈{internal,joint}인 프로젝트는 entity-establishment-execution 5단계 완료 기록이 존재한다",
      "실행 순서는 법인 투자심의위원회 GO → 그룹 투자심의위원회 GO → 실행(설립·사업부 신설 / PMI 킥오프 / greenfield 실행 기준선)이다 — 그룹 GO 전에는 설립·자본 약정을 실행하지 않는다 (ADR-0187 D7)",
      "S8에서 사람이 채택한 Business Case 기록(s8_case_adopt)이 존재한다",
      "법인·그룹 투자심의위원회의 최신 GO 결정자가 사람이다 (사람 최종 승인 — grandfathered 프로젝트 제외)",
      "brownfield M&A·JV·전략적 투자: 사람이 기록한 PMI 킥오프(통합 책임자·통합 계획 기준선)가 존재한다 (소수점 지분·파트너십·R&BD·CVC·기존사업 R&BD·사내벤처 제외)",
      "greenfield: 실행 기준선이 사람에 의해 확인되었다 (트랙 분류 충돌은 사람이 정리 — ADR-0161)",
      "투자심의위원회가 건 선행 조건(condition precedent)이 모두 해소되었다 (ADR-0186 D4 — 가족 validators가 enforce일 때 차단)"
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
      "벤처 스코어카드 (greenfield — brownfield은 integration/partnership 모니터링, 권장·비차단)",
      "사람 전환 결정 기록(어휘 5종, decided_by=venture-portfolio-ic, rationale 필수 — venture_transition_decision 원장)",
      "전환별 결정 부속 기록: 차기 트랜치 조건(next_tranche_released/held_evidence_incomplete), 핵심사업 인계 기록(graduate_to_core), 매각/청산 계획(reduce_or_divest), 학습 포착 기록(kill_with_learning_captured — group-review-agent 기록, risk-officer가 S1/S2 기본률에 환류)",
      "실행 기준선 대비 차이(greenfield)"
    ],
    "completionCriteria": [
      "리뷰 주기별로 스코어카드 검토가 존재한다 (greenfield — brownfield은 integration/partnership 모니터링으로 대체, 권장·비차단)",
      "각 검토마다 사람 전환 결정이 근거(rationale)와 함께 기록되어 있다",
      "지속 결정(next_tranche_released/held_evidence_incomplete)은 차기 트랜치 조건을 기록한다",
      "확장 결정(graduate_to_core)은 핵심사업 인계를 기록한다",
      "축소/철수 결정(reduce_or_divest)은 매각 또는 청산 계획을 기록한다",
      "중단 결정(kill_with_learning_captured)은 포착된 학습을 기록하고 S1/S2 기본률에 환류한다",
      "greenfield는 각 스코어카드 주기에 S11 실행 기준선·S8 채택 케이스·S8 사업 목표(참고) 대비 차이를 보고한다"
    ]
  }
];
