---
stage: S6
gate: DD
owner_agent: pm
date: 2026-08-31
track: brownfield
---

# 00. S6 실사·검증(DD) — 완료 요약 (삼성전자 × 로보틱스레인보우, Brownfield)

## S5 → S6 연계 확인

S1~S5 산출물 전체(16개 파일)를 정독 후 이어받았다. 승계된 결론과 조건:

- **S5 FS 게이트 상태**: 내용 요건 충족, **절차 요건 미충족**(brownfield-fs 15스텝 중 3스텝만 수행). 제안 RAG **Amber**, 권고 인수가 밴드 **600~700억원**, Walk-away **870억원**.
- **S5가 S6에 명시 지정한 최우선 워크스트림 3건**: ① EBITDA 마진 지속가능성, ② 인증 이전가능성, ③ 커버넌트.
- **승계 제약**: S1 데이터 신뢰도 **Medium 캡**(비협상 경계 #4)이 S6 결론의 RAG 상한을 계속 지배.

## S6 완료 기준 대비 판정 (`docs/process-flow.md` §S6)

| 필수 산출물·완료 기준 | 충족 | 근거 |
|---|:---:|---|
| DD 체크리스트 판정(필수 항목 해소) | **부분** | 5개 체크리스트 **전 56항목을 빠짐없이 판정**했다(생략 0건) — 판정 행위 자체는 완료 |
| **완료 기준**: 적용 체크리스트의 모든 항목이 판정되고 **필수 미충족이 0건**이다 | **미충족** | **필수 미충족 45건** |

## Gate: DD 판정 — **미통과 (Fail)**

`docs/process-flow.md` Gate: DD 판정기준 대비:

| 판정 기준 | 결과 |
|---|---|
| 필수 체크리스트 항목이 모두 충족/해당없음/예외 처리되었다 | **미충족** — 필수 50항목 중 충족·해당없음 5건, **미충족 45건**, 예외(waiver) 처리 0건 |
| 미해소 필수 미충족이 0건이다 | **미충족 — 45건** |

| Kill 기준 | 해당 여부 |
|---|---|
| waiver 불가능한 필수 항목 미충족 지속 | **현시점 미해당(단서 있음)** — 체크리스트 5종의 모든 필수 항목이 `waiver_eligible: true`이므로 "waiver 불가능"에 해당하는 항목은 형식상 존재하지 않는다. **그러나 이것을 Kill 회피 근거로 읽어서는 안 된다** — ma-12(인증 이전가능성)는 waiver_eligible이지만 비협상 경계 #5가 **추론 자체를 금지**하고 있어, 실질적으로 waiver로 넘길 수 없는 항목이다(§waiver 판단 참조) |

> **DD 게이트 판정 결과(제안): 미통과.** 최종 판정은 인간 검토자의 몫이며(비협상 경계 #2), 본 세션은 분석과 *제안*만 제공한다.

## 판정 집계

| 체크리스트 | 전체 항목 | 필수 | 필수 충족 | 필수 해당없음 | **필수 미충족** | 권고 미충족 |
|---|---:|---:|---:|---:|---:|---:|
| chk-commercial-dd | 7 | 5 | 0 | 1 (cdd-07) | **4** | 2 |
| chk-technical-dd | 8 | 7 | 0 | 0 | **7** | 1 |
| chk-legal-dd | 22 | 21 | 1 (ldd-21) | 0 | **20** | 0 (ldd-22 해당없음) |
| chk-legal-regulatory | 7 | 6 | 1 (lr-04) | 0 | **5** | 0 (lr-06 해당없음·잠정) |
| chk-ma-special-topics | 12 | 11 | 2 (ma-03, ma-10) | 0 | **9** | 1 |
| **합계** | **56** | **50** | **4** | **1** | **45** | **4** |

> **ma-10은 "형식 충족·실질 불완전"**이다(우발채무 4범주 중 environmental·unfunded pension 누락). 게이트 심의자가 실질 미충족으로 재판정하면 필수 미충족은 **46건**이 된다.

## 미해소 필수 미충족 45건 — 전체 목록

**Commercial (4)**: cdd-01 고객집중도 · cdd-02 이탈률 · cdd-03 가격전가력 · cdd-06 finding의 assumption_key/value_impact 연결

**Technical (7)**: tdd-01 현장실사 · tdd-02 증거캡처 · tdd-03 TRL · tdd-04 병목공정 · tdd-05 설비잔존수명 · tdd-06 EHS 노출 · tdd-07 CAPEX 독립검증

**Legal DD (20)**: ldd-01 법인격 상태 · ldd-02 자본구성표 · ldd-03 주주동의/ROFR·drag-along · ldd-04 서명권한 · ldd-05 차입제한·방어수단 · ldd-06 상위20 계약 CoC 스캔 · ldd-07 주식/자산딜 승계 분할 · ldd-08 여신·담보 동의 · ldd-09 소송·조사 · ldd-10 IP 권리귀속 체인 · ldd-11 라이선스 · ldd-12 IP 담보·연차료·분쟁 · ldd-13 직무발명/PIIA · ldd-14 노조·퇴직급여 · ldd-15 인허가 이전 분류 · ldd-16 환경 이력 · ldd-17 부동산 권원 · ldd-18 개인정보 · ldd-19 반부패·제재 · ldd-20 조세

**Legal-Regulatory (5)**: lr-01 인허가 경로 DAG · lr-02 인증 요건·이전가능성 · lr-03 region profile `_validate.ts` 실행 · lr-05 전 상대방 제재 스크리닝 · lr-07 NDA 판정 기록

**M&A Special Topics (9)**: ma-01 관련시장·HHI · ma-02 다관할 신고요건 · ma-04 경영진 보상 CoC · ma-06 보상 벤치마크 · ma-07 CoC 3축 스캔 · ma-08 고객·공급자 집중도/이탈 · ma-09 인센티브 클로백 · ma-11 커버넌트 breach·CoC 가속 · ma-12 인증 이전가능성

## 미충족의 성격 — 게이트 심의 시 반드시 구분할 것

45건은 **성질이 서로 다른 3종**이다. 동일하게 취급하면 판단을 그르친다.

| 유형 | 건수 | 내용 | 해소 경로 |
|---|---:|---|---|
| **A. 실사 미착수** | **41** | VDR·현장·경영진 접근이 전무하여 **검증 행위 자체가 없었다**. "확인했더니 문제가 있다"가 아니라 "아직 확인하지 않았다" | 실제 DD 실행 — waiver 대상이 아님 |
| **B. 워크스페이스 인프라 결함** | **2** (lr-03, cdd-06) | `bun` 런타임 부재로 `_validate.ts` 실행 불가, `CO_NEWBIZ_API_TOKEN` 미설정으로 `dd_finding` 레코드 생성 불가 | **인프라 조치**(platform-lead) — 딜의 문제가 아니므로 waiver로 처리해서는 안 됨 |
| **C. 절차 기록 누락** | **2** (lr-07, ma-02 일부) | 실질 위반은 없으나 요구되는 판정·확인 기록이 생성되지 않음 | 즉시 기록 생성으로 해소 가능(저비용) |

> **A 41건이 본질이다.** 본 S6는 정확히 말하면 **"DD를 수행한 결과"가 아니라 "DD를 수행할 수 없었음을 확인하고, 무엇을 확인해야 하는지를 확정한 결과"**다. 이 문서를 DD 완료로 읽는 것은 심각한 오독이다.

## 갱신 이력 (2026-08-31, 2차 — API 키 오판 정정 + K-LAW 원문 대조 반영)

> **정정**: 아래 본문의 "DART_API_KEY·LAW_API_OC·KOSIS_API_KEY·CO_NEWBIZ_API_TOKEN 전부 미설정"이라는 서술은 **오판이었다.** `.env`에 네 값 모두 실제로 설정되어 있고 정상 작동함을 확인했다(DART: 삼성전자 공시 조회 성공, K-LAW: 관련 법령 조문 원문 조회 성공, KOSIS: 국내 로봇산업 통계 조회 성공). 원인은 device_bash가 매 호출마다 새 셸이라 `.env`가 자동 로드되지 않고, `.env`가 CRLF라 `\r` 오염으로 무응답했던 것 — 딜 결함도 워크스페이스 인프라 결함도 아니라 **에이전트의 환경변수 로드 절차 오류**였다.
> S1(KOSIS)·S5(DART)·S6 법률(K-LAW) 각 산출물을 재조회로 갱신했다. 핵심 변동: (1) S1 국내 로봇산업 데이터신뢰도 Medium→High, (2) S5 WACC는 사실상 불변(13.0%, 피어실측 반영해도 3bp 차이) but 국내 상장 로봇피어 8사 중 7사가 영업적자라는 신규 하방 리스크 발견, (3) S6 법률DD는 조문 원문 대조를 완료해 issue-spotting 등급을 벗어났고 **신규 Red finding(REG-F1: 지능형로봇전문기업 지정 상실 리스크)**을 발견. 상세는 `01-commercial-dd-result.md`는 변경 없음, `03-legal-dd-result.md` 및 `04-regulatory-antitrust-review.md`의 갱신 이력 섹션 참고.
> **여전히 남아있는 유일한 실제 인프라 갭은 bun 런타임 부재(`_validate.ts` 자동검증 미실행)뿐이다.** API 키 관련 갭은 전부 해소.
> **DD 게이트 판정 자체는 변경되지 않는다 — 여전히 미통과.** 법령 조회가 가능해졌다고 VDR·현장·경영진 접근 없이는 확인할 수 없는 41개 항목(유형 A)이 해소되는 것은 아니다. 다만 미충족 항목의 "성격"은 한 번 더 이동했다: 법령 미확인 → 대상기업 사실 미확인으로.

---

## 치명적 이슈 (Red findings, 9건, 2차 갱신)

| # | 이슈 | 출처 | 왜 치명적인가 |
|---|---|---|---|
| R1 | **인증 이전가능성 미확인** (ma-12, lr-02) | `04` §3.4·§4 | 이전 불가 시 인수 프리미엄 전액 소각 가능. **비협상 경계 #5상 추론 금지** → waiver로 넘길 수 없는 실질을 가진 항목. S5 CL-3 확률 15%는 무근거이며 0% 또는 100%로 붕괴 |
| R2 | **차입 CoC 가속조항 미확인** (ldd-08, ma-11) | `03` LDD-F1 | 100% 주식양수는 전형적 CoC 트리거. 클로징 시점 즉시 상환의무 전환 가능. S5가 UNASSESSED로 이월한 항목이 S6에서도 미해소 |
| R3 | **상방 공급계약 CoC 미확인** (ldd-06, ma-07) | `03` LDD-F2 | 정밀감속기 과점 공급자의 계약 해지·단가 재협상 → 마진(민감도 1위 변수) 직격 |
| R4 | **IP 권리귀속 체인 미검증** (ldd-10, ldd-13) | `03` LDD-F3 | 감속기 치형·제어 IP가 곧 기업가치. 직무발명 승계 약정 부재 시 귀속 다툼 + 보상금 청구 동시 발생 |
| R5 | **소수주주 drag-along/ROFR 미확인** (ldd-03) | `03` LDD-F4 | 100% 완전인수의 **실행가능성 자체**가 불확정 |
| R6 | **환경 정화책임 승계 노출** (ldd-16, tdd-06) | `02` TDD-F1, `03` LDD-F5 | 정밀가공·열처리 공정 + 「토양환경보전법」 양수인 승계 + 주식양수 구조. **S5 몬테카를로 우발채무 목록에 환경 항목이 아예 없어 하방분포가 상향편의** |
| R7 | **시너지 C의 물리적 실현가능성 미검증** (tdd-04, tdd-07, §인프라) | `02` TDD-F2 | 병목 캐파 여유 없으면 캡티브 물량 12%는 신규 CAPEX를 요구하며, 그 CAPEX는 시너지 PV 220억에서 차감되지 않았다. 폐수처리 여유 부재 시 증설 자체 봉쇄 |
| R8 | **국가첨단전략기술 규제 신규 식별** (§3.1) | `04` §3.1 | **휴머노이드 로봇 구동부가 국가첨단전략기술로 지정**(3.3m/s·20kg 요건). 대상 사업(액추에이터·감속기 모듈)이 정면 해당 가능. 인수 후 **기술의 해외 이전·매각·합작에 정부 승인 필요** → S3 시너지 D(수직계열화 옵션가치)가 규제만큼 감쇄. S1~S5 어디에도 없던 **신규 리스크** |
| R9 | **[2차 신규] 지능형로봇전문기업 지정 상실 리스크 (REG-F1)** | `04` §0-6 | 지능형로봇법 제42조의2①2호(상호출자제한기업집단 배제)·제42조의3①2호(지정취소)에 따라, 대상기업이 현재 이 지정 및 관련 정부 지원금을 보유 중이면 삼성 계열 편입 즉시 지정취소된다. 계약 스캔으로는 발견되지 않는 축(상대방이 사인이 아니라 법률 그 자체). S5 매출·EBITDA 전제에 정부 지원분이 섞여 있다면 인수 직후 그만큼 소멸 |

## S5 지정 최우선 워크스트림 3건의 S6 결과

| S5가 지정한 DD 최우선 항목 | S6 결과 |
|---|---|
| ① EBITDA 마진 지속가능성 | **미검증** — cdd-03(가격전가력), tdd-03/04(수율·병목) 전건 미충족. 양방향 압박 구조(상방 과점 공급자 + 하방 그룹 단가정책)는 **재확인되었으나 실증되지 않았다** |
| ② 인증 이전가능성 | **미검증** — R1. 추론 금지 원칙에 따라 잠정 결론조차 기재하지 않았다 |
| ③ 커버넌트 | **미검증** — R2. UNASSESSED 상태 그대로 |

**→ S5가 DD의 존재 이유로 지목한 3건이 모두 미해소다.** 이것이 DD 게이트 미통과 판정의 실질적 근거다.

## S5 리스크에 대한 DD 검증 결과 (지시된 3건)

| S5 리스크 | DD 검증 결과 |
|---|---|
| **그룹 내부거래 역시너지 (DS-2, PV −127억)** | **구조적 성립은 재확인, 정량치는 미검증.** 상업 축(`01` CDD-F1)에서 시너지 C가 시너지 A를 자기잠식하는 구조를 재확인. **법률 축에서 신규 발견**: 인수 후 삼성전자-대상기업 간 거래는 공정거래법상 **부당지원행위·특수관계인 부당이익제공** 규율 영역에 들어간다 — DS-2는 상업 리스크이자 **규제 리스크**다. 나아가 경쟁법 심사에서는 동일한 행위가 **투입물 봉쇄(input foreclosure)** 쟁점이 된다(`04` §2). **본 딜의 핵심 시너지가 곧 경쟁당국의 핵심 우려사항**이라는 구조가 확인되었다. `skills/intra-group-transaction-compliance` 미실행 → 후속 필수 |
| **시너지 제외 시 NPV 음수 (700억에서 −68억)** | **악화 방향의 신규 발견 3건.** ① 환경 우발채무 누락(R6), ② 캐파 CAPEX 미차감(R7), ③ 보상 조화비용 미계상(ma-06 — 삼성 그룹 편입 시 상향 압력이 구조적이나 DS-1에 미포함). **셋 모두 NPV를 추가로 낮추는 방향이며 어느 것도 S5 모델에 반영되어 있지 않다.** 즉 "시너지 없으면 성립 불가"라는 S5 결론은 **낙관적으로 서술된 하한**이다 |
| **WACC/DART 데이터 미확인** | **(2차 갱신) 해소.** API 키는 전부 정상 작동함이 확인되어 DART 실측 재무데이터로 WACC를 재검증했다(13.0% 유지, 차이 3bp). 다만 **WACC/hurdle의 `kind='user'` 확정은 여전히 미완료**로, Pre-FS kill criterion `wacc_hurdle_still_assumed`(ADR-0064 kill #5/#6)는 계속 무장 상태 — 이건 인프라 문제가 아니라 **사람의 명시적 확정이 필요한 절차 요건**이라 재분류한다. 유일하게 남은 실제 인프라 갭은 `bun` 런타임 부재뿐 |

## Waiver 필요 여부 판단

체크리스트 5종의 **모든 필수 항목이 `waiver_eligible: true`**이므로 형식상 45건 전부 waiver 신청이 가능하다. **그러나 본 세션은 어떤 항목에 대해서도 waiver를 신청하지 않으며, 신청을 권고하지도 않는다.** 사유:

1. **waiver는 "확인했으나 충족시킬 수 없는 요건"을 위한 장치이지, "아직 확인하지 않은 상태"를 통과시키는 장치가 아니다.** 유형 A 41건은 전부 후자다. 여기에 waiver를 적용하면 waiver 제도 자체가 DD 면제 수단으로 전락한다.
2. **유형 B 2건(lr-03, cdd-06)은 딜의 사정이 아니라 도구의 사정**이다. 인프라 복구로 해소되어야 하며 waiver 대상이 아니다.
3. **R1(ma-12)은 형식상 waiver 가능하나 실질적으로 불가능**하다 — 비협상 경계 #5가 추론을 명시적으로 금지하므로, 확인 없이 "수용 가능"으로 넘기는 판단 자체가 설계 위반이다.

> **결론: waiver 신청 0건. 필요한 것은 waiver가 아니라 실제 DD 실행이다.** 만약 게이트 심의자가 시간 제약으로 일부 waiver를 검토한다면, 최소한 **R1~R9 9건은 waiver 대상에서 제외**할 것을 권고한다. `skills/waiver-management`에 따른 정식 절차와 인간 승인이 전제되어야 함은 물론이다.

## 절차 적합성 점검 (`procedures/_shared/brownfield-dd/schema.yaml`, 14+ steps)

| Step | Agent / Skill | 본 세션 수행 여부 |
|---|---|---|
| 1 commercial-dd | commercial-dd-agent / commercial-due-diligence | **판정만 수행** — 실사 미실시 (`01-commercial-dd-result.md`) |
| 2 technical-dd | technical-dd-agent / technical-due-diligence | **판정만 수행** — 현장실사 미실시 (`02-technical-dd-result.md`) |
| 3 R&BD 체크리스트 | technical-dd-agent | **해당없음** — technology_track이 rbd가 아님(모듈 사업 인수) |
| 4 market-dd | market-intelligence-agent / competitive-intelligence | **미수행** — `checklists/market-dd-checklist.yaml`(mdd-*) 미판정. **본 지시 범위 밖이나 DD 게이트 필수 스텝** |
| 5 legal-dd | legal-counsel / legal-due-diligence | **판정만 수행** (`03-legal-dd-result.md`) |
| 6 antitrust | antitrust-agent / antitrust-screening | **미수행** — HHI 미산정. legal-counsel이 규제축을 통합 검토했을 뿐(`04`) **antitrust-agent를 대신하지 않았다**. S1~S4에서 4회 이월된 항목 |
| 7 management-incentive-review | hr-integration-agent | **미수행** |
| 8 customer-attrition-risk | customer-retention-agent | **미수행** |
| 9 incentive-clawback-assessment | incentive-agent | **미수행** |
| 10 debt-and-contingent-liability-simulation | valuation-agent | 부분 — S5 `03`에서 선행 수행되었으나 4범주 중 2범주 누락 |
| 11 certification-transferability | legal-counsel | **미수행** — R1 |
| 12 financing-plan-review | valuation-agent | **미수행** — `checklists/financing-plan-checklist.yaml` 미판정 |
| 13 org-readiness-assessment (HR DD) | hr-integration-agent | **미수행** — `checklists/hr-dd-checklist.yaml` 미판정 |
| 14+ compliance-monitoring | compliance-officer | **미수행** |

> **DD 절차 14+ 스텝 중 실질 수행 3건(판정 등급), 부분 1건, 미수행 9건, 해당없음 1건.** 게이트를 절차적으로 닫을 수 없다.

## 미판정 체크리스트 (본 지시 범위 밖이나 DD 게이트 필수)

- `checklists/market-dd-checklist.yaml` (step 4)
- `checklists/hr-dd-checklist.yaml` (step 13)
- `checklists/financing-plan-checklist.yaml` (step 12)

**→ 위 3종 미판정 상태이므로, 본 문서의 "필수 미충족 45건"은 DD 게이트 전체의 미충족 건수가 아니라 하한이다.**

## AI 2차 검증 상태 (Three-Stage Review)

- **AI 1차(형식·완결성)**: 본 세션에서 수행 — 56항목 전건 판정, 생략 0건.
- **AI 2차(교차도메인)**: **미실시.** 본 S6 산출물 4건은 전부 **functional 도메인**(commercial-dd-agent / technical-dd-agent / legal-counsel)에서 나왔다. 설계상 **다른 도메인**(technical/industry/region 리드 또는 risk-officer)의 2차 검증이 필요하며, functional 내부 상호검토는 2차 검증으로 인정되지 않는다. **S5에서 동일 지적이 있었고 S6에서도 해소되지 않았다.**
- **인간 최종**: 미실시 — 본 문서는 심의 제출용이다.

## 제안 RAG 등급 (인간 확정 대상)

| 차원 | 제안 등급 | 근거 |
|---|:---:|---|
| DD 완결성 | **Red** | 필수 미충족 45건, 절차 14+ 스텝 중 9건 미수행 |
| 법률·규제 | **Red** | R1~R5, R8, R9. 조문 원문 대조는 완료(2차 갱신)했으나 대상기업 사실 미확인은 그대로 — 오히려 R9 신규 발견으로 리스크 항목 증가 |
| 기술·EHS | **Red** | 현장실사 0건, 환경 우발채무 모델 누락 |
| 상업 | **Red** | 검증된 사실 0건 |
| 데이터 신뢰도 | **Amber (상한)** | S1 Medium 캡 승계 — 3개 스테이지 연속 원자료 미확보 |
| **종합 (제안)** | **Red** | DD 미착수 상태. 데이터 신뢰도 캡(비협상 경계 #4) 이전에 **완결성 자체가 Red** |

> S5의 제안 등급은 Amber였으나, **S6에서 Red로 하향**된다. 사유는 재무 결과의 악화가 아니라 **검증 부재의 확인**이다.

## 권고 (인간 게이트 심의자 앞)

1. **DD 게이트 미통과 판정, S7(IC) 진입 보류.** IC 패키지 자원 배정(게이트의 자원결정 항목)은 아직 이르다.
2. **실제 DD 착수 선행조건**: (a) NDA 판정 기록 생성 및 project_classification 등재(lr-07) — **이것 없이 VDR을 여는 것 자체가 위반**, (b) clean team 프로토콜 수립(gun-jumping·정보교환), (c) 워크스페이스 인프라 복구(**bun 런타임만 남음 — API 키 4종은 2026-08-31 해소 확인**).
3. **DD 착수 시 우선순위**: R1(인증) → R2/R3(CoC) → R4(IP) → R5(주주동의) 순. 단, `ma-special-topics` 평가순서 규칙상 **인증(R1)은 다른 검증이 끝난 뒤 마지막에 확정**해야 하므로, 착수는 선행하되 **결론 확정은 마지막**에 둔다.
4. **매도자 희망가격 확인이 여전히 선행**: 870억원 초과 시 DD 비용 투입 전 Kill 재심(S5 조건 b).
5. **antitrust-agent, market-intelligence-agent, hr-integration-agent, customer-retention-agent, incentive-agent, compliance-officer** 별도 디스패치 필요 — PM 소관.
6. **국가첨단전략기술 규제(R8)를 밸류에이션에 반영**: 혜택 축(정부 지원·인허가 신속처리)과 규제 축(기술 처분 자유도 제한) 양방향. 현재 어느 쪽도 모델에 없다.

> 본 게이트의 최종 판정(Pass/Fail/Hold)과 투자 결정은 **인간 검토자의 몫**이며, 본 세션은 분석·근거·*제안* 등급만 제공한다(비협상 경계 #2). **본 문서에는 "PASS" 도장이 없다** — 위 "검증 불가"·"미확인" 항목의 침묵은 승인으로 읽혀서는 안 된다.

## 파일 목록

- `01-commercial-dd-result.md` — chk-commercial-dd 7항목 판정 (owner: commercial-dd-agent)
- `02-technical-dd-result.md` — chk-technical-dd 8항목 판정 + 인프라 축 (owner: technical-dd-agent)
- `03-legal-dd-result.md` — chk-legal-dd 22항목 + chk-legal-regulatory 7항목 판정, findings register (owner: legal-counsel)
- `04-regulatory-antitrust-review.md` — 기업결합신고·전략기술·인증축 + chk-ma-special-topics 12항목 판정 (owner: legal-counsel)
- `00-summary.md` (본 문서)

Based on stated assumptions and public sources / Not investment advice, not a legal opinion.
