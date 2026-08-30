# Process Flow — 신규사업 검토 프로세스 (생성 문서)

> **⚠ 이 문서는 생성물입니다.** `process/flow.spec.yaml`(SSOT, ADR-0074)에서
> `bun scripts/co-newbiz/generate-process-flow.ts`로 생성됩니다. 이 파일을
> 직접 수정하지 마세요 — 수정은 사양에서, 본 문서는 참조용으로.
> 설계 철학·원칙·베스트 프랙티스는 `docs/design-guide.md`와 ADR-0074를 참고하세요.


## 프로세스 흐름 요약

S1 시장분석 → S2 기회발굴 → S3 시너지·적합성 → S4 진출방식 결정 → S5 사업성 분석 → S6 실사·검증 → S7 투자심사·실행

엔티티 라이프사이클:
- opportunity: S1 → S2 → S3 → S4
- project: S5 → S6 → S7

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
- 사업성 분석 입력이 존재한다

**Kill 기준**
- 진출방식이 결정되지 않았다

**자원 결정**: FS 본격 검토 자원 배정

### FS (fs)
**판정 기준**
- 정량화된 Business Case(NPV/IRR/BEP 또는 밸류에이션 범위)가 존재한다

**Kill 기준**
- 기준 수익률 미달이 기본 시나리오에서 확인된다

**자원 결정**: DD 착시 자원 배정

### DD (dd)
**판정 기준**
- 필수 체크리스트 항목이 모두 충족/해당없음/예외 처리되었다
- 미해소 필수 미충족이 0건이다

**Kill 기준**
- waiver 불가능한 필수 항목 미충족 지속

**자원 결정**: IC 패키지 작성 자원 배정

### Entity IC (entity_ic)
**판정 기준**
- IC 패키지가 완비되었다
- 사람 최종 승인 필수 산출물의 reviewed_by가 기록되었다

**Kill 기준**
- 필수 산출물 미승인

**자원 결정**: Entity 차원 투자 권고

### Group IC (group_ic)
**판정 기준**
- Entity IC 승인이 선행되었다
- 그룹 관점 포트폴리오 적합성이 검토되었다

**Kill 기준**
- 그룹 수준 반려

**자원 결정**: 최종 투자 집행

## 설계 원칙 및 에이전트 오케스트레이션

이 프로세스는 Agentic-first, Human-final 원칩으로 운영된다 — 에이전트가 스테이지를 실행·권고하고, 사람은 IC 승인과 예외 개입만 수행한다 (docs/design-guide.md, ADR-0074).

**스테이지별 담당 에이전트(오케스트레이터가 Activities의 agent 필드를 실행)**

- S1 시장분석: `market-intelligence-agent`, `industry-lead`
- S2 기회 발굴: `market-intelligence-agent`, `greenfield-agent`
- S3 시너지·전략적 적합성: `process-governance-manager`, `risk-officer`
- S4 진출방식 결정: `pm`, `brownfield-agent`
- S5 사업성 분석: `financial-analyst`, `valuation-agent`, `quant-methodologist`
- S6 실사·검증: `commercial-dd-agent`, `technical-dd-agent`, `legal-counsel`
- S7 투자심사·실행: `pm`, `risk-officer`, `group-review-agent`

스킬·프로시저 대응은 각 스테이지의 Activities 표를, 전체 매핑 근거는 ADR-0074를 참고한다.

## 스테이지 상세

## S1 — 시장분석

**목표**: 어디에 기회가 있는가? — 시장 규모·성장·경쟁구조와 가치사슬을 파악한다

**입력**
- 외부 시장 데이터 (fact_market_observation)
- 산업 드라이버 레지스트리

**Activities**
- market-research · agent: `market-intelligence-agent` · skills: `market-data-pipeline`, `proxy-industry-chain` · procedure: `greenfield-screening`, `brownfield-screening`
- competitive-intelligence · agent: `market-intelligence-agent` · skills: `competitive-intelligence` · procedure: `greenfield-screening`, `brownfield-screening`
- value-chain-analysis · agent: `industry-lead` · skills: `value-chain-linkage-analysis`, `value-chain-stage-financials` · procedure: `greenfield-screening`, `brownfield-screening`

**필수 산출물**
- 시장 규모·성장 추정
- 가치사슬 구조

**완료 기준**
- 최소 1개의 정량화된 수요 추정(직접 또는 프록시 체인)이 존재한다
- 데이터 신뢰도 등급이 기록되었다

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
- 가치사슬 구조

**Activities**
- opportunity-discovery · agent: `market-intelligence-agent` · skills: `insight-synthesis` · procedure: `greenfield-screening`, `brownfield-screening`
- business-model-sketch · agent: `greenfield-agent` · skills: `scenario-planning` · procedure: `greenfield-screening`, `brownfield-screening`

**필수 산출물**
- 기회 등록(가치사슬 노드·매력도)

**완료 기준**
- 최소 1개 기회가 selected 상태이다

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
- 선별 기회
- 자사 역량·포트폴리오 정보

**Activities**
- strategic-fit-screening · agent: `process-governance-manager` · skills: `strategic-fit-screening`, `portfolio-fit-assessment` · procedure: `greenfield-screening`, `brownfield-screening`
- synergy-analysis · agent: `risk-officer` · skills: `assumption-audit` · procedure: `greenfield-screening`, `brownfield-screening`

**필수 산출물**
- 시너지 평가
- 전략적 적합성 판단

**완료 기준**
- 기회에 synergy_score와 근거가 기록되었다
- 적합성 판단(Go/Hold/Kill 권고)이 존재한다

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

**목표**: 어떻게 들어갈 것인가? — Greenfield(자체) vs Brownfield(M&A), R&BD vs 사내벤처를 결정한다

**입력**
- 시너지·적합성 평가

**Activities**
- route-strategy · agent: `pm` · skills: `deal-execution-playbook`, `jv-structuring`, `partner-sourcing-strategy` · procedure: `greenfield-pre-fs`, `brownfield-pre-fs`, `deal-shape-chain`
- deal-shape-evaluation · agent: `brownfield-agent` · skills: `deal-execution-playbook` · procedure: `greenfield-pre-fs`, `brownfield-pre-fs`, `deal-shape-chain`

**필수 산출물**
- 트랙 결정(GF/BF)·근거
- 검토한 대안

**완료 기준**
- route_decision 레코드가 존재한다 (track 필수, greenfield는 sub_track)

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
- 사업성 분석 입력이 존재한다

**Kill 기준**
- 진출방식이 결정되지 않았다

**자원 결정**: FS 본격 검토 자원 배정

## S5 — 사업성 분석

**목표**: 돈이 되는가? — Greenfield는 비용·수익 모델, M&A는 밸류에이션이 주체다

**입력**
- 트랙 결정
- Business Case 라인 (greenfield)
- 타깃 재무 정보 (brownfield)

**Activities**
- business-case-modeling · agent: `financial-analyst` · skills: `growth-projection-modeling`, `investment-feasibility-modeling` · procedure: `greenfield-fs`, `brownfield-fs`
- valuation · agent: `valuation-agent` · skills: `dd-to-valuation-bridge`, `monte-carlo-simulation` · procedure: `greenfield-fs`, `brownfield-fs`
- quant-methods · agent: `quant-methodologist` · skills: `wacc-input-session`, `monte-carlo-simulation` · procedure: `greenfield-fs`, `brownfield-fs`

**필수 산출물**
- Business Case(비용·수익 라인 또는 밸류에이션)
- 시뮬레이션 NPV 분위수

**완료 기준**
- 민감도가 포함된 정량 사롢가 존재한다 (시뮬레이션 또는 밸류에이션 범위)

**적용 트랙**: greenfield, brownfield

### 게이트
### Gate: Pre-FS (pre_fs)

**판정 기준**
- 트랙(그린필드/브라운필드) 결정 근거가 기록되었다
- 사업성 분석 입력이 존재한다

**Kill 기준**
- 진출방식이 결정되지 않았다

**자원 결정**: FS 본격 검토 자원 배정

### Gate: FS (fs)

**판정 기준**
- 정량화된 Business Case(NPV/IRR/BEP 또는 밸류에이션 범위)가 존재한다

**Kill 기준**
- 기준 수익률 미달이 기본 시나리오에서 확인된다

**자원 결정**: DD 착시 자원 배정

## S6 — 실사·검증

**목표**: 사실인가? 위험은 무엇인가? — 트랙별 실사 체크리스트를 수행한다

**입력**
- 게이트 체크리스트 (commercial/technical/legal)
- 조사 근거

**Activities**
- commercial-dd · agent: `commercial-dd-agent` · skills: `commercial-due-diligence` · procedure: `greenfield-dd`, `brownfield-dd`
- technical-dd · agent: `technical-dd-agent` · skills: `technical-due-diligence`, `site-infrastructure-assessment` · procedure: `greenfield-dd`, `brownfield-dd`
- legal-dd · agent: `legal-counsel` · skills: `legal-due-diligence`, `regulatory-screening` · procedure: `greenfield-dd`, `brownfield-dd`

**필수 산출물**
- DD 체크리스트 판정(필수 항목 해소)

**완료 기준**
- 적용 체크리스트의 모든 항목이 판정되고 필수 미충족이 0건이다

**적용 트랙**: greenfield, brownfield

### 게이트
### Gate: DD (dd)

**판정 기준**
- 필수 체크리스트 항목이 모두 충족/해당없음/예외 처리되었다
- 미해소 필수 미충족이 0건이다

**Kill 기준**
- waiver 불가능한 필수 항목 미충족 지속

**자원 결정**: IC 패키지 작성 자원 배정

## S7 — 투자심사·실행

**목표**: 투자할 것인가? — IC 패키지로 Entity/Group IC 심사를 받는다

**입력**
- IC 패키지(사업계획·DD·RAG·검토)
- 사람 최종 승인 산출물

**Activities**
- ic-preparation · agent: `pm` · skills: `executive-presentation`, `sample-driven-report-writing` · procedure: `entity-ic-review`, `group-investment-review`
- risk-review · agent: `risk-officer` · skills: `legal-risk-register` · procedure: `entity-ic-review`, `group-investment-review`
- group-review · agent: `group-review-agent` · skills: `group-level-review` · procedure: `entity-ic-review`, `group-investment-review`

**필수 산출물**
- IC 패키지
- 사람 최종 승인(reviewer 기록)

**완료 기준**
- Entity IC와 Group IC 승인이 모두 기록되었다

**적용 트랙**: greenfield, brownfield

### 게이트
### Gate: Entity IC (entity_ic)

**판정 기준**
- IC 패키지가 완비되었다
- 사람 최종 승인 필수 산출물의 reviewed_by가 기록되었다

**Kill 기준**
- 필수 산출물 미승인

**자원 결정**: Entity 차원 투자 권고

### Gate: Group IC (group_ic)

**판정 기준**
- Entity IC 승인이 선행되었다
- 그룹 관점 포트폴리오 적합성이 검토되었다

**Kill 기준**
- 그룹 수준 반려

**자원 결정**: 최종 투자 집행
