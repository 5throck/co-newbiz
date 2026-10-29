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
    "key": "Checklist Review Status",
    "ko": "체크리스트 항목 검토 상태",
    "en": "Checklist Review Status",
    "definition_ko": "체크리스트 항목마다 붙는 세 단계 표시. 'AI 작성·검토 전'(draft-AI, 표시가 없으면 기본값), '법무 검토됨'(counsel-reviewed, 검토자 이름·일자 필수), '확정'(confirmed, 검토자 이름·일자 필수).",
    "why_it_matters_ko": "AI가 쓰고 AI가 검토한 항목은 1차 검토일 뿐 확정이 아니다. 화면에 상태를 드러내 사람이 어느 항목을 더 확인해야 하는지 알게 한다. 참고용 표시이며 게이트 통과를 막지 않는다.",
    "category": "business",
    "aliases": [
      "항목 검토 상태"
    ],
    "related": [
      "Draft AI Status",
      "Counsel Reviewed Status",
      "Confirmed Status",
      "Stage Gate"
    ],
    "used_in": [
      "legal-due-diligence"
    ],
    "owner": "glossary-curator"
  },
  {
    "key": "Draft AI Status",
    "ko": "AI 작성·검토 전",
    "en": "Draft AI Status",
    "definition_ko": "체크리스트 항목의 기본 상태. AI가 쓰거나 AI만 검토했고 사람이 아직 확인하지 않았다는 표시(draft-AI). 표시가 없으면 이 상태로 본다.",
    "why_it_matters_ko": "이 상태의 항목은 사람이 더 확인해야 할 대상이다. AI 검토는 1차 검토일 뿐이며 확정으로 읽으면 안 된다.",
    "category": "business",
    "aliases": [
      "draft-AI",
      "AI 작성",
      "검토 전"
    ],
    "related": [
      "Checklist Review Status",
      "Counsel Reviewed Status",
      "Confirmed Status"
    ],
    "used_in": [
      "legal-due-diligence"
    ],
    "owner": "glossary-curator"
  },
  {
    "key": "Counsel Reviewed Status",
    "ko": "법무 검토됨",
    "en": "Counsel Reviewed Status",
    "definition_ko": "법무 담당자가 항목을 검토했다는 표시(counsel-reviewed). 검토자 이름과 검토 일자를 반드시 함께 남긴다.",
    "why_it_matters_ko": "법령·계약 관련 항목은 법무 검토를 거쳐야 AI 초안 단계를 벗어난다. 검토자와 일자가 없으면 책임 소재를 추적할 수 없다.",
    "category": "business",
    "aliases": [
      "counsel-reviewed",
      "법무 검토"
    ],
    "related": [
      "Checklist Review Status",
      "Draft AI Status",
      "Confirmed Status"
    ],
    "used_in": [
      "legal-due-diligence"
    ],
    "owner": "glossary-curator"
  },
  {
    "key": "Confirmed Status",
    "ko": "확정",
    "en": "Confirmed Status",
    "definition_ko": "담당자가 항목 내용을 최종 확인했다는 표시(confirmed). 검토자 이름과 확인 일자를 반드시 함께 남긴다.",
    "why_it_matters_ko": "세 단계 가운데 가장 높은 확인 수준이다. 그래도 참고용 표시이며, 게이트 통과와 투자 결정은 사람이 내린다.",
    "category": "business",
    "aliases": [
      "confirmed",
      "확정됨"
    ],
    "related": [
      "Checklist Review Status",
      "Draft AI Status",
      "Counsel Reviewed Status"
    ],
    "used_in": [
      "legal-due-diligence"
    ],
    "owner": "glossary-curator"
  },
  {
    "key": "Investment Vehicle",
    "ko": "투자 주체",
    "en": "Investment Vehicle",
    "definition_ko": "투자가 실행되는 주체이자 통로(직접 투자, SPC, 지주회사, 사내 분사, 합작법인 등). S10에서 4축(세무 구조·책임 분리·재무 레버리지·엑시트 구조) 검토와 함께 정한다(ADR-0045).",
    "why_it_matters_ko": "투자 주체의 선택이 세금 비용, 책임 분리, 차입 여력, 엑시트 선택지를 함께 결정하며, 계약 체결 뒤에는 적은 비용으로 바꾸기 어렵다. 과거 음차어 '비히클' 대신 '투자 주체'를 쓴다.",
    "category": "business",
    "related": [
      "Brown Field",
      "Establishment Entity Form",
      "Stage Gate"
    ],
    "used_in": [
      "investment-vehicle-structuring",
      "brownfield-feasibility",
      "jv-structuring"
    ],
    "owner": "brownfield-agent"
  },
  {
    "key": "Establishment Entity Form",
    "ko": "설립 법인 형태",
    "en": "Establishment Entity Form",
    "definition_ko": "그린필드 신규 설립 시 사업을 담을 법인의 형태(단독 법인, 합작법인, 지점·사업장 등). S10에서 그린필드 경로의 투자 주체 자리에 쓰는 표현이다.",
    "why_it_matters_ko": "법인 형태에 따라 인허가 주체, 세무 처리, 책임 범위, 자금 조달 방식이 달라지며 설립 뒤 변경은 비용이 크다. 그린필드에서는 '투자 주체' 대신 이 표현을 쓴다.",
    "category": "business",
    "related": [
      "Investment Vehicle",
      "Green Field"
    ],
    "used_in": [
      "greenfield-feasibility",
      "investment-vehicle-structuring"
    ],
    "owner": "greenfield-agent"
  },
  {
    "key": "Establishment Mode",
    "ko": "설립 방식",
    "en": "Establishment Mode",
    "definition_ko": "그린필드 사업을 어떤 법적 틀로 추진할지 정하는 프로젝트 단위 선택. '신규 법인 설립'과 '신규 사업부 추진' 두 가지가 있다. 사람이 S10에서 확정하며, 에이전트는 제안만 할 수 있다.",
    "why_it_matters_ko": "설립 방식에 따라 S11 실행 5단계와 점검 목록이 달라지고, 책임 격리 여부가 갈린다. 선택한 이유를 남겨 투자심의위원회가 근거를 볼 수 있게 한다. 투자 주체를 정하는 '추진 주체(origin)'와는 다른 축이다.",
    "category": "business",
    "aliases": [
      "new_entity/business_unit",
      "establishment_mode"
    ],
    "related": [
      "Green Field",
      "Establishment Entity Form",
      "New Legal Entity Formation",
      "New Business Unit"
    ],
    "used_in": [
      "greenfield-feasibility"
    ],
    "owner": "greenfield-agent"
  },
  {
    "key": "New Legal Entity Formation",
    "ko": "신규 법인 설립",
    "en": "New Legal Entity Formation",
    "definition_ko": "그린필드 사업을 담을 새 법인을 세워 추진하는 설립 방식(내부 코드 new_entity). S11에서 설립 준비·법인등기·인허가 분류·인력 이전·완료 확인의 5단계를 실행한다.",
    "why_it_matters_ko": "새 법인은 책임을 모회사와 나눌 수 있지만 설립·운영 부담이 따른다. 합작 추진이면 반드시 이 방식이다.",
    "category": "business",
    "aliases": [
      "new_entity"
    ],
    "related": [
      "Establishment Mode",
      "Establishment Entity Form",
      "New Business Unit"
    ],
    "used_in": [
      "greenfield-feasibility"
    ],
    "owner": "greenfield-agent"
  },
  {
    "key": "New Business Unit",
    "ko": "신규 사업부 추진",
    "en": "New Business Unit",
    "definition_ko": "새 법인을 세우지 않고 기존 법인 안의 사업부로 신사업을 추진하는 설립 방식(내부 코드 business_unit). 우리 회사가 단독으로 추진할 때만 고를 수 있다. S11에서 사업부 신설 결의·사업자등록 정리·인허가 명의 확인·인력 배치·완료 확인의 5단계를 실행한다.",
    "why_it_matters_ko": "법인 설립 절차는 줄지만 책임이 격리되지 않아 사업부의 부채와 책임이 모두 기존 법인에 남는다. 투자심의 자료에 이 점이 항상 표시된다.",
    "category": "business",
    "aliases": [
      "business_unit",
      "신규 사업부"
    ],
    "related": [
      "Establishment Mode",
      "New Legal Entity Formation",
      "Business Unit Form"
    ],
    "used_in": [
      "greenfield-feasibility"
    ],
    "owner": "greenfield-agent"
  },
  {
    "key": "Business Unit Form",
    "ko": "사업부 신설 형태",
    "en": "Business Unit Form",
    "definition_ko": "신규 사업부 추진을 택했을 때 사업부를 만드는 모양(독립 사업부, 기존 사업부 내 팀, 사내 독립 기업(CIC)). 법인 형태 대신 S10에서 정한다.",
    "why_it_matters_ko": "형태에 따라 손익을 따로 관리할지, 위임전결을 어디까지 줄지가 달라진다. 어느 쪽이든 별도 법인이 아니어서 책임 격리는 없다.",
    "category": "business",
    "related": [
      "New Business Unit",
      "Establishment Mode",
      "Establishment Entity Form"
    ],
    "used_in": [
      "greenfield-feasibility"
    ],
    "owner": "greenfield-agent"
  },
  {
    "key": "Stage Gate",
    "ko": "게이트",
    "en": "Stage Gate",
    "definition_ko": "Screening → Pre-FS → FS → DD → 법인 투자심의위원회 → 그룹 투자심의위원회 순으로 진행되는 신사업 검토 단계.",
    "why_it_matters_ko": "각 게이트마다 필수 산출물과 통과 조건이 다르다. 게이트를 건너뛰면 시스템이 다음 단계 진입을 차단한다.",
    "category": "business",
    "aliases": [
      "스테이지 게이트",
      "게이트 심사"
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
    "why_it_matters_ko": "이 단계에서 이미 데이터 신뢰도·프록시 체인 등급이 산출되므로, Pre-FS의 종합 등급이 낮으면 FS로 넘어가기 전에 데이터를 보강해야 한다.",
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
    "ko": "법인 투자심의위원회",
    "en": "Entity Investment Committee",
    "aliases": [
      "Entity IC",
      "Entity-IC",
      "법인 심의",
      "IC 심의"
    ],
    "definition_ko": "개별 계열사 단위에서 진행되는 투자 승인 심의.",
    "why_it_matters_ko": "그룹 투자심의위원회 진입의 시스템 강제 선행 조건이다. 법인 투자심의위원회 승인 없이 그룹 절차에 들어갈 수 없다.",
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
    "aliases": [
      "Group IC",
      "Group-IC",
      "그룹 IC",
      "그룹 심의"
    ],
    "definition_ko": "계열사 개별 승인과 별개로 그룹 차원에서 진행되는 심의로, 포트폴리오 정합성·자본 배분 우선순위를 본다.",
    "why_it_matters_ko": "각사 기준 전부 Green인 안건이 여러 개 올라와도 자본은 하나다. 그룹 투자심의위원회는 승인/부결이 아니라 순위 결정인 경우가 많다.",
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
    "definition_ko": "사전에 정의된 조건 충족 시 검토를 자동으로 중단시키는 규칙(예 — 필수 인증 미취득, 대출 약정 조건(커버넌트) 위반).",
    "why_it_matters_ko": "중단 기준 없는 검토는 표류하고 \"검토\"가 \"정당화\"로 변질된다. 낙관편향을 구조적으로 차단하는 장치다.",
    "category": "business",
    "aliases": [
      "중단 조건",
      "Kill Criteria 제안"
    ],
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
    "ko": "면제 요청",
    "en": "Waiver",
    "definition_ko": "필수 산출물·체크리스트 미충족 상태에서 게이트를 통과시키는 명시적 예외.",
    "why_it_matters_ko": "예외 경로가 없으면 현장이 음성적으로 우회한다. 반드시 만료일이 있어야 하며, 같은 조항에 반복되면 규정 개정 신호다.",
    "category": "business",
    "aliases": [
      "예외 승인",
      "면제",
      "면제 승인"
    ],
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
    "definition_ko": "동일 심의 사이클에서 그룹 투자심의위원회에 올라온 복수 안건을 우선순위로 비교하는 뷰.",
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
    "key": "Investment Committee Package",
    "ko": "투자심의 자료",
    "en": "IC package",
    "definition_ko": "S10에서 설계한 투자 구조와 자금 조달 계획, 채택된 Business Case, DD 발견사항, RAG 제안을 한 묶음으로 정리해 S11 투자심의위원회(IC)에 올리는 자료.",
    "why_it_matters_ko": "심의 자료는 판단의 근거를 모은 것이지 결재가 아니다 — 종합 등급은 제안일 뿐이며 승인과 투자 결정은 사람이 내린다(경계",
    "category": "business",
    "aliases": [
      "IC 자료",
      "IC package"
    ],
    "related": [
      "Stage Gate"
    ],
    "used_in": [
      "stage-gate-governance"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "New Business",
    "ko": "신규 사업",
    "en": "New Business",
    "definition_ko": "지금 하지 않는 분야에 새로 진출하는 사업. 부지·설비를 새로 짓는 그린필드와 기존 기업을 인수하는 브라운필드 두 경로로 추진한다.",
    "why_it_matters_ko": "이 시스템이 검토하는 대상 자체를 가리키는 말이다. 화면과 문서에서 같은 표현을 써야 같은 안건을 서로 다르게 읽는 일이 없다.",
    "category": "business",
    "aliases": [
      "새로 세우는 사업"
    ],
    "related": [
      "Green Field",
      "Brown Field"
    ],
    "used_in": [
      "stage-gate-governance"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Workforce and Organization Plan",
    "ko": "인력/조직 계획",
    "en": "Workforce and Organization Plan",
    "definition_ko": "신규 사업을 운영할 인력 규모, 필요한 직무, 조직 구성을 정리한 계획. 그린필드는 채용과 조직 신설, 브라운필드는 인수 뒤 인력 통합을 다룬다.",
    "why_it_matters_ko": "인력이 갖춰지지 않으면 설비와 인허가가 준비돼도 가동이 늦어진다. 슬래시를 넣어 '인력/조직 계획'으로 한 덩어리로 쓴다.",
    "category": "business",
    "aliases": [
      "인력 조직 계획",
      "인력·조직 계획"
    ],
    "related": [
      "Green Field",
      "Brown Field"
    ],
    "used_in": [
      "talent-pipeline-planning",
      "pmi-planning"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Priority Investment Area",
    "ko": "중점 투자 분야",
    "en": "Priority Investment Area",
    "definition_ko": "그룹이나 회사가 투자 자원을 우선 배분하겠다고 정한 사업 분야.",
    "why_it_matters_ko": "안건이 중점 투자 분야에 맞는지가 전략 적합성 판단의 출발점이다. 분야에서 벗어난 안건은 더 강한 근거가 있어야 한다.",
    "category": "business",
    "aliases": [
      "중점 분야",
      "전략 투자 분야"
    ],
    "related": [
      "Group IC",
      "Group Agenda"
    ],
    "used_in": [
      "strategic-fit-screening",
      "portfolio-fit-assessment"
    ],
    "owner": "group-review-agent"
  },
  {
    "key": "Status Quo Option",
    "ko": "현상 유지안",
    "en": "Status Quo Option",
    "definition_ko": "새 사업에 진출하지 않고 지금 상태를 이어 가는 선택지. 다른 안과 비교하는 기준선이 된다.",
    "why_it_matters_ko": "투자안이 좋아 보여도 아무것도 하지 않는 경우보다 나은지 비교해야 한다. 현상 유지안이 빠지면 검토가 정당화로 흐르기 쉽다.",
    "category": "business",
    "aliases": [
      "현상 유지",
      "아무것도 하지 않는 안",
      "Do Nothing"
    ],
    "related": [
      "Kill Criteria",
      "Stage Gate"
    ],
    "used_in": [
      "stage-gate-governance"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Partnership",
    "ko": "전략 제휴",
    "en": "Partnership",
    "definition_ko": "지분 인수나 신규 설립 없이 다른 기업과 협력해 사업에 진출하는 방식(합작, 기술 제휴, 공급·판매 제휴 등). 화면에서는 '전략 제휴'로 표기한다.",
    "why_it_matters_ko": "자산을 적게 들이는 대신 통제력이 낮다. 통제 필요도가 높은 안건에서는 선택할 수 없는 경로가 있다. 이전 표기 '파트너십'은 별칭으로만 남긴다.",
    "category": "business",
    "aliases": [
      "파트너십",
      "제휴",
      "파트너십 모니터링"
    ],
    "related": [
      "Green Field",
      "Brown Field"
    ],
    "used_in": [
      "partner-sourcing-strategy",
      "jv-structuring"
    ],
    "owner": "partnership-agent"
  },
  {
    "key": "Overall Grade",
    "ko": "종합 등급",
    "en": "Overall Grade",
    "definition_ko": "6개 판정 차원을 규칙에 따라 합쳐 나온 안건 전체의 신호등 등급(Green·Amber·Red). 시스템이 제안하는 값이다.",
    "why_it_matters_ko": "데이터 신뢰도가 이 등급의 상한을 정한다. 제안일 뿐이며 승인과 투자 결정은 사람이 내린다.",
    "category": "business",
    "aliases": [
      "종합 판정",
      "제안 등급"
    ],
    "related": [
      "RAG Dimension",
      "Reliability Grade",
      "Stage Gate"
    ],
    "used_in": [
      "rag-scoring-framework"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Capability Judgement Stale",
    "ko": "재판정 필요",
    "en": "Capability Judgement Stale",
    "definition_ko": "필요 역량의 달성 가능성 판정을 내린 뒤 그 근거(S3 필요 역량 정의, 브라운필드는 대상의 평가 기준 판정)가 바뀌어 기존 판정을 더는 믿을 수 없는 상태. 확정이 풀리고 이전 값은 기록으로 남으며 미판정으로 센다.",
    "why_it_matters_ko": "바뀐 근거 위에 예전 판정이 그대로 남으면 S8 기술적 타당성과 게이트 요약이 낡은 판정을 확정된 것처럼 보여 준다. 사람이 다시 판정해야 풀리며, 참고용 표시라 게이트나 등급을 막지 않는다.",
    "category": "business",
    "aliases": [
      "재평가 필요",
      "재판정 필요"
    ],
    "related": [
      "Target Capability Judgement",
      "Stage Gate"
    ],
    "used_in": [
      "brownfield-feasibility",
      "greenfield-feasibility"
    ],
    "owner": "platform-lead"
  },
  {
    "key": "Target Capability Judgement",
    "ko": "대상별 필요 역량 점검",
    "en": "Target Capability Judgement",
    "definition_ko": "브라운필드 S7에서 최종 후보(숏리스트) 대상마다 S3 필요 역량 행에 대해 해소 방식·기대 수준·비용·기간·달성 가능성을 판정한 기록. 그린필드는 S5가 같은 판정을 맡는다. 사람이 확정하기 전까지는 확정 전 판정이다.",
    "why_it_matters_ko": "어떤 대상이 유망한가는 대상마다 다르다. 판정이 대상별로 저장되어 한 대상의 변경이 다른 대상의 판정을 흔들지 않는다. S8은 선정된 대상의 판정을 읽기 전용으로 보여 줄 뿐 고치지 않는다.",
    "category": "business",
    "aliases": [
      "S7 필요 역량 점검",
      "대상별 역량 판정"
    ],
    "related": [
      "Capability Judgement Stale",
      "Brown Field",
      "Green Field"
    ],
    "used_in": [
      "brownfield-feasibility"
    ],
    "owner": "platform-lead"
  },
  {
    "key": "Market Share",
    "ko": "시장점유율",
    "en": "Market Share",
    "definition_ko": "시장 규모 가운데 우리 사업이 차지하는 몫. S8 사업성 분석에서는 `1년차 시장점유율`(비율)에 시장 규모를 곱해 첫해 매출을 추정한다.",
    "why_it_matters_ko": "직접 시장 데이터가 없는 신규 사업에서는 첫해 매출이 이 가정 하나에 크게 좌우된다. 사람이 확정한 값인지 기본값인지 출처를 함께 확인해야 한다.",
    "category": "business",
    "aliases": [
      "1년차 시장점유율"
    ],
    "related": [
      "Green Field"
    ],
    "used_in": [
      "greenfield-feasibility"
    ],
    "owner": "valuation-agent"
  },
  {
    "key": "Countersign",
    "ko": "두 번째 검토",
    "en": "Second review",
    "aliases": [
      "Countersign",
      "IC 연서",
      "연서",
      "두 번째 검토자 확인",
      "두 번째 검토자",
      "countersign",
      "카운터사인"
    ],
    "definition_ko": "법인·그룹 투자심의위원회 GO를 기록한 사람이 아닌 다른 검토자가 그 GO의 효력을 정하는 절차. 해당 투자심의 검토자 권한을 가진 다른 사용자가 승인·조건부 승인·반려·재상정을 위해 돌려보냄 중 하나를 사유와 함께 기록한다. 이 전까지 GO는 '두 번째 검토자 확인 대기' 상태다.",
    "why_it_matters_ko": "확인 대기 중인 GO는 GO로 세지 않는다 — 다음 게이트 진입과 S11 진행이 모두 막힌다. 같은 사람이 기록과 검토를 모두 하려 하면 거절된다(403 checker_must_differ). 조건부 승인에는 조건을 한 가지 이상 붙여야 한다. AI 에이전트는 이 권한을 가질 수 없다(경계",
    "category": "business",
    "source": "ADR-0186 D6; neb-policy 2.9",
    "related": [
      "Maker Checker Separation",
      "Condition Precedent",
      "Entity IC",
      "Group IC",
      "Reconfirmation Requirement"
    ],
    "used_in": [
      "two-tier-approval-chain",
      "stage-gate-governance"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Maker Checker Separation",
    "ko": "기록자·확인자 분리",
    "en": "Maker/Checker Separation",
    "aliases": [
      "maker/checker",
      "maker-checker",
      "기록자와 확인자 분리",
      "작성자·승인자 분리"
    ],
    "definition_ko": "같은 사람이 결정을 기록하고 그 결정을 확인하지 못하게 나누는 원칙. 투자심의 GO는 기록한 사람(기록자)과 다른 사람(확인자)이 두 번째 검토로 확인해야 효력이 생긴다. 재확인 요건을 해제하는 사람도 해당 프로젝트의 투자심의 결정을 기록한 사람일 수 없다.",
    "why_it_matters_ko": "이 분리 이전에는 한 사용자가 모든 투자심의 결정을 혼자 기록해도 막을 방법이 없었다(2026-10-26 점검 지적 C1). 강제를 켜려면 해당 역할의 검토자 권한 보유자가 2명 이상이어야 한다.",
    "category": "business",
    "source": "ADR-0186 D6 and owner decision O-1",
    "related": [
      "Countersign",
      "Reconfirmation Requirement",
      "Entity IC",
      "Group IC"
    ],
    "used_in": [
      "two-tier-approval-chain"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Divergence Reason",
    "ko": "AI 권고와 다른 결정 사유",
    "en": "Divergence Reason",
    "aliases": [
      "다른 결정 사유",
      "권고와 다른 이유",
      "divergence_reason",
      "divergence"
    ],
    "definition_ko": "게이트 브리프에서 AI가 권고한 결정(GO·HOLD·KILL)과 사람이 내린 결정이 다를 때 결정한 사람이 직접 적는 이유. 화면 질문은 'AI 권고와 결정이 다른 이유는 무엇입니까?'이다. AI 권고와 함께 결정 기록에 저장되며, 시스템이 사람의 결정을 바꾸는 일은 없다.",
    "why_it_matters_ko": "AI 권고와 다른 GO는 사유 없이 기록할 수 없다(422 divergence_reason_required). HOLD와 KILL은 막지 않고 기록한다. 브리프를 만들지 않았다면 권고는 '없음'으로 저장되고 사유는 요구하지 않는다. 사유의 실질은 기계적으로 검사한다(글자 수·토큰 수 등). 불일치 횟수는 거버넌스 지표와 S1·S2 기준 비율 환류에 쓰인다.",
    "category": "business",
    "source": "ADR-0186 D9 (M16), D2",
    "related": [
      "Gate Snapshot Acknowledgement",
      "Stage Gate",
      "Base Rate"
    ],
    "used_in": [
      "stage-gate-governance",
      "decision-record"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Gate Snapshot Acknowledgement",
    "ko": "결정 전 상태 확인",
    "en": "Gate Snapshot Acknowledgement",
    "aliases": [
      "게이트 스냅샷 확인",
      "스냅샷 확인",
      "스냅샷 확인 사유",
      "확인 사유",
      "snapshot acknowledgement",
      "acknowledgement",
      "확인할 항목"
    ],
    "definition_ko": "게이트 GO를 기록하기 전에 서버가 그 시점의 상태(중단 기준 결과, RAG 등급과 데이터 신뢰도 상한, 검증 완료 여부, WACC 확정 여부, 면제, AI 권고)를 계산해 해시와 함께 저장한 '스냅샷'을 보고, 결정하는 사람이 항목별로 사유를 적어 확인하는 절차. 결정 요청에는 스냅샷 해시와 확인 사유가 함께 실린다.",
    "why_it_matters_ko": "시스템이 GO를 대신 막거나 승인하지 않고, 충돌하는 사실을 넘어갈 수 없게 기록에 남긴다(경계",
    "category": "business",
    "source": "ADR-0186 D1, D2, D3",
    "related": [
      "Divergence Reason",
      "Kill Criteria",
      "WACC Confirmation",
      "Condition Precedent",
      "Overall Grade"
    ],
    "used_in": [
      "stage-gate-governance",
      "decision-record"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Condition Precedent",
    "ko": "투자심의 선행 조건",
    "en": "Conditions Precedent",
    "aliases": [
      "선행 조건",
      "선행조건",
      "열린 조건",
      "투자심의 선행 조건",
      "condition precedent",
      "CP",
      "condition_precedent"
    ],
    "definition_ko": "투자심의 GO나 두 번째 검토에 붙은, 추적하고 해소해야 하는 조건(조건 내용, 해소 시점, 담당 역할, 상태). 해소 시점은 '그룹 투자심의위원회 개최 전', '설립 완료 전', '거래 종결 전' 중 하나이며 상태는 열림·해소·철회다. 기록한 사람이나 조건을 만든 사람이 아닌 다른 검토자가 해소하고, 닫을 때는 근거를 남긴다.",
    "why_it_matters_ko": "열린 조건이 있으면 S11을 끝낼 수 없고 그룹 투자심의위원회 GO도 기록할 수 없다. 실제로 브라운필드 한 건이 DD HOLD 뒤에 추적 가능한 조건 없이 법인·그룹 GO를 받은 일이 이 장치의 계기였다. 한번 기록한 조건 행은 고치지 않는다.",
    "category": "business",
    "source": "ADR-0186 D4; neb-policy 2.10",
    "related": [
      "Countersign",
      "Gate Snapshot Acknowledgement",
      "Entity IC",
      "Group IC",
      "Reconfirmation Requirement"
    ],
    "used_in": [
      "stage-gate-governance",
      "two-tier-approval-chain"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Reconfirmation Requirement",
    "ko": "재확인 요건",
    "en": "Reconfirmation Requirement",
    "aliases": [
      "재확인 요구",
      "재확인 필요",
      "재확인 요건 해제",
      "reconfirmation requirement",
      "reconfirmation_required"
    ],
    "definition_ko": "이전 게이트 규칙으로 기록된 프로젝트가 새로 쓰이기 전에 사람이 다시 확인해야 하는 항목 묶음(예 — WACC·허들 확정, 투자심의 GO의 두 번째 검토, 필수 DD 항목 '해당 없음'의 두 번째 확인). 열려 있는 동안은 새 GO 기록과 사업성 케이스 채택이 거절된다(409 reconfirmation_required). 해제는 모든 항목이 충족됐을 때 투자심의 검토자 권한 보유자가 사유와 함께 한다.",
    "why_it_matters_ko": "규칙이 강화되기 전의 기록을 그대로 쓰면 새 규칙의 취지가 무너진다. HOLD와 KILL은 막지 않고, 두 번째 검토만 남았다면 투자심의 GO는 허용한다. 해제하는 사람은 그 프로젝트의 투자심의 결정을 기록한 사람이 아니어야 한다. S11 기준선 변경 때 뜨는 '재확정 필요'와는 다른 장치다.",
    "category": "business",
    "source": "ADR-0186 P5 (migration 0179); docs/runbooks/prj-dse4pw-reconfirmation.md",
    "related": [
      "Countersign",
      "Maker Checker Separation",
      "WACC Confirmation",
      "Condition Precedent"
    ],
    "used_in": [
      "stage-gate-governance",
      "compliance-monitoring"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "WACC",
    "ko": "가중평균자본비용",
    "en": "Weighted Average Cost of Capital",
    "definition_ko": "부채와 자본의 조달비용을 가중평균한 할인율.",
    "why_it_matters_ko": "직접 입력(user)과 CAPM 구성요소 입력(ADR-0115) 두 모드를 지원한다. CAPM 모드는 시장 통용 수치(AlphaSpread, 한국은행 ECOS 등)를 출처·기준일과 함께 인용(live)하거나, 인용값이 없으면 산식(Rf + β×ERP, 신용등급 가산금리)으로 유도하며 베타는 시장 대비 변동성 추정(회귀 R²·연율화 변동성)을 동반한다. 구성요소는 wacc.* 가정 키로 저장되고 산식 분해(항목·산식·대입·결과)가 산출물에 함께 실린다.",
    "category": "financial",
    "related": [
      "WACC Input Session",
      "WACC Confirmation",
      "Hurdle IRR",
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
      "RAG",
      "Hurdle IRR"
    ],
    "used_in": [
      "investment-feasibility-modeling"
    ],
    "owner": "valuation-agent"
  },
  {
    "key": "DSCR",
    "ko": "원리금 상환 능력(DSCR)",
    "en": "Debt Service Coverage Ratio",
    "aliases": [
      "부채상환비율",
      "DSCR",
      "원리금 상환 능력",
      "원리금 상환 여력"
    ],
    "definition_ko": "영업현금흐름을 원리금 상환액(원금과 이자)으로 나눈 비율로, 1보다 클수록 갚을 여력이 있다는 뜻이다. 대출 약정 조건(커버넌트)의 기준 지표로 흔히 쓰인다. 화면에는 '원리금 상환 능력(DSCR)'으로 표기한다.",
    "why_it_matters_ko": "불황 시나리오에서 이 비율이 약정 기준을 밑돌면 기한이익상실로 이어져 유동성 위기가 된다 — 중단 기준(Kill Criteria) 후보다. 불황 시 값은 '불황 시 원리금 상환 능력' 항목에서 따로 본다.",
    "category": "financial",
    "related": [
      "Covenant",
      "Downside DSCR",
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
    "aliases": [
      "기준율",
      "기준 비율",
      "base_rate"
    ],
    "definition_ko": "과거·피어 사례의 실제 분포(하위 10%·중앙값·상위 10%)에 근거한 참조값. 값마다 출처, 확인한 날짜, 관리자, 근거 종류(내부 사후 평가·공개 연구·규제 통계·산업 데이터)를 반드시 함께 적어 두는 base_rate 표에서 가져온다(ADR-0187 D2). 출처 없는 행은 시스템이 받지 않는다.",
    "why_it_matters_ko": "예측 성장률이 과거·피어 분포 상위 10% 밖이면 자동 경고가 발동한다. 근거 없는 하키스틱 예측을 구조적으로 막는 장치다. 저장된 행이 없으면 기본값을 채우지 않고 '없음(not_available)'으로 답한다. 2026-10-28에 공개 연구 기반 첫 제안 파일(23행)이 만들어졌지만 담당자가 가져오기를 실행해야 데이터베이스에 들어간다. 값 이름이 _mean이면 평균, share_로 시작하면 비율이며 중앙값이 아니다.",
    "category": "financial",
    "source": "ADR-0187 D2; docs/architecture/base-rate-import-format.md",
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
    "ko": "비교 기업군",
    "en": "Peer Group",
    "aliases": [
      "피어 그룹",
      "피어",
      "비교 기업 집단"
    ],
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
    "ko": "ROIC 요인 분해도",
    "en": "ROIC Value Driver Tree",
    "aliases": [
      "ROIC 밸류 드라이버 트리",
      "밸류 드라이버 트리",
      "가치 동인 분해도"
    ],
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
    "ko": "대출 약정 조건(커버넌트)",
    "en": "Covenant",
    "aliases": [
      "재무약정",
      "커버넌트",
      "약정 조건",
      "재무 약정"
    ],
    "definition_ko": "대출 계약에 담긴 재무 조건으로, 지키지 못하면 대출 기관이 조기 상환을 요구할 수 있다(예 — 원리금 상환 능력(DSCR)을 일정 수준 이상 유지). 화면에는 '대출 약정 조건(커버넌트)'으로 표기한다.",
    "why_it_matters_ko": "경영권 변경(CoC) 조항에 의한 기한이익상실이 M&A에서 가장 위험한 조항 중 하나다 — 클로징 시 상환 소요로 계상해야 한다.",
    "category": "financial",
    "related": [
      "DSCR",
      "Downside DSCR",
      "Change of Control"
    ],
    "used_in": [
      "debt-and-contingent-liability-simulation"
    ],
    "owner": "valuation-agent"
  },
  {
    "key": "Golden Parachute",
    "ko": "경영권 변경 시 경영진 보상(골든 파라슈트)",
    "en": "Golden Parachute",
    "aliases": [
      "경영진 CoC 트리거 보상",
      "골든 파라슈트"
    ],
    "definition_ko": "경영권 변경(CoC) 시 경영진에게 즉시 지급되는 보상.",
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
    "key": "Hurdle IRR",
    "ko": "최소 요구 수익률(허들 IRR)",
    "en": "Hurdle IRR",
    "aliases": [
      "허들 IRR",
      "허들 수익률",
      "허들레이트",
      "hurdle_irr",
      "hurdle rate"
    ],
    "definition_ko": "투자안이 통과하려면 내부수익률(IRR)이 넘어야 하는 최소 기준 수익률. 사람이 WACC 입력 세션에서 WACC와 함께 확정한다. 비율로 입력하며 12%는 0.12이다(0과 1 사이만 받는다).",
    "why_it_matters_ko": "확정 전 기본값(0.10)으로 계산한 값은 '잠정 할인율' 표시를 달고 나온다. 확정되지 않으면 사업성(FS) GO를 기록할 수 없고, 브라운필드 '기준 시나리오에서 허들을 넘는 대상이 없음' 중단 기준도 평가하지 못한 상태로 남는다. WACC가 허들 IRR 이상이면 두 비율을 다시 확인하라는 경고가 뜬다.",
    "category": "financial",
    "source": "ADR-0186 D8; db/lib/wacc-confirmation.ts",
    "related": [
      "IRR",
      "WACC",
      "WACC Confirmation"
    ],
    "used_in": [
      "wacc-input-session",
      "investment-feasibility-modeling"
    ],
    "owner": "valuation-agent"
  },
  {
    "key": "WACC Confirmation",
    "ko": "할인율 확정(WACC 확인)",
    "en": "WACC Confirmation",
    "aliases": [
      "WACC 확인",
      "할인율 확정",
      "할인율 확정됨",
      "잠정 할인율",
      "provisional discount rate",
      "wacc_confirmed"
    ],
    "definition_ko": "사람이 WACC 입력 세션에서 WACC 적용 주체, WACC, 허들 IRR 세 가지를 모두 직접 입력해 확정한 상태. 선정 대상의 자체 세션이 있으면 그 세션, 없으면 프로젝트 세션을 보며, 가장 최근 기록이 판정한다. 확정 전에는 할인율에 따라 달라지는 모든 값에 '잠정 할인율' 표시가 붙는다.",
    "why_it_matters_ko": "확정 전에는 사업성(FS) GO를 기록할 수 없고(면제 경로 없음, 409 wacc_unconfirmed) S8도 끝낼 수 없다. 이후 게이트는 확정이 해제된 경우에만 막는다. HOLD와 KILL은 언제든 기록할 수 있다.",
    "category": "financial",
    "source": "ADR-0186 D8; neb-policy 2.2; checklist bf-02",
    "related": [
      "WACC",
      "Hurdle IRR",
      "Gate Snapshot Acknowledgement"
    ],
    "used_in": [
      "wacc-input-session",
      "stage-gate-governance"
    ],
    "owner": "quant-methodologist"
  },
  {
    "key": "Downside DSCR",
    "ko": "불황 시 원리금 상환 능력(하방 DSCR)",
    "en": "Downside DSCR",
    "aliases": [
      "하방 DSCR",
      "다운사이드 DSCR",
      "downside DSCR",
      "하방 상환 능력"
    ],
    "definition_ko": "채택한 S8 케이스의 불황(다운사이드) 현금흐름에 등록된 차입 조건(만기·상환 방식·금리)을 적용해 계산한 기간별 원리금 상환 능력(DSCR) 중 가장 낮은 값. 불황 케이스가 없으면 기준 케이스로 계산하고 그 사실을 안내한다. 한 함수가 S10 확인, 약정 조건 여유 화면, 투자심의 자료, 위험 히트맵, RAG 변수를 모두 같은 값으로 채운다.",
    "why_it_matters_ko": "S10은 이 값이 1.3배 미만이거나, 선언한 DSCR 약정 조건을 위반했거나, 필요한 차입 조건이 빠져 있으면(빠진 항목을 이름으로 알려 준다) 막힌다. 1.3배는 RAG 초록 조건과 맞춘 값으로 2026-10-29에 소유자가 1.2배에서 올렸다. 입력이 없으면 추정하지 않고 '근거 부족'으로 답한다. 순레버리지 같은 다른 약정은 재무상태표 입력이 없어 검증하지 않은 항목으로 나열한다.",
    "category": "financial",
    "source": "app/web-next/lib/covenant-dscr.ts (S10_MIN_DOWNSIDE_DSCR = 1.3); ADR-0187 D2",
    "related": [
      "DSCR",
      "Covenant",
      "Kill Criteria"
    ],
    "used_in": [
      "debt-and-contingent-liability-simulation",
      "financing-plan-review"
    ],
    "owner": "valuation-agent"
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
    "source": "OECD 조선작업부회(WP6)",
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
    "why_it_matters_ko": "전방·전전방 산업을 연결하는 축이자 기준정보(md_industry)의 기준 코드 체계다. 이게 없으면 프록시 체인 자체를 구성할 수 없다. 산업 검색에서는 코드나 공식 명칭 대신 조선, 2차전지, 반도체 같은 통용어로도 찾을 수 있다(별칭마다 근거를 붙인 목록 lib/ksic-aliases.json, 별칭으로 찾은 결과를 먼저 보여 준다).",
    "category": "industry",
    "aliases": [
      "KSIC 코드",
      "산업분류",
      "KSIC 별칭"
    ],
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
      "Red-Amber-Green",
      "RAG 종합 등급",
      "RAG 등급"
    ],
    "related": [
      "Reliability Grade",
      "Data Confidence U Grade",
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
    "why_it_matters_ko": "B등급이면 종합 등급이 최대 Amber로 캡되고, C등급이면 \"판단 보류\"로 표기된다. 2홉 프록시로 추정한 시장에 재무만 보고 Green을 줄 수 없다.",
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
    "ko": "등급 완충 규칙(히스테리시스)",
    "en": "Hysteresis",
    "aliases": [
      "히스테리시스",
      "승격·강등 임계 분리"
    ],
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
    "why_it_matters_ko": "이게 없으면 규정이 바뀐 날 아침 어제 Green이던 프로젝트가 이유 없이 Red가 된다. 그룹 투자심의위원회도 원칙적으로 이 pin된 버전으로 심의한다.",
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
    "ko": "참조·덮어쓰기 방식",
    "en": "References + Override Model",
    "aliases": [
      "참조·오버라이드 모델",
      "참조 오버라이드"
    ],
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
    "ko": "데이터 기한 점검",
    "en": "Staleness Gate",
    "aliases": [
      "신선도 게이트",
      "기한 점검"
    ],
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
  },
  {
    "key": "Data Confidence U Grade",
    "ko": "데이터 신뢰도 U 등급(미확인)",
    "en": "Data Confidence U Grade",
    "aliases": [
      "U 등급",
      "신뢰도 U",
      "데이터 신뢰도 U",
      "미확인 등급",
      "grade U",
      "unknown grade"
    ],
    "definition_ko": "시장 규모 산정에서 그 산업에 기록된 프록시 체인이 없고 출처도 직접 데이터(frozen-research)가 아닐 때 붙는 '알 수 없음(unknown)' 등급. A·B·C처럼 측정한 약한 근거가 아니라 근거를 아직 모른다는 뜻이다.",
    "why_it_matters_ko": "예전에는 이런 경우 기본값 B가 붙어 근거 없는 숫자가 중간 등급으로 보였다. 이제 U는 종합 등급(RAG)을 최대 Amber로 묶고 Green이 될 수 없게 한다(경계",
    "category": "technical",
    "source": "ADR-0187 D1; db/migrations/0180_data_confidence_unknown_grade.sql",
    "related": [
      "Reliability Grade",
      "Proxy Chain",
      "RAG Dimension",
      "Overall Grade"
    ],
    "used_in": [
      "rag-scoring-framework",
      "proxy-industry-chain"
    ],
    "owner": "process-governance-manager"
  },
  {
    "key": "Cross-Validation Matrix",
    "ko": "교차 검토 배정표(교차검증 매트릭스)",
    "en": "Cross-Validation Matrix",
    "aliases": [
      "교차검증 매트릭스",
      "교차 검토 매트릭스",
      "리뷰 매트릭스",
      "review matrix"
    ],
    "definition_ko": "산출물 종류와 작성 영역(기능·기술·산업·지역)마다 AI 2차 검토를 누가 맡는지 정해 둔 표. 작성자와 다른 영역의 검토자만 2차 검토로 인정한다. 같은 영역이거나 표에 없으면 기본 검토자로 넘기고 '대체 검토자 사용(fallback_used)'으로 표시한다.",
    "why_it_matters_ko": "AI가 AI 결과를 검토하면 같은 맹점을 공유해 오류가 함께 통과한다. 검토자 선정을 코드가 아닌 한 파일(process/cross-validation-matrix.yaml)에 두어 누락과 어긋남을 검사로 잡는다. 이 표는 검토 담당만 정하며, 사람 검토 화면(확인함·확인 못 함·판단 필요)과 게이트 승인은 그대로다. 브라운필드 필수 교차검증 6종이나 기업 공시 교차검증과는 다른 개념이다.",
    "category": "technical",
    "source": "process/cross-validation-matrix.yaml v1.1.0; ADR-0187 D3, D3'",
    "related": [
      "Stage Gate",
      "Entity IC"
    ],
    "used_in": [
      "stage-gate-governance"
    ],
    "owner": "process-governance-manager"
  }
];
