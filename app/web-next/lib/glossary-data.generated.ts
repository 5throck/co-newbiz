// Generated from glossary/*.yaml for Next/Turbopack static server bundling.
// Do not edit by hand; update glossary YAML and regenerate this projection.
import type { GlossaryTerm } from "./glossary.ts";

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    "key": "Green Field",
    "ko": "그린필드",
    "en": "Green Field",
    "definition_ko": "기존 자산 없이 부지·설비를 새로 지어 신규 사업을 시작하는 방식.",
    "why_it_matters_ko": "브라운필드(M&A)와 검토 축이 다르다 — 인프라·인재·지역 상생·인허가 리드타임이 핵심 변수이지 딜 구조나 우발채무가 아니다.",
    "category": "business",
    "aliases": [
      "신규 설립",
      "GF"
    ],
    "related": [
      "Brown Field",
      "Stage Gate"
    ],
    "used_in": [
      "greenfield-feasibility",
      "site-infrastructure-assessment"
    ],
    "owner": "greenfield-agent"
  },
  {
    "key": "Brown Field",
    "ko": "브라운필드",
    "en": "Brown Field",
    "definition_ko": "기존 기업이나 사업부를 인수해 신규 사업에 진출하는 방식(M&A).",
    "why_it_matters_ko": "딜 구조·우발채무·인증 승계·고객 이탈 같은 그린필드에 없는 리스크 축이 붙는다. 필수 교차검증 6종이 이 방식에만 적용된다.",
    "category": "business",
    "aliases": [
      "M&A",
      "BF"
    ],
    "related": [
      "Green Field",
      "Change of Control"
    ],
    "used_in": [
      "brownfield-feasibility"
    ],
    "owner": "brownfield-agent"
  },
  {
    "key": "Stage Gate",
    "ko": "스테이지 게이트",
    "en": "Stage Gate",
    "definition_ko": "Screening → Pre-FS → FS → DD → Entity IC → Group IC 순으로 진행되는 신사업 검토 단계.",
    "why_it_matters_ko": "각 게이트마다 필수 산출물과 통과 조건이 다르다. 게이트를 건너뛰면 시스템이 다음 단계 진입을 차단한다.",
    "category": "business",
    "aliases": [
      "게이트"
    ],
    "related": [
      "Entity IC",
      "Group IC",
      "Kill Criteria"
    ],
    "used_in": [
      "stage-gate-governance"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Pre-FS",
    "ko": "예비타당성 검토",
    "en": "Preliminary Feasibility Study",
    "definition_ko": "본 타당성 검토(FS) 이전에 수행하는 약식 검토 단계.",
    "why_it_matters_ko": "이 단계에서 이미 데이터 신뢰도·프록시 체인 등급이 산출되므로, Pre-FS의 RAG 등급이 낮으면 FS로 넘어가기 전에 데이터를 보강해야 한다.",
    "category": "business",
    "related": [
      "Stage Gate"
    ],
    "used_in": [
      "stage-gate-governance",
      "investment-feasibility-modeling"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Entity IC",
    "ko": "각사 투자심의위원회",
    "en": "Entity Investment Committee",
    "definition_ko": "개별 계열사 단위에서 진행되는 투자 승인 심의.",
    "why_it_matters_ko": "Group IC 진입의 시스템 강제 선행 조건이다. Entity IC 승인 없이 그룹 절차에 들어갈 수 없다.",
    "category": "business",
    "related": [
      "Group IC",
      "Stage Gate"
    ],
    "used_in": [
      "two-tier-approval-chain"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Group IC",
    "ko": "그룹 투자심의위원회",
    "en": "Group Investment Committee",
    "definition_ko": "계열사 개별 승인과 별개로 그룹 차원에서 진행되는 심의로, 포트폴리오 정합성·자본 배분 우선순위를 본다.",
    "why_it_matters_ko": "각사 기준 전부 Green인 안건이 여러 개 올라와도 자본은 하나다. Group IC는 승인/부결이 아니라 순위 결정인 경우가 많다.",
    "category": "business",
    "related": [
      "Entity IC",
      "Group Agenda"
    ],
    "used_in": [
      "group-level-review",
      "portfolio-fit-assessment"
    ],
    "owner": "group-review-agent"
  },
  {
    "key": "Kill Criteria",
    "ko": "중단 기준",
    "en": "Kill Criteria",
    "definition_ko": "사전에 정의된 조건 충족 시 검토를 자동으로 중단시키는 규칙(예 — 필수 인증 미취득, covenant 위반).",
    "why_it_matters_ko": "중단 기준 없는 검토는 표류하고 \"검토\"가 \"정당화\"로 변질된다. 낙관편향을 구조적으로 차단하는 장치다.",
    "category": "business",
    "related": [
      "Red Team",
      "Stage Gate"
    ],
    "used_in": [
      "stage-gate-governance",
      "assumption-audit"
    ],
    "owner": "risk-officer"
  },
  {
    "key": "Waiver",
    "ko": "예외 승인",
    "en": "Waiver",
    "definition_ko": "필수 산출물·체크리스트 미충족 상태에서 게이트를 통과시키는 명시적 예외.",
    "why_it_matters_ko": "예외 경로가 없으면 현장이 음성적으로 우회한다. 반드시 만료일이 있어야 하며, 같은 조항에 반복되면 규정 개정 신호다.",
    "category": "business",
    "related": [
      "Kill Criteria",
      "Interpretation Registry"
    ],
    "used_in": [
      "waiver-management"
    ],
    "owner": "compliance-officer"
  },
  {
    "key": "Interpretation Registry",
    "ko": "해석례 등록부",
    "en": "Interpretation Registry",
    "definition_ko": "“이 조항이 우리 케이스에 적용되는가”에 대한 질의·답변을 축적하는 등록부.",
    "why_it_matters_ko": "같은 질문에 다른 답이 나가는 것을 막고, 쌓이면 그 자체가 지식자산이 된다.",
    "category": "business",
    "related": [
      "Waiver"
    ],
    "used_in": [
      "interpretation-registry"
    ],
    "owner": "compliance-officer"
  },
  {
    "key": "Group Agenda",
    "ko": "그룹 안건 비교",
    "en": "Group Agenda",
    "definition_ko": "동일 심의 사이클에서 그룹 IC에 올라온 복수 안건을 우선순위로 비교하는 뷰.",
    "why_it_matters_ko": "개별 안건의 승인/부결이 아니라 한정된 자본을 두고 경쟁하는 안건들의 순위를 매기는 게 실제 목적이다.",
    "category": "business",
    "related": [
      "Group IC"
    ],
    "used_in": [
      "portfolio-fit-assessment"
    ],
    "owner": "group-review-agent"
  },
  {
    "key": "Project",
    "ko": "프로젝트",
    "en": "Project (Deal)",
    "definition_ko": "선별된 기회가 S4~S7(진출방식 결정→사업성 분석→실사·검증→투자심사·실행)을 통과하는 실행 단위. 반드시 대상 회사(md_company)와 연결된다.",
    "why_it_matters_ko": "예전에 '딜'과 '프로젝트'가 혼용되었으나 이제 UI·문서 전체에서 '프로젝트'로 통일한다. '딜'은 동의어(별칭)로만 남기고, 프로젝트 번호(project_no)가 승격 시점에 연결된다.",
    "category": "business",
    "aliases": [
      "딜",
      "Deal"
    ],
    "related": [
      "Opportunity"
    ],
    "used_in": [
      "stage-gate-governance",
      "deal-execution-playbook",
      "project-review"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Opportunity",
    "ko": "기회",
    "en": "Opportunity",
    "definition_ko": "시장분석(S1)과 시너지 정합성(S3)의 Long List에서 발굴되어 발굴→평가→선별 퍼널을 통과한 사업 아이디어. 선별되면 프로젝트로 승격된다.",
    "why_it_matters_ko": "기회는 프로젝트가 아니다(불변식",
    "category": "business",
    "aliases": [
      "사업 기회"
    ],
    "related": [
      "Project"
    ],
    "used_in": [
      "strategic-fit-screening"
    ],
    "owner": "market-intelligence-agent"
  },
  {
    "key": "WACC",
    "ko": "가중평균자본비용",
    "en": "Weighted Average Cost of Capital",
    "definition_ko": "부채와 자본의 조달비용을 가중평균한 할인율.",
    "why_it_matters_ko": "이 시스템에서는 직접 입력(user)과 CAPM 구성요소 입력(무위험이자율=live, ERP·타겟 D/E=user, 베타=derived) 두 모드를 지원하며, 산출물에 어느 값이 어느 종류인지 명시된다.",
    "category": "financial",
    "related": [
      "WACC Input Session",
      "Assumption Kind"
    ],
    "used_in": [
      "wacc-input-session"
    ],
    "owner": "valuation-agent"
  },
  {
    "key": "IRR",
    "ko": "내부수익률",
    "en": "Internal Rate of Return",
    "definition_ko": "투자안의 NPV를 0으로 만드는 할인율.",
    "why_it_matters_ko": "hurdle rate와 비교해 RAG 재무성 차원 판정의 핵심 지표이며, 히스테리시스 규칙(승격/강등 임계 분리)이 이 지표에 적용된다.",
    "category": "financial",
    "related": [
      "DSCR",
      "RAG"
    ],
    "used_in": [
      "investment-feasibility-modeling"
    ],
    "owner": "valuation-agent"
  },
  {
    "key": "DSCR",
    "ko": "부채상환비율",
    "en": "Debt Service Coverage Ratio",
    "definition_ko": "영업현금흐름을 원리금 상환액으로 나눈 비율. 재무약정(covenant)의 기준 지표로 흔히 쓰인다.",
    "why_it_matters_ko": "하방 시나리오에서 DSCR이 covenant를 위반하면 기한이익상실로 이어져 유동성 위기가 된다 — Kill Criteria 후보다.",
    "category": "financial",
    "related": [
      "Covenant",
      "Kill Criteria"
    ],
    "used_in": [
      "debt-and-contingent-liability-simulation"
    ],
    "owner": "valuation-agent"
  },
  {
    "key": "QoE",
    "ko": "수익의 질",
    "en": "Quality of Earnings",
    "definition_ko": "일회성·비경상 항목을 제거하고 정상화한 EBITDA 분석. 브라운필드(M&A) 전용 절차.",
    "why_it_matters_ko": "정상화 EBITDA가 밸류에이션 브리지의 출발점이 되며, 여기서 나온 조정 항목이 dd_finding.value_impact로 모델에 직결된다.",
    "category": "financial",
    "related": [
      "DD Finding",
      "Valuation Bridge"
    ],
    "used_in": [
      "quality-of-earnings"
    ],
    "owner": "financial-analyst"
  },
  {
    "key": "Assumption Kind",
    "ko": "가정 종류",
    "en": "Assumption Kind",
    "definition_ko": "가정 레지스트리의 값 유형 — live(자동 수집), user(사용자 입력), derived(계산 도출), assumed(추정).",
    "why_it_matters_ko": "assumed는 rationale이 NOT NULL 제약이라 근거 없는 숫자가 보고서에 들어가는 것을 스키마 레벨에서 막는다.",
    "category": "financial",
    "related": [
      "WACC"
    ],
    "used_in": [
      "investment-feasibility-modeling",
      "assumption-audit"
    ],
    "owner": "valuation-agent"
  },
  {
    "key": "Anchor Ref",
    "ko": "앵커 참조",
    "en": "Anchor Reference",
    "definition_ko": "예측값(projection)이 근거하는 과거 데이터나 피어 데이터를 가리키는 참조 필드.",
    "why_it_matters_ko": "“매출총이익률 22%”가 어디서 왔는지(“피어 5개사 5년 중앙값”) 추적 가능하게 만드는 핵심 필드다.",
    "category": "financial",
    "related": [
      "Peer Group",
      "Base Rate"
    ],
    "used_in": [
      "growth-projection-modeling"
    ],
    "owner": "financial-analyst"
  },
  {
    "key": "Base Rate",
    "ko": "기저율",
    "en": "Base Rate",
    "definition_ko": "과거·피어 사례의 실제 분포에 근거한 참조값.",
    "why_it_matters_ko": "예측 성장률이 과거·피어 분포 상위 10% 밖이면 자동 경고가 발동한다. 근거 없는 하키스틱 예측을 구조적으로 막는 장치다.",
    "category": "financial",
    "related": [
      "Anchor Ref",
      "Reference Class Forecasting"
    ],
    "used_in": [
      "assumption-audit",
      "growth-projection-modeling"
    ],
    "owner": "risk-officer"
  },
  {
    "key": "Peer Group",
    "ko": "피어 그룹",
    "en": "Peer Group",
    "definition_ko": "재무 벤치마크 비교 대상이 되는 유사 기업 집단.",
    "why_it_matters_ko": "선정 근거를 필수 기록해야 한다 — 자의적 피어 선정은 벤치마크 자체를 무력화한다. 신규 사업은 과거 실적이 없으므로 피어의 과거가 유일한 앵커다.",
    "category": "financial",
    "related": [
      "Anchor Ref"
    ],
    "used_in": [
      "peer-benchmarking"
    ],
    "owner": "financial-analyst"
  },
  {
    "key": "ROIC Driver Tree",
    "ko": "ROIC 밸류 드라이버 트리",
    "en": "ROIC Value Driver Tree",
    "definition_ko": "투하자본이익률(ROIC)을 5단계로 분해한 재무 분석 구조. co-consult에서 이식된 기존 파이프라인.",
    "why_it_matters_ko": "과거 재무 분석의 기반이며, 이 위에 피어 벤치마크·성장성 예측 공백을 채워 넣는 구조다.",
    "category": "financial",
    "related": [
      "Peer Group"
    ],
    "used_in": [
      "historical-financial-analysis"
    ],
    "owner": "financial-analyst"
  },
  {
    "key": "Covenant",
    "ko": "재무약정",
    "en": "Covenant",
    "definition_ko": "대출 계약에 포함된 재무 조건(예 — DSCR 최소 유지).",
    "why_it_matters_ko": "CoC(지배구조 변경) 조항에 의한 기한이익상실이 M&A에서 가장 위험한 조항 중 하나다 — 클로징 시 상환 소요로 계상해야 한다.",
    "category": "financial",
    "related": [
      "DSCR",
      "Change of Control"
    ],
    "used_in": [
      "debt-and-contingent-liability-simulation"
    ],
    "owner": "valuation-agent"
  },
  {
    "key": "Golden Parachute",
    "ko": "경영진 CoC 트리거 보상",
    "en": "Golden Parachute",
    "definition_ko": "지배구조 변경(CoC) 시 경영진에게 즉시 지급되는 보상.",
    "why_it_matters_ko": "딜 클로징과 동시에 나가는 현금인데 밸류에이션에서 자주 누락되는 항목이다.",
    "category": "financial",
    "related": [
      "Change of Control"
    ],
    "used_in": [
      "management-incentive-review"
    ],
    "owner": "hr-integration-agent"
  },
  {
    "key": "Revenue Quality",
    "ko": "매출의 질",
    "en": "Revenue Quality",
    "definition_ko": "같은 매출액이라도 얼마나 믿고 이어갈 수 있는지를 따지는 평가. 최소 네 개 축 — 집중도, 이익률, 회수 기간, 반복성 — 을 상위 고객·세그먼트별로 겹쳐 본다.",
    "why_it_matters_ko": "매출 규모만으로는 밸류에이션의 바탕이 되는 매출을 믿을 수 없다. 한 축만 보면 놓치는 위험(최대 고객이 가장 늦게 지급하고 마진도 가장 낮은 경우 등)을 교차해 잡아내며, 축별 판정은 합산 점수 없이 따로 보인다. 상업 DD의 권고 항목 cdd-08이다.",
    "category": "financial",
    "related": [
      "QoE",
      "DSO"
    ],
    "used_in": [
      "commercial-due-diligence"
    ],
    "owner": "commercial-dd-agent"
  },
  {
    "key": "DSO",
    "ko": "매출채권 회수 기간",
    "en": "Days Sales Outstanding",
    "definition_ko": "매출이 발생한 뒤 대금을 회수하기까지 걸리는 평균 일수(매출채권 ÷ 매출 × 기간 일수).",
    "why_it_matters_ko": "전사 평균만 보면 특정 대형 고객의 지급 지연이 가려진다. 고객별 연령분석으로 봐야 운전자본 가정과 매출의 질(회수 기간 축)에 정확히 반영된다.",
    "category": "financial",
    "related": [
      "Revenue Quality",
      "QoE"
    ],
    "used_in": [
      "commercial-due-diligence",
      "quality-of-earnings"
    ],
    "owner": "financial-analyst"
  },
  {
    "key": "CGT",
    "ko": "표준화물선환산톤수",
    "en": "Compensated Gross Tonnage",
    "definition_ko": "선박의 건조 난이도를 반영해 총톤수(GT)를 보정한 조선업 표준 생산량 단위.",
    "why_it_matters_ko": "선박 시장 규모를 척수나 GT가 아닌 CGT로 봐야 건조 물량을 실질적으로 비교할 수 있다. 프록시 체인의 최상위 단위다.",
    "category": "unit",
    "aliases": [
      "보정총톤수"
    ],
    "related": [
      "GT",
      "DWT",
      "BHP"
    ],
    "used_in": [
      "proxy-industry-chain",
      "unit-conversion-calibration"
    ],
    "owner": "quant-methodologist"
  },
  {
    "key": "GT",
    "ko": "총톤수",
    "en": "Gross Tonnage",
    "definition_ko": "선박 내부 전체 용적을 기준으로 산출한 톤수. 건조 난이도는 반영하지 않는다.",
    "why_it_matters_ko": "CGT와 혼동하기 쉽다 — GT만으로는 선박 시장 규모를 비교할 때 건조 난이도 차이를 놓친다.",
    "category": "unit",
    "related": [
      "CGT",
      "DWT"
    ],
    "used_in": [
      "unit-conversion-calibration"
    ],
    "owner": "quant-methodologist"
  },
  {
    "key": "DWT",
    "ko": "재화중량톤수",
    "en": "Deadweight Tonnage",
    "definition_ko": "선박이 실을 수 있는 화물·연료·승무원 등의 총 중량.",
    "why_it_matters_ko": "화물선 시장 규모를 표현할 때 흔히 쓰이는 단위지만, CGT와 목적이 다르므로 프록시 체인에서 섞어 쓰면 안 된다.",
    "category": "unit",
    "related": [
      "CGT",
      "GT"
    ],
    "used_in": [
      "unit-conversion-calibration"
    ],
    "owner": "quant-methodologist"
  },
  {
    "key": "BHP",
    "ko": "제동마력",
    "en": "Brake Horsepower",
    "definition_ko": "선박엔진의 출력을 나타내는 단위.",
    "why_it_matters_ko": "크랭크축 → 선박엔진 → 선박 프록시 체인에서 두 번째 홉(선박엔진)의 표준 단위다.",
    "category": "unit",
    "related": [
      "CGT"
    ],
    "used_in": [
      "proxy-industry-chain"
    ],
    "owner": "quant-methodologist"
  },
  {
    "key": "수주",
    "ko": "수주",
    "en": "Order Intake",
    "definition_ko": "신규로 계약이 체결된 물량.",
    "why_it_matters_ko": "수주잔고·인도량과 혼동하면 예측 전체가 무너진다 — 시계열의 시작점(계약 시점)을 가리킨다.",
    "category": "industry",
    "related": [
      "수주잔고",
      "인도"
    ],
    "used_in": [
      "proxy-industry-chain"
    ],
    "owner": "market-intelligence-agent"
  },
  {
    "key": "수주잔고",
    "ko": "수주잔고",
    "en": "Order Backlog",
    "definition_ko": "수주됐으나 아직 인도되지 않은 누적 물량.",
    "why_it_matters_ko": "수주(계약 시점)와 인도(완료 시점)의 중간 재고 개념이다. 수주 시계열로 착각해 프록시 체인을 보정하면 시차(lag)가 이중으로 반영되는 오류가 생긴다.",
    "category": "industry",
    "related": [
      "수주",
      "인도"
    ],
    "used_in": [
      "proxy-industry-chain"
    ],
    "owner": "market-intelligence-agent"
  },
  {
    "key": "인도",
    "ko": "인도",
    "en": "Delivery",
    "definition_ko": "건조가 완료되어 발주처에 실제로 넘겨지는 시점.",
    "why_it_matters_ko": "매출 인식 시점과 가장 가까운 지표이나, 수주 대비 수년의 시차가 있어 수요 예측에 그대로 쓰면 시차 오류가 생긴다.",
    "category": "industry",
    "related": [
      "수주",
      "수주잔고"
    ],
    "used_in": [
      "proxy-industry-chain"
    ],
    "owner": "market-intelligence-agent"
  },
  {
    "key": "선급",
    "ko": "선급 (형식승인)",
    "en": "Classification Society Type Approval",
    "definition_ko": "DNV·LR·ABS·KR 등 선급 기관이 조선기자재의 안전·품질 기준 부합을 인증하는 제도.",
    "why_it_matters_ko": "조선기자재 사업 진출의 필수 인증이며, 인허가(permit)가 아니라 인증(certification)으로 별도 관리된다 — 없으면 팔 수 없다.",
    "category": "industry",
    "aliases": [
      "형식승인"
    ],
    "related": [
      "Certification Transferability"
    ],
    "used_in": [
      "certification-roadmap"
    ],
    "owner": "certification-agent"
  },
  {
    "key": "IMO Tier III",
    "ko": "IMO Tier III 규제",
    "en": "IMO Tier III Regulation",
    "definition_ko": "국제해사기구(IMO)의 선박 질소산화물(NOx) 배출 규제 3단계.",
    "why_it_matters_ko": "탈탄소·대체연료(메탄올·암모니아) 전환의 계기가 되는 규제로, 크랭크축 등 부품 사양과 수요 구조 자체를 바꾼다 — 대체·전환 위협 축의 대표 사례다.",
    "category": "industry",
    "related": [
      "Value Chain Linkage"
    ],
    "used_in": [
      "regulatory-change-response"
    ],
    "owner": "certification-agent"
  },
  {
    "key": "KSIC",
    "ko": "한국표준산업분류",
    "en": "Korean Standard Industrial Classification",
    "definition_ko": "통계청이 정한 한국의 표준 산업 분류 체계.",
    "why_it_matters_ko": "전방·전전방 산업을 연결하는 축이자 기준정보(md_industry)의 기준 코드 체계다. 이게 없으면 프록시 체인 자체를 구성할 수 없다.",
    "category": "industry",
    "related": [
      "Proxy Chain"
    ],
    "used_in": [
      "master-data-governance"
    ],
    "owner": "data-architect"
  },
  {
    "key": "corp_code",
    "ko": "DART 고유번호",
    "en": "DART Corporation Code",
    "definition_ko": "금융감독원 DART(전자공시시스템)가 부여하는 기업 고유 식별번호.",
    "why_it_matters_ko": "기준정보(md_company)의 기준 코드이며 피어그룹(베타 산출)·타겟·경쟁사 식별의 앵커다.",
    "category": "industry",
    "related": [
      "KSIC",
      "Peer Group"
    ],
    "used_in": [
      "master-data-governance"
    ],
    "owner": "data-architect"
  },
  {
    "key": "MktSizingBaseline",
    "ko": "기준 시장규모 산정",
    "en": "Baseline Market Sizing (Multi-source Cross-estimation)",
    "definition_ko": "독립 추정치 2~3개를 모아 기준연도 총시장 규모를 합의치로 삼고, 이상치는 명시적으로 제외하는 절차. systematic-market-sizing 2단계.",
    "why_it_matters_ko": "이후 모든 권역·세그먼트 배분이 이 기준값으로 수렴하므로, 단일 소스 인용이나 이상치 혼입은 매트릭스 전체를 왜곡한다.",
    "category": "industry",
    "aliases": [
      "앵커 삼각검증",
      "anchor triangulation",
      "기준규모 앵커링"
    ],
    "related": [
      "MktSizingAllocation",
      "MktSizingConsistency"
    ],
    "used_in": [
      "systematic-market-sizing"
    ],
    "owner": "market-intelligence-agent"
  },
  {
    "key": "MktSizingAllocation",
    "ko": "권역·세그먼트 배분",
    "en": "Region and Segment Allocation",
    "definition_ko": "기준 시장규모를 권역 가중치와 세그먼트 믹스로 나누어 권역×세그먼트 셀을 만드는 절차. 믹스는 바텀업 합산이 아니라 글로벌 교차검증치에 맞춘 보정 배분이다.",
    "why_it_matters_ko": "보정 배분을 소스 기반 데이터처럼 표기하면 근거 등급을 속이는 것이 되므로, 셀별 판단 조정을 반드시 출처와 함께 기록해야 한다.",
    "category": "industry",
    "related": [
      "MktSizingBaseline",
      "MktSizingCellCagr"
    ],
    "used_in": [
      "systematic-market-sizing"
    ],
    "owner": "market-intelligence-agent"
  },
  {
    "key": "MktSizingCellCagr",
    "ko": "셀별 CAGR·시나리오 밴드",
    "en": "Per-cell CAGRs and Scenario Bands",
    "definition_ko": "권역×세그먼트 셀마다 개별 CAGR을 부여하고, 비관/기본/낙관 밴드(base×0.5~base×1.55, 소스 불일치 셀은 문서화된 wider override)를 붙이는 절차. 시나리오 적용은 글로벌 단일 CAGR이 아니라 각 권역의 자체 셀 CAGR 복리로 계산한다.",
    "why_it_matters_ko": "글로벌 단일 CAGR로 시나리오를 돌리면 광산 집중 권역과 규제 성장 권역의 차이가 지워져, 매트릭스가 존재하는 이유 자체가 사라진다.",
    "category": "industry",
    "aliases": [
      "scenario bands"
    ],
    "related": [
      "MktSizingAllocation",
      "MktSizingYearlyShare",
      "MktSizingConsistency"
    ],
    "used_in": [
      "systematic-market-sizing"
    ],
    "owner": "quant-methodologist"
  },
  {
    "key": "MktSizingYearlyShare",
    "ko": "연도별 시장점유율 추이",
    "en": "Year-by-year Market-share Trend",
    "definition_ko": "각 셀의 기본 CAGR을 연도별로 복리 적용해 권역별 규모와 점유율의 연간 이동을 보여주는 심화 영역(4-A). 성장률(4단계)과 검증(5단계) 사이의 시장 구조 변화를 추적한다.",
    "why_it_matters_ko": "최종연도 증감만 보면 어느 권역이 언제 점유율을 바꾸는지 놓친다. 진입 시점 판단(S2 이후)의 핵심 입력이다.",
    "category": "industry",
    "related": [
      "MktSizingCellCagr"
    ],
    "used_in": [
      "systematic-market-sizing"
    ],
    "owner": "market-intelligence-agent"
  },
  {
    "key": "MktSizingConsistency",
    "ko": "성장률 정합성 확인",
    "en": "Growth-rate Consistency Check (Bottom-up vs Top-down)",
    "definition_ko": "매트릭스 롤업의 암시 글로벌 CAGR을 탑다운 컨센서스와 비교하는 내부 정합성 확인. 양쪽 모두 같은 부류의 소스로 소급되므로 독립적 확인이 아니다.",
    "why_it_matters_ko": "이 확인을 독립적 검증처럼 표현하면 근거가 이중으로 세는 착시가 생긴다. 허용 오차 밖이면 배분을 재검토해야 한다.",
    "category": "industry",
    "aliases": [
      "정합성 체크",
      "consistency check"
    ],
    "related": [
      "MktSizingCellCagr",
      "MktSizingFilingValidation"
    ],
    "used_in": [
      "systematic-market-sizing"
    ],
    "owner": "quant-methodologist"
  },
  {
    "key": "MktSizingFilingValidation",
    "ko": "기업 공시 교차검증",
    "en": "Cross-validation Against Company Filings",
    "definition_ko": "카테고리 내 상장사의 연차·중간보고서 원문으로 매트릭스 주장을 검증하고, 구조적으로 검증 불가능한 항목(상위 보고 단위에 묻힌 카테고리 매출 등)은 검증 불가로 명시하는 절차.",
    "why_it_matters_ko": "검증 불가가 '탐색 실패'인지 '공시 구조의 한계'인지 구분해야 유료 소스 투자 판단이 가능하고, 과대 확신을 막을 수 있다.",
    "category": "industry",
    "aliases": [
      "1차 소스 교차검증",
      "first-party source cross-validation"
    ],
    "related": [
      "MktSizingConsistency",
      "MktSizingLimitations"
    ],
    "used_in": [
      "systematic-market-sizing",
      "company-intelligence"
    ],
    "owner": "market-intelligence-agent"
  },
  {
    "key": "MktSizingLimitations",
    "ko": "분석 한계 목록",
    "en": "Known-limitations List",
    "definition_ko": "판단적 보정, 소스 간 불일치, 외삽 불가 신호를 번호 붙여 고정하고 체인 등급 상한을 재확인하는 목록. 이 목록 없이는 매트릭스를 인용할 수 없다.",
    "why_it_matters_ko": "한계를 숫자로 고정해야 다음 사이클에서 무엇을 먼저 해소할지 우선순위가 정해지고, 소비자의 과대 신뢰를 차단한다.",
    "category": "industry",
    "aliases": [
      "한계 레지스터",
      "limitations register"
    ],
    "related": [
      "MktSizingFilingValidation",
      "MktSizingRegistry"
    ],
    "used_in": [
      "systematic-market-sizing"
    ],
    "owner": "market-intelligence-agent"
  },
  {
    "key": "MktSizingRegistry",
    "ko": "가정 레지스트리 등록",
    "en": "Assumption-registry Registration",
    "definition_ko": "동결된 매트릭스를 assumption 레지스트리에 조합당 1 row(kind='assumed', rationale + anchor_ref + TTL)로 기록하는 최종 절차. 레지스트리는 append-only다.",
    "why_it_matters_ko": "등록되지 않은 시장 분석은 게이트 심사에서 근거로 인정되지 않는다. recordAssumption 경로를 써야 rationale 필수 규칙(FR-DATA-07)이 강제된다.",
    "category": "industry",
    "aliases": [
      "레지스트리 등록",
      "registry registration"
    ],
    "related": [
      "MktSizingLimitations"
    ],
    "used_in": [
      "systematic-market-sizing",
      "evidence-ledger"
    ],
    "owner": "market-intelligence-agent"
  },
  {
    "key": "기업결합신고",
    "ko": "기업결합신고",
    "en": "Merger Control Filing",
    "definition_ko": "M&A 시 관할 경쟁당국에 기업결합을 사전 또는 사후 신고하는 절차(한국 공정거래법 기준).",
    "why_it_matters_ko": "다중 관할(KR·US·EU·CN 등) 동시 신고가 필요할 수 있고, 신고 지연이 클로징 지연 → IRR 하락으로 직결된다.",
    "category": "legal",
    "aliases": [
      "Merger Control"
    ],
    "related": [
      "HSR",
      "Gun-Jumping",
      "HHI"
    ],
    "used_in": [
      "antitrust-screening"
    ],
    "owner": "antitrust-agent"
  },
  {
    "key": "HSR",
    "ko": "HSR 신고",
    "en": "Hart-Scott-Rodino Filing",
    "definition_ko": "미국의 기업결합 사전신고 제도(Hart-Scott-Rodino Antitrust Improvements Act).",
    "why_it_matters_ko": "신고 기준액(threshold)을 초과하면 필수이며, 대기기간(waiting period)이 클로징 일정에 직접 영향을 준다.",
    "category": "legal",
    "related": [
      "기업결합신고",
      "CFIUS"
    ],
    "used_in": [
      "antitrust-screening"
    ],
    "owner": "antitrust-agent"
  },
  {
    "key": "CFIUS",
    "ko": "미국 외국인투자심사위원회",
    "en": "Committee on Foreign Investment in the United States",
    "definition_ko": "외국인의 미국 기업 인수를 국가안보 관점에서 심사하는 미국 정부 위원회.",
    "why_it_matters_ko": "해외(미국) M&A 시 외국인투자 심사 필수 검토 축 중 하나이며, region-profiles에서 지역별 요건으로 관리된다.",
    "category": "legal",
    "related": [
      "기업결합신고"
    ],
    "used_in": [
      "regulatory-screening"
    ],
    "owner": "region-lead"
  },
  {
    "key": "Gun-Jumping",
    "ko": "사전 통합행위 금지",
    "en": "Gun-Jumping",
    "definition_ko": "기업결합신고 승인(클리어런스) 전에 실질적인 통합 행위를 하는 것. 대부분의 관할에서 제재 대상이다.",
    "why_it_matters_ko": "신고 필요 관할에서는 승인 전 어떠한 통합 행위도 진행할 수 없다 — 절차 체크리스트에 강제 항목으로 들어간다.",
    "category": "legal",
    "related": [
      "기업결합신고"
    ],
    "used_in": [
      "antitrust-screening"
    ],
    "owner": "antitrust-agent"
  },
  {
    "key": "HHI",
    "ko": "허핀달-허쉬만 지수",
    "en": "Herfindahl-Hirschman Index",
    "definition_ko": "시장 집중도를 측정하는 지수(시장점유율 제곱의 합).",
    "why_it_matters_ko": "기업결합 전후 HHI와 그 델타(변화폭)가 경쟁당국의 시정조치 요구 여부를 좌우한다.",
    "category": "legal",
    "related": [
      "기업결합신고"
    ],
    "used_in": [
      "antitrust-screening"
    ],
    "owner": "antitrust-agent"
  },
  {
    "key": "Change of Control",
    "ko": "지배구조 변경 (CoC)",
    "en": "Change of Control",
    "definition_ko": "소유권·경영권이 변경되는 사건. M&A에서는 계약 해지권·기한이익상실·경영진 보상 등 다수 조항의 발동 트리거가 된다.",
    "why_it_matters_ko": "고객 계약·차입 약정·경영진 보상·인증 승계 네 곳 모두에서 발동하는 단일 최대 M&A 리스크 원인이다.",
    "category": "legal",
    "aliases": [
      "CoC"
    ],
    "related": [
      "Golden Parachute",
      "Covenant",
      "Certification Transferability"
    ],
    "used_in": [
      "customer-attrition-risk",
      "debt-and-contingent-liability-simulation"
    ],
    "owner": "brownfield-agent"
  },
  {
    "key": "NDA",
    "ko": "비밀유지계약",
    "en": "Non-Disclosure Agreement",
    "definition_ko": "딜 관련 정보의 공개를 제한하는 계약.",
    "why_it_matters_ko": "DD 자료를 시스템에 적재하는 행위 자체가 NDA 위반인지를 착수 시점에 legal-counsel이 판정해야 한다.",
    "category": "legal",
    "related": [
      "MNPI"
    ],
    "used_in": [
      "expert-interview"
    ],
    "owner": "legal-counsel"
  },
  {
    "key": "MNPI",
    "ko": "미공개중요정보",
    "en": "Material Non-Public Information",
    "definition_ko": "공개되지 않은 투자 판단에 중대한 영향을 미치는 정보. 상장사 관련 딜은 대부분 MNPI에 해당한다.",
    "why_it_matters_ko": "내부자거래 규제 대상이며, 세션 단위 insider 등록(명부+스코프+로그) 없이는 MCP로 접근할 수 없다.",
    "category": "legal",
    "related": [
      "Insider List"
    ],
    "used_in": [
      "access-control-review"
    ],
    "owner": "security-engineer"
  },
  {
    "key": "일감 몰아주기",
    "ko": "일감 몰아주기",
    "en": "Improper Benefit Provision to Related Parties",
    "definition_ko": "공정거래법 제47조가 규제하는, 특수관계인에게 부당한 이익을 제공하는 계열사 간 거래.",
    "why_it_matters_ko": "계열사 간 거래가 포함된 M&A 안건에서는 그룹 심의 단계에서 자동으로 이 규제 체크가 발동해야 한다.",
    "category": "legal",
    "related": [
      "Group IC"
    ],
    "used_in": [
      "intra-group-transaction-compliance"
    ],
    "owner": "group-review-agent"
  },
  {
    "key": "Works Council Consultation",
    "ko": "근로자대표 협의",
    "en": "Works Council Consultation",
    "definition_ko": "사업 변경(M&A 등) 전 근로자 대표 기구와의 사전 협의를 요구하는 EU의 노동법 요건.",
    "why_it_matters_ko": "이 절차를 빠뜨리면 클로징이 지연된다 — 지역 프로파일의 필수 검토 축이다.",
    "category": "legal",
    "related": [
      "Certification Transferability"
    ],
    "used_in": [
      "regulatory-screening"
    ],
    "owner": "region-lead"
  },
  {
    "key": "Certification Transferability",
    "ko": "인증 승계 가능성",
    "en": "Certification Transferability on Change of Control",
    "definition_ko": "M&A 시 인수 대상이 보유한 인증이 법인 변경 후에도 유지되는지 여부.",
    "why_it_matters_ko": "“이미 인증을 보유했다”는 밸류에이션 프리미엄의 주요 근거인데, 일부 인증 스킴은 법인 변경 시 재심사 대상이다. 추정 금지 — 스킴 규정 원문을 확인해야 한다.",
    "category": "legal",
    "related": [
      "Change of Control"
    ],
    "used_in": [
      "certification-transferability"
    ],
    "owner": "certification-agent"
  },
  {
    "key": "Run",
    "ko": "실행 (run)",
    "en": "Run",
    "definition_ko": "타당성 모델을 한 번 실행한 결과. 입력 전체 스냅샷(run_input)과 input_hash를 함께 저장하는 불변 레코드.",
    "why_it_matters_ko": "두 run을 diff하면 어떤 변수가 얼마나 변해서 NPV가 얼마 움직였는지 금액으로 분해할 수 있다 — \"보고서 재작성 없이 데이터 변경이 반영된다\"는 핵심 주장의 실체다.",
    "category": "technical",
    "related": [
      "Run Diff",
      "Attribution"
    ],
    "used_in": [
      "run-versioning-and-attribution"
    ],
    "owner": "data-architect"
  },
  {
    "key": "Run Diff",
    "ko": "실행 비교 (run diff)",
    "en": "Run Diff",
    "definition_ko": "두 run 사이의 입력 변화를 변수별 NPV 기여도(금액)로 분해한 비교 결과.",
    "why_it_matters_ko": "순서 의존 잔차는 interaction 항목으로 별도 표기하고 합계를 억지로 맞추지 않는다 — 정직한 귀인분석이 신뢰의 기반이다.",
    "category": "technical",
    "related": [
      "Run",
      "Attribution"
    ],
    "used_in": [
      "run-versioning-and-attribution"
    ],
    "owner": "quant-methodologist"
  },
  {
    "key": "Attribution",
    "ko": "귀인분석",
    "en": "Attribution Analysis",
    "definition_ko": "NPV 변화를 각 입력 변수의 기여도로 분해하는 분석.",
    "why_it_matters_ko": "규정 개정 파이프라인·회귀 테스트·IC 재심의 대응까지 이 개념 하나로 연결된다.",
    "category": "technical",
    "related": [
      "Run Diff"
    ],
    "used_in": [
      "run-versioning-and-attribution"
    ],
    "owner": "quant-methodologist"
  },
  {
    "key": "Proxy Chain",
    "ko": "프록시 체인",
    "en": "Proxy Industry Chain",
    "definition_ko": "대상 산업 데이터가 없을 때 전방(Tier 1)·전전방(Tier 2) 산업 데이터를 단위 환산해 규모를 추정하는 체계.",
    "why_it_matters_ko": "크랭크축 → 선박엔진(BHP) → 선박(CGT)처럼 두 단계를 건너뛰는 게 예외가 아니라 표준인 산업이 있다. 체인 신뢰도 등급이 RAG 데이터 신뢰도 캡으로 직결된다.",
    "category": "technical",
    "aliases": [
      "가치사슬 연계 산업"
    ],
    "related": [
      "Value Chain Linkage",
      "Reliability Grade"
    ],
    "used_in": [
      "proxy-industry-chain",
      "unit-conversion-calibration"
    ],
    "owner": "quant-methodologist"
  },
  {
    "key": "Value Chain Linkage",
    "ko": "가치사슬 연관성",
    "en": "Value Chain Linkage",
    "definition_ko": "전·후방 산업과의 수요 파생·원가 전가력·교섭력·사이클 동조성·수직통합 압력·대체 위협 6축 분석.",
    "why_it_matters_ko": "프록시 체인과 목적이 다르다 — 프록시는 데이터 대체 추정, 연관성은 리스크 평가다. 두 계수를 섞으면 둘 다 틀린다.",
    "category": "technical",
    "related": [
      "Proxy Chain"
    ],
    "used_in": [
      "value-chain-linkage-analysis"
    ],
    "owner": "market-intelligence-agent"
  },
  {
    "key": "RAG Dimension",
    "ko": "RAG 판정 차원",
    "en": "RAG Dimension",
    "definition_ko": "재무성·시장·데이터 신뢰도·규제인허가·기술실행·리스크 6개 차원과 종합 등급.",
    "why_it_matters_ko": "가중평균이 아니라 규칙 기반이며, 데이터 신뢰도가 종합 등급의 상한을 캡한다 — 이게 이 체계에서 가장 중요한 규칙이다.",
    "category": "technical",
    "aliases": [
      "RAG",
      "Red-Amber-Green"
    ],
    "related": [
      "Reliability Grade",
      "Hysteresis"
    ],
    "used_in": [
      "rag-scoring-framework"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Reliability Grade",
    "ko": "체인 신뢰도 등급",
    "en": "Chain Reliability Grade",
    "definition_ko": "프록시 체인의 각 홉 오차를 종합한 A/B/C 등급.",
    "why_it_matters_ko": "B등급이면 종합 RAG가 최대 Amber로 캡되고, C등급이면 \"판단 보류\"로 표기된다. 2홉 프록시로 추정한 시장에 재무만 보고 Green을 줄 수 없다.",
    "category": "technical",
    "related": [
      "Proxy Chain",
      "RAG Dimension"
    ],
    "used_in": [
      "proxy-industry-chain"
    ],
    "owner": "quant-methodologist"
  },
  {
    "key": "Hysteresis",
    "ko": "히스테리시스",
    "en": "Hysteresis",
    "definition_ko": "등급 승격과 강등의 임계값을 다르게 설정해(승격이 더 엄격) 경계에서 등급이 매일 바뀌는 것을 막는 규칙.",
    "why_it_matters_ko": "경계에서 등급이 자주 바뀌면 아무도 신호를 신뢰하지 않는다. 최소 유지 기간과 함께 적용된다.",
    "category": "technical",
    "related": [
      "RAG Dimension"
    ],
    "used_in": [
      "rag-scoring-framework"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Project Policy Pin",
    "ko": "프로젝트 규정 버전 고정",
    "en": "Project Policy Pin",
    "definition_ko": "프로젝트를 착수 시점의 규정 버전에 고정하는 메커니즘.",
    "why_it_matters_ko": "이게 없으면 규정이 바뀐 날 아침 어제 Green이던 프로젝트가 이유 없이 Red가 된다. Group IC도 원칙적으로 이 pin된 버전으로 심의한다.",
    "category": "technical",
    "related": [
      "Policy Change Pipeline"
    ],
    "used_in": [
      "policy-change-impact-analysis"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "References Override",
    "ko": "참조·오버라이드 모델",
    "en": "References + Override Model",
    "definition_ko": "공통 절차를 복사하지 않고 참조(references) + 차분(overrides)만 선언하는 절차 관리 방식. safety_os의 워크플로우 참조 스펙에서 차용.",
    "why_it_matters_ko": "그룹 규정이 바뀌면 모든 각사·지역 절차가 자동으로 따라간다 — 복사본이 생기면 이 성질이 깨지므로 감사가 복사본을 차단한다.",
    "category": "technical",
    "related": [
      "Project Policy Pin"
    ],
    "used_in": [
      "procedure-reference-override"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Assumed",
    "ko": "추정값 (assumed)",
    "en": "Assumed",
    "definition_ko": "가정 레지스트리의 값 종류 중 사람의 판단으로 추정한 값. rationale 필드가 NOT NULL 제약이다.",
    "why_it_matters_ko": "근거 없는 숫자가 보고서에 들어가는 것을 스키마 레벨에서 차단하는 장치다.",
    "category": "technical",
    "related": [
      "Assumption Kind"
    ],
    "used_in": [
      "assumption-audit"
    ],
    "owner": "risk-officer"
  },
  {
    "key": "Staleness Gate",
    "ko": "신선도 게이트",
    "en": "Staleness Gate",
    "definition_ko": "as_of + ttl_days를 초과한 live 데이터가 하나라도 있으면 보고서 최종화를 차단하는 규칙.",
    "why_it_matters_ko": "“데이터가 바뀌면 보고서가 다시 쓰여야 한다”는 문제의 실제 해결 장치다.",
    "category": "technical",
    "related": [
      "Run"
    ],
    "used_in": [
      "data-freshness-and-revision-control"
    ],
    "owner": "data-architect"
  }
];
