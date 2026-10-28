---
lang: ko
lang_reason: source-material
---

# Process Flow — 신규사업 검토 프로세스 (생성 문서)

> **⚠ 이 문서는 생성물입니다.** `process/flow.spec.yaml`(SSOT, ADR-0074)에서
> `bun scripts/co-newbiz/generate-process-flow.ts`로 생성됩니다. 이 파일을
> 직접 수정하지 마세요 — 수정은 사양에서, 본 문서는 참조용으로.
> 설계 철학·원칙·베스트 프랙티스는 `docs/design-system/design-guide.md`와 ADR-0074를 참고하세요.


## 프로세스 흐름 요약

S1 시장분석 → S2 기회 발굴 → S3 시너지·전략적 적합성 → S4 진출방식 결정 → S5 자체 진출 (greenfield 전용) → S6 대상 후보 발굴 (brownfield 전용) → S7 대상 선정 (brownfield 전용) → S8 사업성 분석 → S9 실사·검증 → S10 투자구조 설계 → S11 투자심사·실행 → S12 사후 관리

엔티티 라이프사이클:
- opportunity: S1 → S2 → S3 → S4 → S5 → S6 → S7
- project: S8 → S9 → S10 → S11 → S12

## 게이트 정의

### Screening (screening)
**판정 기준**
- 시장 매력도가 수용 기준 이상이다
- 전략적 적합성 knock-out 항목을 모두 통과했다
- 시너지 점수가 합의 기준을 충족한다

**Kill 기준**
- 시장이 구조적으로 매력이 없다(축소+상품화)
- 데이터 신뢰도가 판단 불가 수준이다
- 전략적 적합성 knock-out 실패

**자원 결정**: Screening 통과 시 Pre-FS 예산 트랜치 개시

### Pre-FS (pre_fs)
**판정 기준**
- 트랙(그린필드/브라운필드) 결정 근거가 기록되었다
- 트랙별 후속 검토 입력이 존재한다 (greenfield: 역량 평가, brownfield: Target Universe 정의)

**Kill 기준**
- 진출방식이 결정되지 않았다

**자원 결정**: FS 본격 검토 자원 배정

### Target Screening (target_screening)
**판정 기준**
- Target Company Short List가 존재한다
- 모든 Long List 후보에 랭킹 또는 제외 사유가 기록되었다
- Short List 후보가 knock-out 스크리닝을 통과했다

**Kill 기준**
- knock-out 통과 후보가 0건이다 (스크리닝 결과 진입 가능한 대상 없음)

**자원 결정**: Short List 대상 사업성 분석 자원 배정

### FS (fs)
**판정 기준**
- 정량화된 Business Case(NPV/IRR/BEP 또는 밸류에이션 범위)가 존재한다
- 사전 정의된 사업목표 기준(그룹/계열사 마스터데이터, ADR-0114) 충족 여부가 기본 시나리오 기준으로 확인되었다
- brownfield: 대상별 비교 분석과 사람의 대상 선정 기록(target_selection)이 존재한다

**Kill 기준**
- 기준 수익률 미달이 기본 시나리오에서 확인된다

**자원 결정**: DD 착수 자원 배정

### DD (dd)
**판정 기준**
- 필수 체크리스트 항목이 모두 충족/해당없음/예외 처리되었다
- 미해소 필수 미충족이 0건이다

**Kill 기준**
- waiver 불가능한 필수 항목 미충족 지속

**자원 결정**: 투자심의 자료 작성 자원 배정

### 법인 투자심의위원회 (entity_ic)
**판정 기준**
- 투자심의 자료가 완비되었다
- 사람 최종 승인 필수 산출물의 reviewed_by가 기록되었다
- 게이트 스냅샷에 대한 확인이 사유와 함께 기록되었고, 다른 담당자(entity-ic-reviewer)의 countersign으로 GO가 유효해졌다

**Kill 기준**
- 필수 산출물 미승인

**자원 결정**: Entity 차원 투자 권고

### 그룹 투자심의위원회 (group_ic)
**판정 기준**
- 법인 투자심의위원회 승인이 선행되었다
- 그룹 관점 포트폴리오 적합성이 검토되었다
- 게이트 스냅샷에 대한 확인이 사유와 함께 기록되었고, 다른 담당자(group-ic-reviewer)의 countersign으로 GO가 유효해졌으며, 그룹 IC 범위의 미해소 조건이 없다

**Kill 기준**
- 그룹 수준 반려

**자원 결정**: 최종 투자 집행

## 설계 원칙 및 에이전트 오케스트레이션

이 프로세스는 Agentic-first, Human-final 원칩으로 운영된다 — 에이전트가 스테이지를 실행·권고하고, 사람은 IC 승인과 예외 개입만 수행한다 (docs/design-system/design-guide.md, ADR-0074).

**스테이지별 담당 에이전트(오케스트레이터가 Activities의 agent 필드를 실행)**

- S1 시장분석: `market-intelligence-agent`
- S2 기회 발굴: `market-intelligence-agent`, `greenfield-agent`
- S3 시너지·전략적 적합성: `process-governance-manager`, `market-intelligence-agent`, `risk-officer`, `greenfield-agent`, `brownfield-agent`, `financial-analyst`
- S4 진출방식 결정: `pm`, `brownfield-agent`, `valuation-agent`, `certification-agent`, `legal-counsel`
- S5 자체 진출: `greenfield-agent`, `financial-analyst`
- S6 대상 후보 발굴: `brownfield-agent`, `market-intelligence-agent`
- S7 대상 선정: `brownfield-agent`, `antitrust-agent`
- S8 사업성 분석: `financial-analyst`, `valuation-agent`, `quant-methodologist`, `pm`
- S9 실사·검증: `commercial-dd-agent`, `technical-dd-agent`, `legal-counsel`, `financial-analyst`, `hr-integration-agent`, `market-intelligence-agent`, `financing-agent`, `compliance-officer`, `brownfield-agent`, `antitrust-agent`, `region-lead`, `customer-retention-agent`, `incentive-agent`, `valuation-agent`, `ip-agent`
- S10 투자구조 설계: `brownfield-agent`, `valuation-agent`
- S11 투자심사·실행: `pm`, `brownfield-agent`, `risk-officer`, `group-review-agent`, `process-governance-manager`, `pmi-agent`, `greenfield-agent`
- S12 사후 관리: `group-review-agent`, `pmi-agent`, `partnership-agent`

스킬·프로시저 대응은 각 스테이지의 Activities 표를, 전체 매핑 근거는 ADR-0074를 참고한다.

## 스테이지 상세

## S1 — 시장분석

**목표**: 어디에 기회가 있는가? — 시장 규모·성장·경쟁구조와 가치사슬을 파악한다

**입력**
- 외부 시장 데이터 (fact_market_observation)
- 산업 드라이버 레지스트리

**Activities**
- market-research · agent: `market-intelligence-agent` · skills: `market-data-pipeline`, `proxy-industry-chain`, `systematic-market-sizing`, `forward-industry-research` · procedure: `greenfield-screening`, `brownfield-screening`
- competitive-intelligence · agent: `market-intelligence-agent` · skills: `competitive-intelligence` · procedure: `greenfield-screening`, `brownfield-screening`
- value-chain-analysis · agent: `market-intelligence-agent` · skills: `value-chain-linkage-analysis`, `value-chain-stage-financials` · procedure: `greenfield-screening`, `brownfield-screening`

**필수 산출물**
- 시장 규모·성장 추정
- 경쟁 구조
- 가치사슬 구조

**완료 기준**
- 최소 1개의 정량화된 수요 추정(직접 또는 프록시 체인)이 존재한다
- 최신 완료 버전의 매트릭스에 경쟁 구조(집중도 요약·주요 플레이어)가 기록되었다
- 데이터 신뢰도 등급이 기록되었다

**엔진 차단 키** (필수 산출물·완료 기준 번호는 1부터)
- `s1.market_size_growth` — 산출물 1 · 완료 기준 1
- `s1.competitive_structure` — 산출물 2 · 완료 기준 2
- `s1.value_chain_structure` — 산출물 3
- `s1.data_confidence_grade` — 완료 기준 3

**적용 트랙**: greenfield, brownfield

### 게이트
### Gate: Screening (screening)

**판정 기준**
- 시장 매력도가 수용 기준 이상이다
- 전략적 적합성 knock-out 항목을 모두 통과했다
- 시너지 점수가 합의 기준을 충족한다

**Kill 기준**
- 시장이 구조적으로 매력이 없다(축소+상품화)
- 데이터 신뢰도가 판단 불가 수준이다
- 전략적 적합성 knock-out 실패

**자원 결정**: Screening 통과 시 Pre-FS 예산 트랜치 개시

## S2 — 기회 발굴

**목표**: 무엇을 할 것인가? — 가치사슬상 사업 기회를 등록·평가한다

**입력**
- 시장 규모·성장 추정 (S1)
- 가치사슬 구조 (S1)

**Activities**
- opportunity-discovery · agent: `market-intelligence-agent` · skills: `insight-synthesis` · procedure: `opportunity-discovery`, `greenfield-screening`, `brownfield-screening`
- business-model-sketch · agent: `greenfield-agent` · skills: `scenario-planning` · procedure: `opportunity-discovery`
- entry-market-sizing · agent: `market-intelligence-agent` · skills: `systematic-market-sizing` · procedure: `opportunity-discovery`, `greenfield-screening`, `brownfield-screening`

**필수 산출물**
- 기회 등록(가치사슬 노드·매력도)
- 진입시장 산정 (S1 링크·대상 범위·도출 사슬)

**완료 기준**
- 최소 1개 기회가 등록되고 매력도가 평가되었다
- 최소 1개 기회에 S1 시장규모 버전이 연결되고 대상 범위가 기록되었다 (ADR-0180 — 미연결 상태는 미연결로 정직 표시되며 게이트를 막지 않는다)

**엔진 차단 키** (필수 산출물·완료 기준 번호는 1부터)
- `s2.attractiveness_assessment` — 산출물 1 · 완료 기준 1
- `s2.entry_market` — 산출물 2 · 완료 기준 2

**적용 트랙**: greenfield, brownfield

### 게이트
### Gate: Screening (screening)

**판정 기준**
- 시장 매력도가 수용 기준 이상이다
- 전략적 적합성 knock-out 항목을 모두 통과했다
- 시너지 점수가 합의 기준을 충족한다

**Kill 기준**
- 시장이 구조적으로 매력이 없다(축소+상품화)
- 데이터 신뢰도가 판단 불가 수준이다
- 전략적 적합성 knock-out 실패

**자원 결정**: Screening 통과 시 Pre-FS 예산 트랜치 개시

## S3 — 시너지·전략적 적합성

**목표**: 우리가 해야 하는가? — 자사 역량과의 시너지를 평가한다

**입력**
- 후보 기회 (S2 기회 퍼널)
- 진입시장 산정 (S2 — 지역·세그먼트 도출 시장, ADR-0180; S3~S12가 대상으로 삼는 시장)
- 자사 역량·포트폴리오 정보 (그룹/계열사 분석 산출 — 그룹/계열사 프로파일)

**Activities**
- strategic-fit-screening · agent: `process-governance-manager` · skills: `strategic-fit-screening`, `portfolio-fit-assessment`, `brownfield-feasibility`, `antitrust-screening`, `site-infrastructure-assessment`, `regional-incentive-sourcing` · procedure: `greenfield-screening`, `brownfield-screening`
- synergy-analysis · agent: `market-intelligence-agent` · skills: `value-chain-linkage-analysis`, `investment-feasibility-modeling`, `historical-financial-analysis` · procedure: `greenfield-screening`, `brownfield-screening`
- synergy-red-team · agent: `risk-officer` · skills: `assumption-audit` · procedure: `greenfield-screening`, `brownfield-screening`
- capability-register-greenfield · agent: `greenfield-agent` · skills: `greenfield-feasibility` · procedure: `greenfield-screening`
- capability-register-brownfield · agent: `brownfield-agent` · skills: `brownfield-feasibility` · procedure: `brownfield-screening`
- our-company-profile · agent: `financial-analyst` · skills: `historical-financial-analysis`, `company-intelligence`, `competitive-intelligence` · procedure: `company-profile-analysis`

**필수 산출물**
- 시너지 평가
- 전략적 적합성 판단

**완료 기준**
- 기회에 synergy_score와 근거가 기록되었다
- 적합성 판단 근거(rationale)가 기록되고 결정론 권고(매력도·시너지 조합)가 제시되었다
- 최소 1개 기회가 selected 상태이다 (시너지·적합성 평가 후 선정)
- 필요 역량 등록부에 출처(source)가 기록된 역량이 1건 이상 존재한다 (capability-register 활동 — grandfathered 기회 제외)

**엔진 차단 키** (필수 산출물·완료 기준 번호는 1부터)
- `s3.synergy_assessment` — 산출물 1 · 완료 기준 1
- `s3.strategic_fit_judgement` — 산출물 2 · 완료 기준 2
- `s3.opportunity_selected` — 완료 기준 3
- `s3.capability_register` — 완료 기준 4

**적용 트랙**: greenfield, brownfield

### 게이트
### Gate: Screening (screening)

**판정 기준**
- 시장 매력도가 수용 기준 이상이다
- 전략적 적합성 knock-out 항목을 모두 통과했다
- 시너지 점수가 합의 기준을 충족한다

**Kill 기준**
- 시장이 구조적으로 매력이 없다(축소+상품화)
- 데이터 신뢰도가 판단 불가 수준이다
- 전략적 적합성 knock-out 실패

**자원 결정**: Screening 통과 시 Pre-FS 예산 트랜치 개시

## S4 — 진출방식 결정

**목표**: 어떻게 들어갈 것인가? — Greenfield(자체 역량 진출) vs Brownfield(기존 기업·자산 결합)를 결정한다. Brownfield ≠ M&A — M&A·JV·전략적 투자·소수점 지분·파트너십·R&BD·사내벤처(CVC) 중 Route를 고른다

**입력**
- 시너지·적합성 평가
- 역량 갭 분석 (S3 — 시장 요구사항 대비 그룹/계열사 보유 역량)
- 진입시장 성장률 (S2 확정 — ADR-0181; 라우트 어드바이저 성장 신호의 기준)
- 시장 규모·성장 추정 (S1)
- 경쟁 구조 (S1)
- 가치사슬 구조 (S1)

**Activities**
- route-strategy · agent: `pm` · skills: `deal-execution-playbook`, `jv-structuring`, `partner-sourcing-strategy`, `brownfield-feasibility`, `greenfield-feasibility`, `site-infrastructure-assessment`, `regional-incentive-sourcing`, `partner-due-diligence`, `partnership-health-scorecard`, `investment-vehicle-structuring` · procedure: `greenfield-pre-fs`, `brownfield-pre-fs`, `deal-shape-chain`
- deal-shape-evaluation · agent: `brownfield-agent` · skills: `deal-execution-playbook` · procedure: `brownfield-pre-fs`
- route-advisory · agent: `pm` · skills:  · procedure: `greenfield-pre-fs`, `brownfield-pre-fs`, `deal-shape-chain`
- wacc-hurdle-confirmation · agent: `valuation-agent` · skills: `wacc-input-session` · procedure: `greenfield-pre-fs`, `brownfield-pre-fs`
- certification-screen · agent: `certification-agent` · skills: `certification-roadmap`, `certification-transferability` · procedure: `greenfield-pre-fs`, `brownfield-pre-fs`
- regulatory-screening · agent: `legal-counsel` · skills: `regulatory-screening`, `permit-pathway-mapping`, `k-law` · procedure: `greenfield-screening`, `brownfield-screening`

**필수 산출물**
- 트랙 결정(GF/BF)·근거
- Brownfield 선택 시 Route 유형(M&A/JV/전략적 투자/소수점 지분/파트너십/R&BD/CVC)
- 5criteria 채점 결과(통제 필요도·역량 결정성·시장 불확실성·통합 역량·역량확보 속도 각 20%)
- 검토한 대안
- 법무·규제 스크리닝 판정 (chk-legal-regulatory lr-01~lr-07 — regulatory-screening 활동)

**완료 기준**
- route_decision 레코드가 존재한다 (track 필수; brownfield는 Route 유형(sub_track) 필수, greenfield의 sub_track은 선택)
- Brownfield인 경우 5criteria 채점 결과와 사전배제 점검이 기록되었다
- Greenfield인 경우에도 5criteria 채점 결과를 기록한다 (ADR-0104 — 트랙 간 비교 가능성)
- 법무·규제 스크리닝 판정(chk-legal-regulatory 필수 항목)이 사람에 의해 기록되었다 — 필수 항목은 pass 또는 사유가 있는 not_applicable이어야 하며 권장 항목은 차단하지 않는다 (ADR-0187 P3, 가족 legal_regulatory가 enforce일 때 차단)

**엔진 차단 키** (필수 산출물·완료 기준 번호는 1부터)
- `s4.route_decision` — 산출물 1 · 완료 기준 1
- `s4.brownfield_sub_track` — 산출물 2 · 완료 기준 1
- `s4.five_criteria_scores` — 산출물 3 · 완료 기준 2, 3
- `s4.alternatives_considered` — 산출물 4
- `s4.legal_regulatory_screening` — 산출물 5 · 완료 기준 4

**적용 트랙**: greenfield, brownfield

### 게이트
### Gate: Screening (screening)

**판정 기준**
- 시장 매력도가 수용 기준 이상이다
- 전략적 적합성 knock-out 항목을 모두 통과했다
- 시너지 점수가 합의 기준을 충족한다

**Kill 기준**
- 시장이 구조적으로 매력이 없다(축소+상품화)
- 데이터 신뢰도가 판단 불가 수준이다
- 전략적 적합성 knock-out 실패

**자원 결정**: Screening 통과 시 Pre-FS 예산 트랜치 개시

### Gate: Pre-FS (pre_fs)

**판정 기준**
- 트랙(그린필드/브라운필드) 결정 근거가 기록되었다
- 트랙별 후속 검토 입력이 존재한다 (greenfield: 역량 평가, brownfield: Target Universe 정의)

**Kill 기준**
- 진출방식이 결정되지 않았다

**자원 결정**: FS 본격 검토 자원 배정

## S5 — 자체 진출 (greenfield 전용)

**목표**: 스스로 진입할 수 있는가? — 자체 역량을 평가하고 격차를 구축 방안(Build/Partner/Hire/Invest)으로 해소해 진출전략을 세운다 (Greenfield 전용 — Target Company 객체가 존재하지 않는다)

**입력**
- 트랙 결정 (greenfield)
- 자사 역량·조직·인프라 정보
- 필요 역량 목록 (S3 적합성 평가에서 도출)
- 진입시장 산정 (S2 확정 — ADR-0181; S3~S12의 기준 시장, ADR-0187 M9)

**Activities**
- capability-assessment · agent: `greenfield-agent` · skills: `greenfield-feasibility`, `org-readiness-assessment` · procedure: `greenfield-capability-assessment`
- entry-strategy · agent: `greenfield-agent` · skills: `scenario-planning`, `talent-pipeline-planning` · procedure: `greenfield-capability-assessment`
- business-case-lines · agent: `financial-analyst` · skills: `investment-feasibility-modeling` · procedure: `greenfield-capability-assessment`

**필수 산출물**
- 역량 격차 평가
- 진출전략(Build/Partner/Hire/Invest 결정·근거)
- 그린필드 실현가능성 체크리스트 판정 (chk-greenfield-feasibility gf-01~gf-12)
- 부지 선정 체크리스트 판정 (chk-site-selection ss-01~ss-09)

**완료 기준**
- 필요 역량 대비 보유 역량 격차와 해소 방안이 기록되었다
- 진출전략이 결정되고 검토한 대안이 기록되었다
- 그린필드 실현가능성 체크리스트(chk-greenfield-feasibility)의 필수 항목이 사람에 의해 판정되었다 (ADR-0187 P3, 가족 checklist_consumers가 enforce일 때 차단)
- 부지 선정 체크리스트(chk-site-selection)의 필수 항목이 사람에 의해 판정되었다 — 기존 부지 증설은 사유가 있는 not_applicable로 기록한다 (ADR-0187 P3, 가족 checklist_consumers가 enforce일 때 차단)

**엔진 차단 키** (필수 산출물·완료 기준 번호는 1부터)
- `s5.capability_gap_register` — 완료 기준 1
- `s5.capability_assessment` — 산출물 1 · 완료 기준 1
- `s5.entry_strategy` — 산출물 2 · 완료 기준 2
- `s5.alternatives_considered` — 완료 기준 2
- `s5.greenfield_feasibility_checklist` — 산출물 3 · 완료 기준 3
- `s5.site_selection_checklist` — 산출물 4 · 완료 기준 4

**적용 트랙**: greenfield

### 게이트
### Gate: Pre-FS (pre_fs)

**판정 기준**
- 트랙(그린필드/브라운필드) 결정 근거가 기록되었다
- 트랙별 후속 검토 입력이 존재한다 (greenfield: 역량 평가, brownfield: Target Universe 정의)

**Kill 기준**
- 진출방식이 결정되지 않았다

**자원 결정**: FS 본격 검토 자원 배정

## S6 — 대상 후보 발굴 (brownfield 전용)

**목표**: 누구와 결합할 것인가? — Opportunity에 진입 가능한 기존 기업·자산의 Target Universe를 정의하고 Target Company Long List를 작성한다 (Brownfield 전용)

**입력**
- 트랙 결정·Route 유형 (brownfield)
- 시장 정의·가치사슬 구조 (S1)
- 필요 역량·진입 조건 (S3)
- 진입시장 산정 (S2 확정 — ADR-0181; S3~S12의 기준 시장, ADR-0187 M9)

**Activities**
- target-universe-definition · agent: `brownfield-agent` · skills: `brownfield-feasibility`, `competitive-intelligence` · procedure: `brownfield-target-identification`
- target-longlist · agent: `market-intelligence-agent` · skills: `company-intelligence`, `brownfield-feasibility` · procedure: `brownfield-target-identification`

**필수 산출물**
- Target Universe 정의
- Target Company Long List

**완료 기준**
- 후보 Universe의 정의·선정 기준이 기록되었다
- 최소 커버리지 기준을 충족하는 Long List가 존재한다
- Long List 후보에 필수 속성과 출처/근거가 기록되었다

**엔진 차단 키** (필수 산출물·완료 기준 번호는 1부터)
- `s6.target_universe` — 산출물 1 · 완료 기준 1
- `s6.longlist_attributes` — 완료 기준 3
- `s6.longlist_coverage` — 산출물 2 · 완료 기준 2

**적용 트랙**: brownfield

### 게이트
### Gate: Pre-FS (pre_fs)

**판정 기준**
- 트랙(그린필드/브라운필드) 결정 근거가 기록되었다
- 트랙별 후속 검토 입력이 존재한다 (greenfield: 역량 평가, brownfield: Target Universe 정의)

**Kill 기준**
- 진출방식이 결정되지 않았다

**자원 결정**: FS 본격 검토 자원 배정

## S7 — 대상 선정 (brownfield 전용)

**목표**: 어떤 대상이 유망한가? — Long List를 전략·역량·재무·소유권·규제 기준으로 스크리닝해 Target Company Short List로 좁힌다 (Brownfield 전용 — CDD/TDD는 Short List 확정 후 S9에서 수행한다)

**입력**
- Target Company Long List (S6)
- 스크리닝 기준(전략적 적합성·역량 적합성·재무·지역·소유권/가용성·규제 제약)
- 진입시장 산정 (S2 확정 — ADR-0181; S3~S12의 기준 시장, ADR-0187 M9)

**Activities**
- target-screening · agent: `brownfield-agent` · skills: `brownfield-feasibility`, `strategic-fit-screening`, `peer-benchmarking` · procedure: `brownfield-target-screening`
- ownership-regulatory-screening · agent: `antitrust-agent` · skills: `antitrust-screening`, `regulatory-screening` · procedure: `brownfield-target-screening`
- target-ranking · agent: `brownfield-agent` · skills: `strategic-fit-screening`, `brownfield-feasibility`, `peer-benchmarking` · procedure: `brownfield-target-screening`

**필수 산출물**
- Target Company Short List
- Target Ranking/Score
- Exclusion Reasons

**완료 기준**
- 모든 Long List 후보에 랭킹 점수 또는 제외 사유가 기록되었다
- Short List 후보가 knock-out 스크리닝을 통과했다
- 스크리닝 근거(evidence)가 후보별로 기록되었다

**엔진 차단 키** (필수 산출물·완료 기준 번호는 1부터)
- `s7.candidate_screening` — 완료 기준 1
- `s7.candidate_verdict` — 산출물 2, 3 · 완료 기준 1
- `s7.candidate_evidence` — 완료 기준 3
- `s7.knockout_shortlist` — 산출물 1 · 완료 기준 2

**적용 트랙**: brownfield

### 게이트
### Gate: Target Screening (target_screening)

**판정 기준**
- Target Company Short List가 존재한다
- 모든 Long List 후보에 랭킹 또는 제외 사유가 기록되었다
- Short List 후보가 knock-out 스크리닝을 통과했다

**Kill 기준**
- knock-out 통과 후보가 0건이다 (스크리닝 결과 진입 가능한 대상 없음)

**자원 결정**: Short List 대상 사업성 분석 자원 배정

## S8 — 사업성 분석

**목표**: 돈이 되는가? — Greenfield는 진출전략 기반 Business Case, Brownfield는 Short List 대상별 밸류에이션을 정량화해 비교·선정한다

**입력**
- 트랙 결정
- 진출전략·Business Case 라인 (greenfield — S5)
- Short List 대상 재무 정보 (brownfield — S7, 대상별)
- 진입시장 산정 (S2 확정 — ADR-0181; 시장 앵커·성장률·환율 개산과 몬테카를로 환 리스크의 기준)

**Activities**
- business-case-modeling · agent: `financial-analyst` · skills: `growth-projection-modeling`, `investment-feasibility-modeling`, `target-costing-analysis`, `financial-statement-analysis`, `antitrust-screening`, `peer-benchmarking`, `quality-of-earnings`, `scenario-planning`, `value-chain-stage-financials`, `historical-financial-analysis`, `site-infrastructure-assessment` · procedure: `greenfield-fs`, `brownfield-fs`
- valuation · agent: `valuation-agent` · skills: `dd-to-valuation-bridge`, `monte-carlo-simulation`, `investment-vehicle-structuring` · procedure: `greenfield-fs`, `brownfield-fs`
- quant-methods · agent: `quant-methodologist` · skills: `wacc-input-session`, `monte-carlo-simulation`, `proxy-industry-chain`, `unit-conversion-calibration`, `value-chain-driver-identification` · procedure: `greenfield-fs`, `brownfield-fs`
- target-comparison · agent: `financial-analyst` · skills: `investment-feasibility-modeling` · procedure: `brownfield-fs-comparative`
- target-selection · agent: `pm` · skills:  · procedure: `brownfield-fs-comparative`

**필수 산출물**
- Business Case(비용·수익 라인 또는 밸류에이션 — brownfield는 대상별)
- 시뮬레이션 NPV 분위수
- BEP 시점과 시뮬레이션 입력 스냅샷
- Target 비교 분석 (brownfield)
- 대상 선정 기록 (brownfield)

**완료 기준**
- 민감도가 포함된 정량 평가가 존재한다 (시뮬레이션 또는 밸류에이션 범위)
- BEP 시점과 시뮬레이션 입력 스냅샷이 산출되어 있다
- brownfield: Short List의 모든 대상이 각각 분석되어 있다 (대상별 Business Case + 시뮬레이션)
- brownfield: 대상 비교 분석과 사람의 대상 선정 기록이 존재한다
- 할인율 적용 주체와 WACC·hurdle IRR을 사람이 확인했다 (ADR-0186 D8 — 가족 wacc가 enforce일 때 차단)

**엔진 차단 키** (필수 산출물·완료 기준 번호는 1부터)
- `s8.business_case_per_target` — 산출물 1 · 완료 기준 3
- `s8.business_case` — 산출물 1 · 완료 기준 1
- `s8.npv_quantiles` — 산출물 2 · 완료 기준 1
- `s8.bep_input_snapshot` — 산출물 3 · 완료 기준 2
- `s8.target_selection_record` — 산출물 4, 5 · 완료 기준 4
- `s8.wacc_hurdle_confirmed` — 완료 기준 5

**적용 트랙**: greenfield, brownfield

### 게이트
### Gate: FS (fs)

**판정 기준**
- 정량화된 Business Case(NPV/IRR/BEP 또는 밸류에이션 범위)가 존재한다
- 사전 정의된 사업목표 기준(그룹/계열사 마스터데이터, ADR-0114) 충족 여부가 기본 시나리오 기준으로 확인되었다
- brownfield: 대상별 비교 분석과 사람의 대상 선정 기록(target_selection)이 존재한다

**Kill 기준**
- 기준 수익률 미달이 기본 시나리오에서 확인된다

**자원 결정**: DD 착수 자원 배정

## S9 — 실사·검증

**목표**: 사실인가? 위험은 무엇인가? — 트랙별 실사 체크리스트를 수행한다 (brownfield는 S8에서 선정된 대상 DD, 선택적으로 다른 Short List 대상 DD를 비교 근거로 열 수 있다. greenfield는 실현가능성 검증)

**입력**
- 게이트 체크리스트 (commercial/technical/legal)
- 조사 근거
- S8 대상 선정 기록 (brownfield)
- S3 필요 역량 등록부 (brownfield — capability-dd 입력; design 2026-10-19-brownfield-capability-dd)
- 진입시장 산정 (S2 확정 — ADR-0181; S3~S12의 기준 시장, ADR-0187 M9)

**Activities**
- commercial-dd · agent: `commercial-dd-agent` · skills: `commercial-due-diligence` · procedure: `greenfield-dd`, `brownfield-dd`
- technical-dd · agent: `technical-dd-agent` · skills: `technical-due-diligence`, `site-infrastructure-assessment`, `site-visit-protocol`, `community-partnership-planning` · procedure: `greenfield-dd`, `brownfield-dd`
- legal-dd · agent: `legal-counsel` · skills: `legal-due-diligence`, `regulatory-screening` · procedure: `greenfield-dd`, `brownfield-dd`
- financial-dd · agent: `financial-analyst` · skills: `quality-of-earnings`, `historical-financial-analysis`, `dd-to-valuation-bridge` · procedure: `greenfield-dd`, `brownfield-dd`
- hr-dd · agent: `hr-integration-agent` · skills: `org-readiness-assessment`, `talent-pipeline-planning`, `management-incentive-review`, `compensation-harmonization-analysis` · procedure: `greenfield-dd`, `brownfield-dd`
- market-dd · agent: `market-intelligence-agent` · skills: `competitive-intelligence` · procedure: `greenfield-dd`, `brownfield-dd`
- financing-dd · agent: `financing-agent` · skills: `financing-plan-review` · procedure: `greenfield-dd`, `brownfield-dd`
- dd-waiver-review · agent: `compliance-officer` · skills: `waiver-management`, `compliance-monitoring` · procedure: `greenfield-dd`, `brownfield-dd`
- capability-dd · agent: `brownfield-agent` · skills: `brownfield-feasibility` · procedure: `brownfield-dd`
- antitrust-dd · agent: `antitrust-agent` · skills: `antitrust-screening` · procedure: `brownfield-dd`
- region-labor-review · agent: `region-lead` · skills: `regulatory-screening` · procedure: `greenfield-dd`, `brownfield-dd`
- customer-retention-dd · agent: `customer-retention-agent` · skills: `customer-attrition-risk` · procedure: `brownfield-dd`
- incentive-dd · agent: `incentive-agent` · skills: `incentive-clawback-assessment` · procedure: `brownfield-dd`
- contingent-liability-dd · agent: `valuation-agent` · skills: `debt-and-contingent-liability-simulation` · procedure: `brownfield-dd`
- certification-transferability-dd · agent: `legal-counsel` · skills: `certification-transferability` · procedure: `brownfield-dd`
- ip-fto-dd · agent: `ip-agent` · skills: `ip-fto-review` · procedure: `greenfield-dd`, `brownfield-dd`

**필수 산출물**
- DD 체크리스트 판정(필수 항목 해소)

**완료 기준**
- 적용 체크리스트의 모든 항목이 판정되고 필수 미충족이 0건이다

**엔진 차단 키** (필수 산출물·완료 기준 번호는 1부터)
- `s9.dd_checklist_judgement` — 산출물 1 · 완료 기준 1
- `s9.dd_mandatory_resolved` — 산출물 1 · 완료 기준 1

**적용 트랙**: greenfield, brownfield

### 게이트
### Gate: DD (dd)

**판정 기준**
- 필수 체크리스트 항목이 모두 충족/해당없음/예외 처리되었다
- 미해소 필수 미충족이 0건이다

**Kill 기준**
- waiver 불가능한 필수 항목 미충족 지속

**자원 결정**: 투자심의 자료 작성 자원 배정

## S10 — 투자구조 설계

**목표**: 어떤 그릇으로, 어떤 자금으로 들어갈 것인가? — 투자 주체(direct/SPC/holdco/내부 스핀오프/JV)과 ADR-0045 4대 축(절세 구조·책임 격리·재무 레버리지·엑싯 구조)을 검토하고 자금조달 계획(sources & uses)을 균형시킨다 (투자심의의 입력 설계)

**입력**
- S8 채택 Business Case
- S9 DD 발견사항(dd_finding value_impact 포함)
- WACC·hurdle 입력값
- 진입시장 산정 (S2 확정 — ADR-0181; S3~S12의 기준 시장, ADR-0187 M9)

**Activities**
- deal-structure-hypothesis · agent: `brownfield-agent` · skills: `investment-vehicle-structuring` · procedure: `deal-structuring`
- financing-plan · agent: `valuation-agent` · skills: `financing-plan-review`, `investment-feasibility-modeling`, `regional-incentive-sourcing` · procedure: `deal-structuring`

**필수 산출물**
- 투자구조 가설(4축 검토 완료)
- 자금조달 계획(sources & uses 균형)

**완료 기준**
- 최신 투자구조 가설의 4축 검토(절세 구조·책임 격리·재무 레버리지·엑싯 구조)가 근거 아티팩트 참조와 함께 완료되었다
- 자금조달 sources와 uses 합계가 균형을 이루고 0보다 크다
- 자금 사용(uses) 합계가 S8에서 채택한 케이스의 투자금과 ±5% 이내로 대사된다 — 채택 투자금을 도출할 수 없으면 차단하지 않고 사람의 대사를 요구한다 (ADR-0187 D2·P3; 임계값 소유자는 risk-officer와 quant-methodologist)
- 부채 조달이 있으면 다운사이드 시나리오의 DSCR 커버넌트 여력이 1.3배 이상이다 (ADR-0187 D2·P3; 임계값 소유자는 risk-officer와 quant-methodologist)
- 모든 조달원(sources)에 자금 확정성 증빙(evidence_kind·evidence_ref)이 기록되었다 (ADR-0187 P3)

**엔진 차단 키** (필수 산출물·완료 기준 번호는 1부터)
- `s10.deal_structure_hypothesis` — 산출물 1 · 완료 기준 1
- `s10.sources_uses_balance` — 산출물 2 · 완료 기준 2
- `s10.uses_reconcile_adopted_investment` — 완료 기준 3
- `s10.downside_covenant_headroom` — 완료 기준 4
- `s10.funding_evidence` — 완료 기준 5

**적용 트랙**: greenfield, brownfield

### 게이트


## S11 — 투자심사·실행

**목표**: 투자할 것인가? — S10에서 설계한 투자 구조와 자금 조달 계획을 투자심의 자료로 묶어 법인·그룹 투자심의위원회 심사를 통과하고, 승인되면 트랙에 맞는 실행에 들어간다(인수 종결, 설립 또는 사업부 신설 실행, greenfield 실행 기준선 확정)

**입력**
- 투자심의 자료(사업계획·DD·RAG·검토)
- 투자 구조안(S10 투자구조 설계의 산출물 — 투자 주체·4축 검토·자금조달 계획)
- 사람 최종 승인 산출물
- 진입시장 산정 (S2 확정 — ADR-0181; S3~S12의 기준 시장, ADR-0187 M9)

**Activities**
- ic-preparation · agent: `pm` · skills: `executive-presentation`, `sample-driven-report-writing`, `dd-to-valuation-bridge`, `financing-plan-review`, `insight-synthesis` · procedure: `entity-ic-review`, `group-investment-review`
- charter-baseline · agent: `pm` · skills:  · procedure: `entity-ic-review`
- investment-structuring · agent: `brownfield-agent` · skills:  · procedure: `entity-ic-review`
- risk-review · agent: `risk-officer` · skills: `legal-risk-register`, `rag-scoring-framework` · procedure: `entity-ic-review`
- group-review · agent: `group-review-agent` · skills: `group-level-review`, `intra-group-transaction-compliance`, `portfolio-fit-assessment`, `two-tier-approval-chain` · procedure: `group-investment-review`
- entity-establishment-execution · agent: `process-governance-manager` · skills: `legal-due-diligence`, `k-law`, `certification-transferability`, `org-readiness-assessment`, `stage-gate-governance`, `permit-pathway-mapping` · procedure: `entity-establishment-execution`, `business-unit-establishment-execution`
- pmi-kickoff · agent: `pmi-agent` · skills: `pmi-planning`, `compensation-harmonization-analysis` · procedure: `pmi-integration-execution`
- greenfield-execution-baseline · agent: `greenfield-agent` · skills: `greenfield-feasibility`, `talent-pipeline-planning`, `certification-roadmap`, `financing-plan-review`, `incentive-clawback-assessment` · procedure: `greenfield-execution-baseline`

**필수 산출물**
- 투자심의 자료
- 추진계획(차터) 기준선 — 목적·트랙 근거·진출 범위·KPI 선커밋
- 사람 최종 승인(reviewer 기록)
- 설립 실행 기록(신규 법인 설립 — 설립준비·등기·인허가 분류·인력이전·완료확인 — chk-entity-formation 증적, origin∈{internal,joint} / 신규 사업부 추진 — 신설 결의·사업자등록 정리·인허가 명의 확인·인력 배치·완료 확인 — chk-business-unit-formation 증적, origin=internal)

**완료 기준**
- 법인 투자심의위원회와 그룹 투자심의위원회 승인이 모두 기록되었다
- 추진계획(차터) 기준선이 확정되고 append-only 변경 이력이 시작되었다
- origin∈{internal,joint}인 프로젝트는 entity-establishment-execution 5단계 완료 기록이 존재한다
- 실행 순서는 법인 투자심의위원회 GO → 그룹 투자심의위원회 GO → 실행(설립·사업부 신설 / PMI 킥오프 / greenfield 실행 기준선)이다 — 그룹 GO 전에는 설립·자본 약정을 실행하지 않는다 (ADR-0187 D7)
- S8에서 사람이 채택한 Business Case 기록(s8_case_adopt)이 존재한다
- 법인·그룹 투자심의위원회의 최신 GO 결정자가 사람이다 (사람 최종 승인 — grandfathered 프로젝트 제외)
- brownfield M&A·JV·전략적 투자: 사람이 기록한 PMI 킥오프(통합 책임자·통합 계획 기준선)가 존재한다 (소수점 지분·파트너십·R&BD·CVC·기존사업 R&BD·사내벤처 제외)
- greenfield: 실행 기준선이 사람에 의해 확인되었다 (트랙 분류 충돌은 사람이 정리 — ADR-0161)
- 투자심의위원회가 건 선행 조건(condition precedent)이 모두 해소되었다 (ADR-0186 D4 — 가족 validators가 enforce일 때 차단)

**엔진 차단 키** (필수 산출물·완료 기준 번호는 1부터)
- `s11.entity_ic_approval` — 완료 기준 1
- `s11.group_ic_approval` — 완료 기준 1
- `s11.adopted_business_case` — 산출물 1 · 완료 기준 5
- `s11.charter_baseline` — 산출물 2 · 완료 기준 2
- `s11.human_reviewer_record` — 산출물 3 · 완료 기준 6
- `s11.pmi_kickoff` — 완료 기준 7
- `s11.establishment_mode` — 산출물 4 · 완료 기준 3
- `s11.business_unit_execution` — 산출물 4 · 완료 기준 3
- `s11.entity_establishment_execution` — 산출물 4 · 완료 기준 3
- `s11.condition_precedents` — 완료 기준 9
- `s11.classification_conflict` — 완료 기준 8
- `s11.execution_baseline` — 완료 기준 8

**적용 트랙**: greenfield, brownfield

### 게이트
### Gate: 법인 투자심의위원회 (entity_ic)

**판정 기준**
- 투자심의 자료가 완비되었다
- 사람 최종 승인 필수 산출물의 reviewed_by가 기록되었다
- 게이트 스냅샷에 대한 확인이 사유와 함께 기록되었고, 다른 담당자(entity-ic-reviewer)의 countersign으로 GO가 유효해졌다

**Kill 기준**
- 필수 산출물 미승인

**자원 결정**: Entity 차원 투자 권고

### Gate: 그룹 투자심의위원회 (group_ic)

**판정 기준**
- 법인 투자심의위원회 승인이 선행되었다
- 그룹 관점 포트폴리오 적합성이 검토되었다
- 게이트 스냅샷에 대한 확인이 사유와 함께 기록되었고, 다른 담당자(group-ic-reviewer)의 countersign으로 GO가 유효해졌으며, 그룹 IC 범위의 미해소 조건이 없다

**Kill 기준**
- 그룹 수준 반려

**자원 결정**: 최종 투자 집행

## S12 — 사후 관리

**목표**: 투자 후 사업이 궤도에 올랐는가? — 포트폴리오 성과를 모니터링한다

**입력**
- IC 승인 결정
- 실행 계획
- 진입시장 산정 (S2 확정 — ADR-0181; S3~S12의 기준 시장, ADR-0187 M9)

**Activities**
- portfolio-monitoring · agent: `group-review-agent` · skills: `portfolio-fit-assessment` · procedure: `portfolio-venture-monitoring`
- integration-monitoring · agent: `pmi-agent` · skills: `pmi-planning` · procedure: `pmi-integration-execution`
- partnership-monitoring · agent: `partnership-agent` · skills: `partnership-health-scorecard`, `jv-structuring`, `portfolio-fit-assessment` · procedure: `jv-lifecycle-governance`

**필수 산출물**
- 벤처 스코어카드 (greenfield — brownfield은 integration/partnership 모니터링, 권장·비차단)
- 사람 전환 결정 기록(어휘 5종, decided_by=venture-portfolio-ic, rationale 필수 — venture_transition_decision 원장)
- 전환별 결정 부속 기록: 차기 트랜치 조건(next_tranche_released/held_evidence_incomplete), 핵심사업 인계 기록(graduate_to_core), 매각/청산 계획(reduce_or_divest), 학습 포착 기록(kill_with_learning_captured — group-review-agent 기록, risk-officer가 S1/S2 기본률에 환류)
- 실행 기준선 대비 차이(greenfield)

**완료 기준**
- 리뷰 주기별로 스코어카드 검토가 존재한다 (greenfield — brownfield은 integration/partnership 모니터링으로 대체, 권장·비차단)
- 각 검토마다 사람 전환 결정이 근거(rationale)와 함께 기록되어 있다
- 지속 결정(next_tranche_released/held_evidence_incomplete)은 차기 트랜치 조건을 기록한다
- 확장 결정(graduate_to_core)은 핵심사업 인계를 기록한다
- 축소/철수 결정(reduce_or_divest)은 매각 또는 청산 계획을 기록한다
- 중단 결정(kill_with_learning_captured)은 포착된 학습을 기록하고 S1/S2 기본률에 환류한다
- greenfield는 각 스코어카드 주기에 S11 실행 기준선·S8 채택 케이스·S8 사업 목표(참고) 대비 차이를 보고한다

**엔진 차단 키** (필수 산출물·완료 기준 번호는 1부터)
- `s12.venture_scorecard` — 산출물 1 · 완료 기준 1
- `s12.scorecard_refresh` — 산출물 1 · 완료 기준 1
- `s12.transition_decision` — 산출물 2 · 완료 기준 2
- `s12.tranche_condition` — 산출물 3 · 완료 기준 3
- `s12.core_handoff` — 산출물 3 · 완료 기준 4
- `s12.divest_plan` — 산출물 3 · 완료 기준 5
- `s12.learning_capture` — 산출물 3 · 완료 기준 6
- 비차단 산출물: 4

**적용 트랙**: greenfield, brownfield

### 게이트




---

# Addendum — Implemented automation state (v2.0.0, ADR-0095~0102)

> 이 부분은 사양에서 생성되지 않는 **hand-maintained addendum**이다. 본문(S1~S12
> stage/gate reference)은 flow.spec.yaml의 생성물이고, 이 아래 단락은 구현된
> 자동화 표면(ADR-0095~0102, PRs #191~#199)을 문서화한다. 수정은 이 상수
> (`scripts/co-newbiz/generate-process-flow.ts`의 `ADDENDUM`)에서 한다.

## Process engine and stage evaluation

Stage state is **derived, never stored**: there is no persisted `current_stage`.
UI and the agent orchestrator both call `evaluateProcess(entity)` in
`app/web-next/lib/process-flow.ts`, which recomputes the full
`ProcessEvaluation` (currentStage, completedStages, blockedStages, nextStage,
blockers, requiredArtifacts, gateStatus, track/subTrack, terminated) from
persisted artifacts and the latest `gate_decision` rows.

Two entity lifecycles (ADR-0094/0095):

- **opportunity** carries S1–S7. Track is derived from the S4
  `route_decision` (via `latestRouteDecision`); track-inapplicable stages render as
  `skipped`, downstream siblings of an incomplete stage as `locked`.
- **project** carries S8–S12. The **S7→S8 handoff is promotion**
  (`promoteOpportunity`, `db/repositories/project.repository.ts`; wired by
  `app/web-next/lib/pipeline.ts:290`) — preconditions verify the track-specific
  S5 output (greenfield) or S7 Short List (brownfield) before the project row
  exists (ADR-0095).

### Completion predicates as implemented (registry keys; refreshed 2026-09-18)

The predicates live in the `OPPORTUNITY_STAGE_COMPLETION` /
`PROJECT_STAGE_COMPLETION` registries in `app/web-next/lib/process-flow.ts`
(keyed `S1`…`S12`); refer to those keys instead of line numbers, which rot.
v2.4.1 alignment: S1 competitive structure became a hard requirement (missing
artifact, blocks completion), and S4 now checks `alternatives_considered`.

| Stage | Predicate |
|---|---|
| S1 | market size·growth + value-chain node, substitutable by an industry-level completed `market_sizing_analysis` / `proxy_link`; latest completed matrix must carry competitive structure (경쟁 구조 — hard since v2.4.1) |
| S2 | opportunity attractiveness score recorded |
| S3 | synergy_score + rationale + status `selected` (dropped blocks S4) |
| S4 | `route_decision` with track; brownfield additionally sub_track + all 5 criteria scores + non-empty alternatives considered |
| S5 | greenfield capability gaps (≥1), entry strategy, alternatives considered |
| S6 | brownfield Target Universe JSON + Long List ≥ min coverage (default 3) |
| S7 | every target shortlisted (knock-outs passed) or excluded with reason; 0 knock-out-passed candidates surfaces the target_screening KILL criterion |
| S8 | ≥1 `business_case_model` for the project AND ≥1 `valuation_simulation` row (NPV percentiles) — ADR-0098 |
| S9 | `ddCompletionSummary`: total > 0, pending = 0, mandatoryUnmet = 0 — ADR-0099 |
| S10 | latest `deal_structure_hypothesis` has `four_axis_review_completed` = 1 AND `financing_sources_uses` sources == uses > 0 (balanced) — flow.spec v2.2.0, ADR-0045 |
| S11 | `entity_ic` AND `group_ic` gate decisions both `go` (human record only); for origin ∈ {internal, joint}, `establishmentProgress` = 5/5 — ADR-0100 |
| S12 | ADR-0150 six criteria: `venture_scorecard` exists with a fresh review cycle (current or previous quarter, `isFreshReviewCycle` — criterion 1, ADR-0101 §4 mechanics; **greenfield-only since v2.10.1 — T-20261022-001: brownfield monitors via integration/partnership, recommended·non-blocking**) AND a human transition decision recorded with rationale for the latest cycle (criterion 2, track-agnostic), AND the transition's criterion-specific record — tranche conditions (criterion 3), core handover (criterion 4), divest/liquidation plan (criterion 5), captured learning fed back to S1/S2 base rates (criterion 6) |

Gate semantics: every gate verdict is a human-recorded `gate_decision` row
(ADR-0053 `decision_authority: human`; ADR-0094 — the sole human-confirmation
ledger). HOLD blocks re-evaluation of the current stage's gate, not the work
itself (the HOLD branch of the stage walkers in `process-flow.ts`); any
`kill` terminates the entity.

## Automation surfaces per stage (S8–S12)

- **S8 — 3-scenario business-case generation (ADR-0098)**:
  `generateBusinessCases` runs the FS scenario contract (downside / base /
  upside) as one `runActivityChain` per scenario, writing per-scenario
  `business_case_model` + `business_case_line` + `valuation_simulation`
  percentiles, and flags a RECOMMENDED case. The scenario→case binding is
  **human adoption** — agents generate, a person adopts one case for the FS gate.
- **S9 — tailored DD checklists (ADR-0099)**: the standard commercial/technical/
  legal checklists stay authoritative; `tailorDdChecklist` proposes
  project-specific custom items. The default executor is deterministic; a
  WebSearch-backed benchmarking executor is available via the
  `CO_NEWBIZ_DD_TAILOR_AGENTS` seam. Honesty constraint: an unsourced proposal
  (no source URL / real source) is recorded with reliability grade **C** — the
  seam's limits stay legible to the human reviewer instead of fabricating
  authority.
- **S10 — deal structuring (flow.spec v2.2.0, ADR-0045)**: the deal-structure
  surface records the vehicle hypothesis (direct / SPC / holdco / internal-venture
  spin-off / JV) with the four mandatory axis notes (tax / liability isolation /
  financing leverage / exit) and assembles the financing plan (sources & uses,
  migration 0075). Four-axis completion demands a `deal_structure_review`
  artifact reference (single deliberate setter); S10 completes only when the
  latest hypothesis is four-axis-complete AND sources balance uses.
- **S11 — IC package, dual gates, establishment (ADR-0100)**: the IC package
  surface assembles the project evidence for `entity_ic` → `group_ic`
  (both human gates). For origin ∈ {internal, joint}, establishment execution is
  tracked as **project-keyed** 5 steps (setup → registration/permit
  classification → personnel transfer → completion check; `chk-entity-formation`
  evidence). For a Green Field project the step set follows the establishment
  mode (ADR-0167): `new_entity` keeps those five steps, `business_unit`
  (origin internal only) runs resolution → registration update → permit holder
  check → staffing → completion check with `chk-business-unit-formation` evidence; the opportunity-keyed ADR-0057 pattern is deprecated.
- **S12 — scorecard and transitions (ADR-0101)**: the portfolio scorecard view
  reads `venture_scorecard` per project; kill/graduate outcomes are recorded in
  a human transition-decision ledger using the venture-portfolio-ic vocabulary
  (next_tranche_released / held_evidence_incomplete / graduate_to_core /
  reduce_or_divest / kill_with_learning_captured) — portfolio governance, a
  different category from the S1–S11 kill criteria.

## Steering committee system (ADR-0097, `procedures/_committees.yaml`)

Two registered committees — `route-steering-committee` (S4 route decision) and
`target-longlist-shortlist-committee` (S6/S7 shortlist promotion).

- **Composition**: the fixed 5-role skeleton (domain expert — the only
  track-swapping seat; industry; region; quantitative rigor; red team) plus six
  standing functional seats (financing, site & facility, legal, HR & labor, IR,
  IP). `risk-officer` is the red team with `veto_dissent: true` — mandatory on
  every committee; removing the seat requires a new ADR.
- **Chair**: `process-governance-manager` under the recorder pattern —
  synthesizes and votes nothing.
- **Decision modes** (closed enum): `human_only`, `agent_team`, `hybrid`. The
  mode never changes who confirms: in `agent_team` mode the chair synthesis is
  recorded as a `gate_evaluation` **PROPOSAL — never a `gate_decision`**
  (design boundary #2, ADR-0053/0094).
- `rounds: 2` for every member today; see the deferred list below.

## End-to-end auto pipeline (ADR-0102)

`app/web-next/lib/pipeline.ts` is the state machine that consumes
`evaluateProcess`'s rule table in a loop: given an industry (`md_industry`)
and an initiating company (`md_company`), `advancePipeline`
(pipeline.ts:386) executes the current stage's automation, re-evaluates, and
**pauses only at human decision points** (gate go/hold/kill, business-case
adoption, checklist final approval, track/route confirmation, S12 transition).
`pipeline_run` (migration 0072) carries status `running` /
`paused_for_human` / `completed` / `failed` / `killed`; a pause writes a
`pipeline_paused` notification (pipeline.ts:497). The OS-scheduler batch
`scripts/co-newbiz/watch-run.ts` runs a pipeline-resume pass
(watch-run.ts:203–239): `resumePausedPipelines` (pipeline.ts:586) auto-resumes
runs whose blocker cleared and leaves the rest paused. Promotions happen inside
the pipeline when preconditions are met (pipeline.ts:276–290).

## Deferred / env-seamed capabilities

Declared gaps, not hidden ones:

- **LLM-backed executors** — all generation executors default to deterministic
  behavior; LLM modes exist behind env seams and are opt-in:
  `CO_NEWBIZ_BUSINESS_CASE_AGENTS=llm` (S8, business-case-generator.ts:18,
  `setExecutorFactory` pattern), `CO_NEWBIZ_DD_TAILOR_AGENTS` (S9 WebSearch
  tailoring), `CO_NEWBIZ_COMMITTEE_AGENTS` (committee deliberation), and the
  `CO_NEWBIZ_LLM_PROVIDER / _MODEL / _BASE_URL / _API_KEY` family.
- **Round-1-only functional-seat participation** — with 12 members,
  per-member `rounds: 1` for functional seats was considered and deferred;
  expressing it cleanly requires touching both the hybrid path in
  `committee-session.ts` and `runDeliberationRounds` in
  `agent-orchestrator.ts`, so all members keep `rounds: 2`
  (`_committees.yaml` follow-up note).
- **Scorecard weights / cadence (ADR-0052 open question b)** — the exact
  venture-scorecard weighting scheme and revisit cadence remain an open
  question; the S12 completion predicate is the ADR-0150 six-criteria set
  (fresh per-review-cycle scorecard review + a human transition decision
  with rationale, each transition carrying its criterion-specific record —
  flow.spec S12 completionCriteria).
