---
stage: S7
gate: "Entity IC"
owner_agent: risk-officer
date: 2026-08-31
track: brownfield
reviewed_by: PENDING
---

# 02. 리스크 레지스터 — 삼성전자 × 로보틱스레인보우

> **작성 관점**: `agents/risk-officer.md` (red-team function, Kill Criteria 권한). 형식은 `skills/legal-risk-register`를 따르며, 법률 축을 중심으로 재무·실행 축을 통합한 **통합 리스크 레지스터**로 확장했다(S7 activity: risk-review).
> **원칙**: 스폰서에게 보기 좋게 만들기 위해 red-team 발견을 완화하지 않는다(risk-officer 제약). 본 레지스터는 **각 출처 산출물의 분석을 재서술하지 않고 참조**한다(legal-risk-register 실행단계 3).

## 0. 레지스터 요약

| 심각도 | 건수 | Kill 플래그 |
|---|---:|---:|
| **Critical** | 8 | 4 |
| High | 6 | 1 |
| Medium | 5 | 0 |
| **합계** | **19** | **5** |

**상태 분류**: `open`(미해소) 17건 · `monitored`(감시 중) 2건 · `resolved`(해소) **0건**.

> **해소된 리스크가 0건이라는 사실이 본 레지스터의 가장 중요한 정보다.** S5에서 식별된 리스크 중 S6에서 해소된 것은 하나도 없으며, S6는 오히려 신규 Critical 2건(R6 환경, R8 전략기술)을 추가했다. **리스크가 스테이지 진행에 따라 감소하지 않고 증가하는 것은 DD가 작동하지 않았다는 신호다.**

## 1. 법적 리스크 (Legal)

| ID | 항목 | 출처 스킬 / 산출물 | 심각도 | 상태 | Kill 플래그 | 완화방안 |
|---|---|---|:---:|:---:|:---:|---|
| **LR-01** | **인증 이전가능성 미확인** — 지배권 변동 시 필수 인증의 승계 여부 불명 | `certification-transferability` (미실행) · S6 `04` §3.4, R1 | **Critical** | open | **YES** | 인증기관에 **직접 서면 조회**. 비협상 경계 #5상 **추론 금지** — 어떤 잠정 확률도 기재 불가. M5 평가순서상 다른 5축 검증 후 **마지막에 확정**. "이전 불가" 확인 시 즉시 Kill |
| **LR-02** | **차입계약 CoC 가속조항 미확인** — 100% 주식양수는 전형적 트리거 | `debt-and-contingent-liability-simulation` · S6 `03` LDD-F1, R2 | **Critical** | open | **YES** | VDR에서 전 차입약정 원문 확보 → CoC·재무커버넌트 조항 추출 → 대주 사전동의(waiver) 획득을 **CP(선행조건)로 SPA에 편입**. 클로징 즉시 상환의무 전환 시나리오를 자금계획에 반영 |
| **LR-03** | **상방 공급계약 CoC 미확인** — 정밀감속기 과점 공급자의 해지·단가 재협상 위험 | `customer-attrition-risk` 계약 스캔 (미실행) · S6 `03` LDD-F2, R3 | **Critical** | open | **YES** | 상위 20개 계약 CoC 3축(해지권/동의요건/단가재협상) 스캔. 핵심 공급자 사전동의를 CP화. 미확보 시 **1위 민감도 변수(마진) 직격** → 밸류에이션 재산출 필수 |
| **LR-04** | **IP 권리귀속 체인 미검증** — 감속기 치형·제어 IP의 직무발명 승계 약정 부재 가능성 | `legal-due-diligence` · S6 `03` LDD-F3, R4 | **Critical** | open | no | 발명자별 PIIA·직무발명 승계 약정 원본 확인, 특허 원부상 권리자 체인 대조, 미지급 직무발명보상금 추정. **귀속 다툼과 보상금 청구는 동시에 발생**하므로 특별손해배상(specific indemnity)으로 분리 처리 |
| **LR-05** | **소수주주 drag-along / ROFR 미확인** — 100% 취득 실행가능성 자체가 불확정 | `legal-due-diligence` · S6 `03` LDD-F4, R5 | **Critical** | open | **YES** | 주주간계약 원문 및 자본구성표 확보. 100% 취득 불가 확인 시 **딜 구조 자체가 성립하지 않으므로 Kill 전환** — 지분율 하향은 S3 시너지 D(수직계열화 통제권) 전제를 파괴하므로 구조 변경으로 처리해서는 안 됨 |
| **LR-06** | **환경 정화책임 승계 노출** — 「토양환경보전법」 양수인 승계 + 정밀가공·열처리 공정 | `legal-due-diligence`, technical DD · S6 `02` TDD-F1 / `03` LDD-F5, R6 | **Critical** | open | no | Phase I/II 환경조사 실시. 토양·지하수 오염 이력 조회. **S5 몬테카를로 우발채무 4범주에 environmental 항목이 아예 없어 하방분포가 상향편의** → 조사 결과를 모델에 재투입 필수. 정화비용 상한 없는 승계책임은 에스크로·특별indemnity로도 완전 차단되지 않음 |
| **LR-07** | **국가첨단전략기술 지정 가능성** — 휴머노이드 구동부(3.3m/s·20kg 요건) 해당 시 기술의 해외 이전·매각·합작에 정부 승인 필요 | S6 `04` §3.1, R8 (**S7 시점 신규 리스크**) | **Critical** | open | no | 산업통상자원부 소관 지정 현황 대조 및 사전 확인. 해당 시 **양방향 반영** — 혜택 축(정부 지원·인허가 신속처리)과 규제 축(처분 자유도 제한). 현재 밸류에이션에 **어느 쪽도 반영되어 있지 않다**. S3 시너지 D(옵션가치)는 규제만큼 감쇄 |
| **LR-08** | **기업결합신고 요건 미확정** — 관련시장·HHI 미산정, 다관할 신고요건 미확정 | `antitrust-screening` (미실행) · S6 `04` §2, ma-01/ma-02 | **High** | open | no | antitrust-agent 디스패치(**S1~S6 5회 연속 미이행**). 관련시장 획정 → HHI 산정 → 국내외 신고관할 매핑. 클로징 일정의 임계경로에 위치하므로 **DD 착수와 동시 병행** |
| **LR-09** | **투입물 봉쇄(input foreclosure) 경쟁법 쟁점** — 인수 후 삼성전자向 캡티브 물량 확대가 경쟁당국의 핵심 우려로 전환 | S6 `04` §2 · `intra-group-transaction-compliance` (미실행) | **High** | open | no | **구조적 딜레마로 명시 기록**: 본 딜의 핵심 시너지(시너지 C 캡티브 물량)가 곧 경쟁당국의 핵심 우려사항이다. 행태적 시정조치(공급·가격 조건) 부과 시 `rag-framework` §2.5상 **의무 존속 전 기간 Amber 고정** |
| **LR-10** | **부당지원행위·특수관계인 부당이익제공 규율** (공정거래법 제47조) — 인수 후 그룹 내부거래 단가정책 | `intra-group-transaction-compliance` (미실행) · S5 DS-2 | **High** | open | no | 정상가격 산정 근거 문서화 체계를 PMI 이전에 설계. **DS-2는 상업 리스크이자 규제 리스크** — 마진 잠식(PV −127억)과 제재 리스크가 동일 원인에서 발생 |
| **LR-11** | **NDA 판정 기록 미생성 / project_classification 미등재** (lr-07) | S6 `04`, chk-legal-regulatory | **High** | open | no | **VDR을 여는 것 자체가 이 기록 없이는 절차 위반이다.** 즉시 생성(저비용, 유형 C). clean team 프로토콜(gun-jumping·정보교환 차단) 동시 수립 |
| **LR-12** | 소송·조사, 반부패·제재 스크리닝, 조세, 개인정보, 부동산 권원, 노조·퇴직급여 미검증 (ldd-09/14/17/18/19/20, lr-05) | `legal-due-diligence` · S6 `03` | **Medium** | open | no | 표준 법률 DD 항목 — VDR 개설 후 일괄 수행. 개별 심각도는 Medium이나 **7개 항목이 동시에 미검증**이라는 점에서 집합적으로는 High |

## 2. 재무 리스크 (Financial)

| ID | 항목 | 출처 | 심각도 | 상태 | Kill 플래그 | 완화방안 |
|---|---|---|:---:|:---:|:---:|---|
| **FR-01** | **WACC/hurdle이 `kind='user'`가 아니다** — Pre-FS kill criterion `wacc_hurdle_still_assumed`(ADR-0064 kill #5/#6) **3개 스테이지 연속 무장 상태** | S5 `01` §0 | **Critical** | open | **YES** | 인간이 `wacc`=0.130, `hurdle_irr`=0.150을 **명시적으로 확인·등록**. 이것 없이는 `rag-framework` §2상 Financial 차원의 스코어링 자격 자체가 없다. 저비용·즉시 해소 가능한 항목이 3회 이월된 것은 거버넌스 결함 |
| **FR-02** | **시너지 제외 시 NPV 음수** — 700억에서 P50 **−68억** | S5 `04` | **Critical** | open | no | 시너지 4건 중 3건이 `assumed`. risk-officer base-rate(계획 대비 실현 50~70%) 적용 시 220억 → **135~189억**. **본 Business Case는 여전히 참조 클래스보다 낙관적이다.** 시너지 없는 standalone 케이스를 의사결정의 기준선(base case)으로 삼을 것 |
| **FR-03** | **S5 모델의 상향편의 3건 미반영** — ① 환경 우발채무 누락 ② 시너지 C 증설 CAPEX 미차감 ③ 보상 조화비용 미계상 | S6 `00` | **Critical** | open | no | **셋 모두 NPV를 낮추는 방향이며 어느 것도 모델에 없다.** 3건 반영 후 재산출을 DD 재개 시 valuation-agent에 지시. 재산출 전까지 S5의 NPV 수치는 **하한이 아니라 상한**으로 읽어야 한다 |
| **FR-04** | **EBITDA 마진 민감도** — 4%p 하락으로 EV 74% 증발(774→205억) | S5 `03` §5 토네이도 | **High** | monitored | no | 1위 민감도 변수. QoE(Quality of Earnings) 미실시 상태에서 **정규화되지 않은 EBITDA 위에 전체 밸류에이션이 서 있다**(brownfield-fs step 1 미수행). QoE를 DD 재개 1순위로 배정 |
| **FR-05** | **DCF vs Comparable 2.4배 괴리** — 매도자 기대가격(1,682억)이 Walk-away(870억)의 1.9배 | S5 `02` §8 | **High** | monitored | no | Comparable은 **지불여력이 아니라 매도자 기대가격**으로만 해석. 매도자 희망가격 확인이 DD 비용 투입의 선행조건 — 870억 초과 시 **즉시 Kill 재심** |
| **FR-06** | **financing 증빙 전무** — equity/debt commitment letter, sources-and-uses, funds-flow 전건 부재 | `financing-plan-review` (미실행) · entity-ic-review step 4 | **High** | open | no | 절차상 **판단이 아니라 선결조건 FAIL**이다. 자금조달 우발성(financing contingency)은 입찰경쟁력을 약화시키며 어떤 검토자의 재량 영역도 아니다. `financing-plan-checklist.yaml` 판정 필수 |
| **FR-07** | 몬테카를로 변수 간 상관 미반영 — CAGR·마진 독립추출로 분포 양끝이 얇음 | S5 `03` | **Medium** | open | no | **하방 리스크 과소평가 방향의 편의**로 기록. 상관계수 도입 재시뮬레이션 |
| **FR-08** | 성장률 top-decile 베이스레이트 체크 UNASSESSED — 피어 분포 미확보 | S5 `03` | **Medium** | open | no | **경고가 발화하지 않은 것을 통과로 읽어서는 안 된다.** Base CAGR 22%는 국내 로봇부품사 통상 분포 상단 근처로, 분포 확보 시 경고 발화 개연성이 있다 |
| **FR-09** | 무위험이자율 기준시점 불명 (Rf 3.35%, 조회일 미표기) / 베타 1.35 미삼각측량 | S5 `01` | **Medium** | open | no | 한국은행 ECOS로 2026-08 기준 재확인. WACC은 CAGR보다 민감도가 큰 변수이므로 우선순위 높음 |

## 3. 실행 리스크 (Execution / Technical / Operational)

| ID | 항목 | 출처 | 심각도 | 상태 | Kill 플래그 | 완화방안 |
|---|---|---|:---:|:---:|:---:|---|
| **EX-01** | **현장실사 0건** — tdd-01~07 필수 7항목 전건 미충족. 설비 잔존수명·병목공정·수율·TRL·EHS 노출 전부 미확인 | S6 `02` | **Critical** | open | no | 현장실사 + 증거캡처(사진·계측)를 DD 재개 시 최우선 배정. **"확인했더니 문제없음"과 "확인하지 않음"은 다르다** |
| **EX-02** | **시너지 C의 물리적 실현가능성 미검증** — 병목 캐파·폐수처리 여유 불명 | S6 `02` TDD-F2, R7 | **Critical** | open | no | 캐파 여유 부재 시 캡티브 12%는 **신규 CAPEX를 요구**하며 그 CAPEX는 시너지 PV 220억에서 미차감. 폐수처리 여유 부재 시 **증설 자체가 봉쇄**된다. 물리적 검증 전까지 시너지 C는 0으로 두는 것이 보수적 처리 |
| **EX-03** | **DD 절차 14+ 스텝 중 9건 미수행** — market-dd, antitrust, management-incentive, customer-attrition, incentive-clawback, certification-transferability, financing-plan, org-readiness, compliance-monitoring | S6 `00` | **Critical** | open | no | PM이 antitrust-agent, market-intelligence-agent, hr-integration-agent, customer-retention-agent, incentive-agent, compliance-officer, certification-agent를 **별도 디스패치**. 미판정 체크리스트 3종(market-dd, hr-dd, financing-plan) 판정 |
| **EX-04** | **워크스페이스 인프라 결함(2차 정정)** — `bun` 런타임 부재만 남음. **`DART_API_KEY`·`LAW_API_OC`·`KOSIS_API_KEY`·`CO_NEWBIZ_API_TOKEN`은 2026-08-31 재확인 결과 전부 정상 작동, 이전 "미설정" 판단은 오판** | S6 `00` 유형 B (정정) | **Medium (하향)** | open | no | platform-lead 회부(bun만). 미복구 시 `_validate.ts` 자동검증만 계속 불가 — 원자료 조회 자체는 이미 가능해져 데이터 신뢰도 캡 고착 우려는 완화 |
| **RISK-NEW-1** | **[2차 신규] 지능형로봇전문기업 지정 상실 (REG-F1)** | S6 `04` §0-6 | **High** | open | no | 지능형로봇법 제42조의2①2호·제42조의3①2호. 삼성 계열 편입 시 정부 지원 소멸 가능. DD 질의 1문항으로 확인 가능한 저비용 고가치 항목 — 재개 시 최우선 확인 대상 |
| **RISK-NEW-2** | **[2차 신규] 국내 상장 로봇피어 8사 중 7사 영업적자 — 타깃 EBITDA 마진 가정의 낙관 편향** | S5 `01` DART 실측 | **High** | open | no | 타깃 마진 가정(영업이익률 8.5~9.5%)이 피어 분포 최상단을 초과. QoE 미실시와 결합해 이중 낙관. 권고 인수가 밴드(600~700억) 자체가 무효화될 수 있는 조건 |
| **EX-05** | **PMI 계획 부재** — 보상 조화, 조직 준비도, 고객 이탈 방어 계획 없음 | S6 (hr-dd 미판정) | **Medium** | open | no | 삼성 그룹 편입 시 보상 상향 압력은 **구조적**이며 DS-1에 미포함. hr-integration-agent 디스패치 |
| **EX-06** | **decided_by(승인권자)·임원 스폰서 미지정** — S3 sf-05, S4 route_decision 연속 이월 | S3/S4 | **Medium** | open | no | 기명 임원 스폰서 지정 및 seed budget 통제권 확인. **승인권자가 없는 상태로 IC에 상정하는 것 자체가 절차 결함** |

## 4. 거버넌스·절차 리스크 (메타 리스크)

| ID | 항목 | 심각도 | 상태 | 완화방안 |
|---|---|:---:|:---:|---|
| **GV-01** | **AI 2차(cross-domain) 검증이 S5·S6·S7 3개 스테이지 연속 미실시** | **High** | open | S5·S6 산출물이 전부 functional 도메인 단일 출처다. **AI가 AI를 검토하면 blind spot을 공유하여 상관된 오류가 그대로 통과한다** — 이것이 cross-domain 요구의 존재 이유다. platform-lead / industry-lead / region-lead 디스패치 |
| **GV-02** | **waiver 제도 오용 위험** — 필수 미충족 45건 전부가 형식상 `waiver_eligible: true` | **High** | monitored → **경보** | **waiver는 "확인했으나 충족시킬 수 없는 요건"을 위한 장치이지 "아직 확인하지 않은 상태"를 통과시키는 장치가 아니다.** 유형 A 41건에 waiver를 적용하면 waiver 제도가 DD 면제 수단으로 전락한다. **R1~R8 8건은 어떤 경우에도 waiver 대상에서 제외**할 것을 risk-officer 권한으로 요구한다 |
| **GV-03** | **synergy_score 임계값 미활성** (ADR-0051 open question b) — Screening 게이트 "시너지 점수 합의 기준 충족" 판정기준 자체가 절차적으로 미확정 | **Medium** | open | process-governance-manager에게 임계값 활성화 요청. S3에서 지적된 이래 4개 스테이지 미해소 |
| **GV-04** | **리스크가 스테이지 진행에 따라 감소하지 않고 증가** — S5 리스크 14건 중 해소 0건, S6에서 Critical 2건 신규 추가 | **High** | open | **정상적인 딜 프로세스에서는 DD를 지날수록 미확인 항목이 줄어든다.** 본 건은 반대 방향이며, 이는 프로세스가 진행된 것이 아니라 **미검증 상태가 누적된 것**임을 의미한다 |

## 5. Kill Criteria 에스컬레이션 (stage-gate-governance 회부)

`legal-risk-register` 실행단계 4에 따라, Kill-Criteria 영역으로 격상된 항목을 **명시적으로 에스컬레이션**한다.

| ID | 항목 | 에스컬레이션 사유 |
|---|---|---|
| **LR-01** | 인증 이전가능성 | risk-officer 책임범위상 **"이전 불가능한 필수 인증"은 명시적 kill trigger이며 soft warning이 아니다** |
| **LR-02** | 커버넌트 CoC 가속 | **"downside 시나리오의 커버넌트 breach"는 명시적 kill trigger** |
| **LR-03** | 상방 공급계약 CoC | 과점 공급자 이탈은 **hard partner dependency** 실패에 해당 |
| **LR-05** | drag-along / ROFR | 100% 취득 불가 시 딜 구조 자체가 소멸 |
| **FR-01** | `wacc_hurdle_still_assumed` | ADR-0064 kill #5/#6 — **현재 무장 상태**이며 Financial 차원 스코어링을 차단 |

> **Kill Criteria 트리거는 권고가 아니라 게이트를 차단한다.** 위 5건이 미해소인 상태에서 Entity IC 승인 심의를 진행하는 것은 절차 위반이다.

## 6. Red-team 총평 (risk-officer)

1. **낙관편의 방향의 일관성** — S5 모델의 미반영 항목 3건, 시너지 base-rate 미적용, 몬테카를로 상관 미반영, 성장률 베이스레이트 체크 미실행, 환경 우발채무 누락. **모든 편의가 같은 방향(낙관)을 향한다.** 무작위 오차라면 방향이 섞여야 한다. 이 일관성 자체가 red flag다.
2. **순환논리 경보** — "시너지가 있으므로 딜이 성립한다 → 시너지 C(캡티브 물량)가 근거다 → 그런데 시너지 C는 시너지 A를 잠식하고(DS-2), 경쟁당국의 핵심 우려사항이며(LR-09), 물리적 실현가능성이 미검증이다(EX-02)." **딜을 지탱하는 유일한 기둥이 동시에 가장 큰 리스크의 원천이다.**
3. **경쟁사 대응 시나리오 부재** — S1~S6 어디에도 과점 공급자 및 경쟁 완성품 업체가 본 인수에 어떻게 반응하는지에 대한 분석이 없다.
4. **"검증하지 못한 것" 선언** — 본 레지스터는 대상기업에 관한 **어떤 1차 사실도 검증하지 못했다.** 재무·계약·IP·인허가·설비·환경 전 영역이 그렇다. 본 문서의 심각도 등급은 **"확인된 위험의 크기"가 아니라 "확인되지 않은 채 남아 있는 노출의 크기"**다. 이 구분이 무너지면 본 레지스터는 오독된다.

## 7. Reviewer Sign-off

| 단계 | 검토자 | 일자 | 결과 |
|---|---|---|---|
| AI 1차 | `risk-officer` (functional/governance) | 2026-08-31 | **verified**: 출처 산출물과의 정합성, Kill Criteria 매핑 완결성 · **could not verify**: 전 항목의 1차 사실관계 · **needs judgement**: 심각도 등급 확정, Kill 전환 시점 |
| AI 2차 (cross-domain) | **미배정** — platform-lead / industry-lead / region-lead | — | **미실시** |
| 인간 최종 | **PENDING — 사람 검토 필요** | — | **미실시** |

---

*본 산출물은 의사결정 지원 문서이며 투자자문 또는 법률의견이 아니다. 법률·인증 결론은 원문 대조 및 인증기관·자문사 확인이 필요하며, 인증 이전가능성에 대한 추론은 명시적으로 금지된다.*
