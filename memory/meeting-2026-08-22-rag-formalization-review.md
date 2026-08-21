# 미팅 — RAG 형식화·분류 축 재설계 검토 (2026-08-22)

## 아젠다 및 목적

Stage 5까지 빌드가 끝난 "판단체계 형식화·분류 축 재설계·워크플로우 공백 보완" 계획을 6개 관점에서 레드팀 검토한다. 검토 축은 다음 5가지로 고정한다:

1. 어디서 실행이 깨지는가 (구현 불가능한 전제)
2. 무엇을 하겠다고 주장하지만 실제로는 못 하는가
3. 무엇이 빠졌는가 (누락)
4. 순서가 잘못된 곳은 어디인가 (시퀀싱 오류)
5. 거버넌스 위반이 있는가

세션 구성: risk-officer(레드팀 단독), process-governance-manager + compliance-officer(거버넌스, 공동), data-architect + platform-lead(스키마/시퀀싱, 공동), market-intelligence-agent + quant-methodologist(시장 차원, 공동), brownfield-agent + greenfield-agent(분류실무, 공동), legal-counsel(법무/인증 경계, 단독). 참여자 총 6개 관점 그룹.

원안의 핵심 주장 — PR-5b가 `origin='internal'` 분류로 6대 검증자를 안전하게 스킵시킬 수 있다는 것 — 이 검토의 1차 표적이었다.

---

## 관점별 발언

### 1. risk-officer (레드팀)

- **F2 (치명)**: `md_project`에 stage 컬럼이 없어 "Screening 시점 동결"을 코드가 판정할 수 없다. 분류 스킵 로직의 시점 전제 자체가 스키마에 존재하지 않는다.
- **F3 (치명)**: DD 종료 교차검증(`origin` vs `dd_finding.rbd_source`)은 정작 잡아야 할 사례에서 눈이 먼다 — `origin=internal`로 잘못 분류돼 R&BD 단계가 스킵되면 애초에 `rbd_source` 행이 생기지 않아 비교 대상이 없다.
- **F6**: PR-5c(완결성 점검)는 오늘 프로덕션 호출자가 0건이라 "기존 통제를 분류인지로 만드는" 것이 아니라 "통제를 만들면서 동시에 분류인지로 만드는" 상황 — 초회 실행부터 정확해야 하는 잔여 최고위험.
- **F7**: kill-criteria의 "선언 N / 실행가능 M" 비율을 rationale 문자열에만 묻으면 회귀를 못 잡는다. `_validate.ts --strict`가 기준선 대비 하락 시 실패하도록 게이트화해야 하고 `audit.ts` 출력에도 노출해야 한다.
- **F8**: risk var에 파트너 소싱 실패(`partner_candidate.status`+`dependency_risk`, ADR-0031)가 빠져 있다 — risk-officer 자신의 3대 킬트리거 중 하나가 원안에서 완전히 누락됐다.
- **F10**: `PRAGMA foreign_keys=ON`이 부팅 경로에서 실제로 걸리는지 확인되지 않았다.
- **F11**: `_validate.ts`의 참조 무결성 경고가 VERBOSE 없이는 침묵한다 — 항상 출력돼야 한다.

### 2. process-governance-manager + compliance-officer (거버넌스, 공동)

- **거버넌스 #2 (치명)**: `compliance_check.result`에 `not_applicable` 값이 없어, 분류로 스킵된 검증자가 `result='pass'`("충족함")로 기록된다 — 감사기록에 거짓 진술이 남는다.
- **거버넌스 #8**: `project_policy_pin` 백필이 원안에서 누락됐다 — 기존 파일럿 011-014 포함 전 프로젝트가 무분류로 하드블록되는 상황을 막아야 한다.
- **거버넌스 #13**: `case_subtype` 로직이 `skills/`+`.claude/`+`.gemini/`+`.agents/` 4개 미러 사본에 존재하는데 원안은 정본만 다뤘다 — 전부 소탕 필요.
- **분류 쓰기 권한 비대칭 합의 (라운드1)**: `origin='external'`(검증자 세트를 늘리기만 함)은 단독 작성 가능·rationale 필수. `origin ∈ {internal, hybrid, joint}`(검증자 세트를 줄임)는 2자 승인 필수 — waiver와 최소 동급의 비용을 요구.
- **최대 이견 제기 (PGM)**: D-M3-1~4가 비보정 상태로 실사용된 선례가 있다 — 문서화만으로는 통제가 안 된다는 근거로 제시.
- **compliance-officer 반박 및 대안 제시**: 그 선례의 진짜 통제는 문서화가 아니라 "인간이 매 등급을 직접 확인하는 절차 자체"였다. 미검증 market/technical/risk 규칙은 `enabled=1`이어도 Amber·Red만 낼 수 있고 Green을 낼 수 없게 하자는 안(Green 상한/Amber 캡)을 제안. ADR-0016의 overall 규칙이 이미 "6개 전부 Green이어야 Green"을 요구하므로 세 차원에 Amber 상한을 거는 비용은 사실상 0이라는 근거.

### 3. data-architect + platform-lead (스키마/시퀀싱, 공동)

- **F-17a (치명)**: `condition_expr` 참조 var 결측 시 "평탄하게 UNASSESSED로 떨어뜨린다"는 원안 규칙은 틀렸다 — Kleene 3치 논리가 필요하다(`any_of(TRUE,UNASSESSED)=TRUE`, `at_least(k=2,[TRUE,TRUE,UNASSESSED])=TRUE`, `all_of(FALSE,UNASSESSED)=FALSE`, `none_of`는 대칭). 관대한 방향으로 틀리면 계획이 막으려던 거짓 통과가 재현되고, 보수적 방향으로 틀리면 기능이 영구히 죽는다.
- **F-2**: `rag_rule`은 0행·0독자 — 가산 마이그레이션이 아니라 DROP+CREATE로 재정의해야 하는 마지막 안전한 창구.
- **F-17b**: `renderKo`는 거버넌스 산출물(리뷰어 서명 대상)이라 조사(은/는·이/가·을/를·와/과) 선택과 부정 스코프까지 요구된다 — 6연산자×6단위×N변수 조합, PR-1 산정을 3배로 재평가해야 한다.
- **F-6**: 증거 레지스트리 "리팩터 문제를 해결한다"는 원안 주장은 절반만 참 — 물리 컬럼 개명은 해결되지만 레지스트리 키 자체의 개명은 모든 규칙 파일·`applies_when`·`dimension_input` 행을 건드리며 SQL로 참조 규칙을 답할 수 없다.
- **F-7/F-8/F-9**: 동적 쿼리(`{kind:"column", table, column, aggregate:"latest"}`) 설계는 세 가지로 깨진다 — (a) 절반 이상 테이블에 타임스탬프가 없어 "latest" 미정의, (b) 문자열 보간 식별자 인젝션 표면, (c) 평가당 var마다 쿼리 1회로 N+1 배가. 런당 1회 채워지는 스냅샷 테이블(`project_variable_snapshot`)로 대체 제안.
- **F-15/F-16 (compliance-officer #12 공동 인용)**: `dimension_input`의 `project_id TEXT PRIMARY KEY` 단일행 설계는 분류 이력을 삭제한다 — 거짓 skip을 잡아야 할 바로 그 감사흔적이 없어진다. `run_id` 부재로 재현 불가.
- **F-18**: `financialBand()`의 IEEE-754 보정을 범용 `cmp` 술어가 재현 못 하면 패리티 테스트가 경계값에서 확정적으로 실패한다 — `financial`/`regulatory_permit`은 미러 행 시딩 보류.
- **F-12**: `zod`가 현재 전이의존으로만 걸려 있다 — 직접 의존성으로 승격 필요.
- **F-3/F-4**: floating-point 금액(`REAL`) 위반이 저장소 전역에 이미 있고 `dimension_input.value_num`도 상속 — 이번 범위에서 전체 시정은 안 하되 부채로 ADR 기록. `db:export --dialect postgres`는 존재하지 않는다 — 이식성 주장 전부 미검증.
- **F-14**: `dimension_input`+`project_case_classification` 스키마(PR-4)는 그 형태를 증명하는 라우팅 코드(PR-5)와 같은 릴리스 창구로 묶여야 한다.

### 4. market-intelligence-agent + quant-methodologist (시장 차원, 공동)

- **시장차원 #4 (치명)**: `value_chain_link.concentration_hhi`를 "경쟁강도"에 매핑한 것은 틀렸다 — 이 지표는 상하방 교섭력(전후방 산업 집중도) 지표이지 수평적 경쟁강도가 아니다. 서로 반대 방향을 가리킬 수 있어 조용히 오판정을 만든다. `market.bargaining_power_hhi`(교섭력)와 신규 var `market.competitive_intensity`(경쟁강도)로 분리해야 한다.
- **시장차원 #5**: right-to-win을 단일 판단으로 두지 말고 `customer_overlap`/`tech_overlap`/`brand_transferability` 3개 var로 분해해야 한다 — 스키마 비용 0.
- **저신뢰 배제 누락**: `value_chain_link` 기반 var는 `r2 < 0.6`일 때 `gradeChain()`과 동일 기준으로 저신뢰 배제돼야 하는데 현재 부재 — 결측과 저신뢰를 구분 못 한다.
- **게이트별 축소 판정 필요**: Screening(TAM/성장률만, market Amber 상한), Pre-FS(TAM/성장률 출처화), DD(전체 6축 활성화, Amber 상한 해제) — `docs/rag-framework.md`에 산문 자체가 없다는 점을 지적, PR-6 착수 전 문서 선반영 요구.

### 5. brownfield-agent + greenfield-agent (분류실무, 공동)

- **분류실무 #2 (치명)**: HHI/독과점 게이팅이 `origin`을 기준으로 스위치되면 카브아웃 사업부가 이미 외부 시장에서 경쟁 중인지와 무관하게 꺼진다. 사실 기반 var(`target.has_external_market_presence`)로 대체해야 하며, `origin`과는 직교여야 한다.
- **분류실무 (뒤집힘5, 치명)**: `origin` 3값에 진짜 양자 JV가 들어갈 자리가 없다 — 대등 출자·공동 지배의 순수 JV는 `internal`도 `external`도 아니고 원안의 `hybrid`(수동적 소수지분 투자)에도 맞지 않는다. 지배구조가 반대인 두 딜이 같은 버킷에 섞인다 — `joint` 4번째 값 신설 필요.
- **뒤집힘6 (치명)**: PR-5a의 HHI 게이팅 설계 자체가 틀렸다 — `origin=internal`로 독과점 심사를 끄면, 이미 경쟁 중인 사업부가 분사돼 새 파트너와 결합할 때 독과점 노출이 오히려 커질 수 있는데도 게이트가 꺼진다. "조용한 거짓 skip"이 완화책이 아니라 게이팅 설계 그 자체에 내장돼 있었다.
- **#5**: DD 교차검증 결과를 상시-차단으로 두면 안 된다. 최초 분류에 rationale/evidence_ref가 부실했던 경우만 차단하고, 근거 있는 최초 분류가 DD에서 정직하게 뒤집힌 경우는 비차단 수정(재분류+스킵됐던 단계 재실행 트리거)으로 처리해야 한다 — DD가 가설을 검증하다 틀렸다고 밝히는 것은 위반이 아니라 정상 작동.
- **#4**: 셀 9/10(순수 사내벤처) 및 내부기원 법인설립 단계의 실제 절차 콘텐츠가 신규 도메인이라 이번 미팅에서는 첫 단추만 제시 — PR-10 착수 시 별도 미팅 권장.
- **#6c**: kill-criteria 레지스트리에도 `rag_rule`과 동일한 `enabled=0`/`governance_doc` 반조작 게이트를 적용해야 한다 — 원안은 이 비대칭을 놓쳤다.

### 6. legal-counsel (법무/인증 경계)

- **뒤집힘7 (높음)**: `transferability_basis='inferred'`를 kill-criterion(게이트 시점, `enabled=1` 필요)으로만 막으면, write 시점부터 게이트 평가 시점 사이에 추론값이 그대로 유통된다. 비협상 경계 #5("추론 금지")는 지연 허용 규칙이 아니다 — 레포지토리 레이어에서 write 시점 하드 차단 필요.
- **법무 #1/#6**: brownfield-dd 9단계의 skill_key를 `certification-transferability`로, 해당 SKILL.md owner를 `legal-counsel`로 이관해야 한다 — "사용자 결정" 사안이 아니라 "확정 결함"으로 재분류.
- **법무 #4**: 내부기원 프로젝트의 법인설립·IP양도·TUPE 단계가 워크플로우에 부재.
- **법무 #5**: kill-criteria의 override 제거-금지 규칙에 "법적으로 부적용" 예외 경로가 필요하다 — 삭제가 아니라 상위 리전규정의 supersession 기록으로.
- **법무 #6 (거버넌스 겹침)**: MNPI/insider-list가 `dimension_input`·`deal_structure_hypothesis`의 신규 쓰기 경로에 걸리는지 확인되지 않았다.
- **확인 사항**: `legal-counsel`이 어떤 절차에서도 디스패치되지 않는다는 사실을 확인. `certification-transferability` 스킬 owner가 `certification-agent`인데 `legal-counsel.md`는 이 판단을 자신의 책임이라 명시 — 두 에이전트 파일의 모순 지적.

### 교차 관점 수렴 (4개 독립 관점)

risk-officer·compliance-officer·process-governance-manager·brownfield-agent가 **각자 독립적으로** 동일한 결론에 도달했다: `project_case_classification`이 `origin='internal'`이면 6대 검증자를 통째로 스킵시키는데, 이 테이블은 `waiver`(승인자·만료일·이력·철회 전부 보유)와 비교해 작성자 하나 외엔 아무 통제가 없다. UPDATE 한 줄이 waiver 없이 waiver와 같은 효과를 낸다. 6대 검증자는 ADR-0037로 명시적 no-waiver 대상이므로, waiver보다 헐거운 우회로가 waiver 금지 규칙 옆에 생기는 셈 — 이 수렴이 뒤집힘1(치명)의 근거가 됐다.

---

## 종합 — 원안에서 뒤집힌 7건

| # | 심각도 | 내용 | 제기 관점 |
|---|---|---|---|
| 1 | 치명 (4개 관점 독립 수렴) | 분류(`origin='internal'`)가 waiver보다 약한 waiver 역할을 한다 — 6대 검증자를 통제 없이 스킵시킨다 | risk-officer, compliance-officer, PGM, brownfield-agent |
| 2 | 치명 | `enabled=0` 반조작 장치가 실제로 없었다 — `governance_doc`에 쓰기 통제 없음, DB 기본값이 오히려 1 | data-architect/platform-lead |
| 3 | 높음 | PR-4의 "정직한 unassessed"가 실제로는 안전 회귀 — `rankGroupAgenda`가 null을 non-Red로 취급, UI는 스테일한 확신 등급을 보여줌 | (스키마 검증 교차) |
| 4 | 치명 | `concentration_hhi`를 경쟁강도에 매핑한 것이 오매핑 | market-intelligence-agent/quant-methodologist |
| 5 | 치명 | `origin` 3값에 진짜 양자 JV가 들어갈 자리가 없다 | brownfield-agent/greenfield-agent |
| 6 | 치명 | PR-5a의 HHI 게이팅 설계 자체가 틀렸다 | brownfield-agent/greenfield-agent |
| 7 | 높음 | 인증 이전가능성 방어가 kill-criterion만으로는 write~게이트 사이 공백을 못 막는다 | legal-counsel |

이 7건은 각각 계획의 결정 5(전면 재설계), 결정 1 DDL, PR-4 필수 편입, 결정 6, 결정 5b(4값 origin), 결정 5e(사실기반 게이팅), PR-3(write 시점 하드 차단)으로 대응됐다.

---

## 이견 및 해소

### 1. 분류-쓰기 승인 대칭성 (거버넌스 라운드1)

**쟁점**: 모든 분류 변경에 동일한 승인 절차를 요구할 것인가, 아니면 검증자 세트를 늘리는 변경과 줄이는 변경을 다르게 취급할 것인가.

**해소**: 비대칭 채택. `origin='external'`(검증자 세트 확대)은 단독 작성+rationale 필수. `origin ∈ {internal, hybrid, joint}`(검증자 세트 축소)는 2자 승인(`approver_role`+`approved_by`+`approved_at`) 필수 — waiver와 최소 동급 비용을 물린다.

### 2. 미검증 threshold의 Green 상한 (거버넌스 라운드1, 최대 이견)

**쟁점**: process-governance-manager는 D-M3-1~4가 비보정 상태로 실사용된 선례를 들어 문서화(등록 절차)만으로는 안전하지 않다고 주장. compliance-officer는 그 선례에서 실제로 작동한 통제는 문서화가 아니라 "인간이 매 등급을 직접 확인하는 절차 자체"였다고 반박하며, 캘리브레이션 완료 전까지 미검증 market/technical/risk 규칙이 Green을 낼 수 없도록 Amber 상한(캡)을 걸자고 제안.

**해소 — 사용자 결정으로 확정**: compliance-officer의 제안이 채택됐다. 미검증 market/technical/risk 규칙은 `enabled=1`로 전환된 이후에도 캘리브레이션(과거 5-10건 재현) 완료 전까지 Amber·Red만 낼 수 있고 Green을 낼 수 없다. 근거: ADR-0016의 overall 규칙이 이미 "6개 전부 Green이어야 Green"을 요구하므로 세 차원에 Amber 상한을 거는 비용은 사실상 0이며 유용한 Red 신호는 그대로 살아있다.

---

## 액션 아이템

| 액션 | 근거 결정 |
|---|---|
| Stage 0.1 정식 설계 문서 작성 (`docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md`) | 미팅 종합 전체, ADR-0032 문서 우선 원칙 |
| Stage 0.2 이 미팅 전사를 표준 형식으로 기록 | 본 문서 |
| Stage 0.3 ADR 초안 5건(0046-0050) 작성 | 결정 1/2(0046), 결정 5b(0047), 뒤집힘1(0048, ADR-0037 개정), PR-4(0049, ADR-0016 개정), ADR-0045 errata(0050) |
| Stage 0.4 `docs/rag-framework.md` market 게이트별 축소판정 서브섹션 선반영 | 결정 6 |
| Stage 0.5 미검증 threshold 3건 미팅 아젠다 초안(`docs/decisions/open/`) | 결정 9 반조작 스테이징 3단 |
| PR-0 발견(`_validate.ts` 참조 무결성, `graph-map.ts`, FK 부팅경로 확인) | risk-officer F10/F11 |
| PR-1 술어 엔진(3치 논리표+`renderKo`+zod 직접 의존성) | 결정 1, F-17a, F-17b, F-12 |
| PR-2 마이그레이션(`certification` 5컬럼, `rag_rule` DROP+CREATE, `evidence_var`/`rag_rule_variable`) | 결정 1, 결정 2, F-2, F-6~F-9 |
| PR-3 kill-criteria + brownfield-dd 9단계 owner 이관 + `inferred` write 시점 하드 차단 | 결정 8, 법무 #1/#6, 뒤집힘7 |
| PR-4 분류 인프라(`dimension_input`+`project_case_classification`+`current_stage_gate`+`compliance_check.result` 확장) | 결정 3, 결정 5b/5c/5d, F-15/F-16, 거버넌스 #2 |
| PR-5 분류 라우팅 전체(5a→5b→5c 순, `project_policy_pin` 백필) | 결정 5 전체, 뒤집힘1/5/6, 거버넌스 #8 |
| PR-6 market 차원(매핑 정정+게이트별 축소판정+저신뢰 배제+right_to_win 3분해) | 결정 6, 시장차원 #4/#5 |
| PR-7 technical + risk(파트너소싱 포함) | 결정 8, risk-officer F8 |
| PR-8 스킬 그래프 경화(4개 미러 사본 소탕) | 거버넌스 #13 |
| PR-9 규칙 활성화(`enabled=1`+Green 상한 적용) | 결정 9 |
| PR-10 워크플로우 공백(Strategic Fit/Market DD/Legal DD/Financing/내부기원 법인설립·IP양도·TUPE/GF-internal 게이트) | 법무 #4, 분류실무 #4 |
| kill-criteria 레지스트리에 `enabled=0` 반조작 게이트 적용 | 분류실무 #6c |
| MNPI/insider-list 신규 쓰기 경로 확인 | 법무 #6, PR-4 범위 |

**사용자 확정 사항 2건**: (1) 결정 9(Green 상한) 채택 확정. (2) `case_subtype` 폐기 ADR 1건으로 통합, `project_policy_pin` 소급 처리를 그 ADR의 필수 섹션으로 강제.

**후속 미팅 필요 항목**: PR-10 착수 시 셀 9/10(순수 사내벤처) 및 내부기원 법인설립 단계 실제 절차 콘텐츠에 대한 별도 미팅.
