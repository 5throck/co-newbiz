---
stage: S7
gate: "Entity IC / Group IC"
owner_agent: pm
date: 2026-08-31
track: brownfield
reviewed_by: PENDING
---

## 갱신 이력 (2026-08-31, 2차 — API 키 오판 정정)

> S6의 "DART_API_KEY·LAW_API_OC·KOSIS_API_KEY·CO_NEWBIZ_API_TOKEN 미설정"이라는 서술은 **오판이었다** — `.env`에 전부 설정되어 있고 정상 작동함을 재확인했다(device_bash가 매 호출마다 새 셸이라 미로드, `.env` CRLF로 인한 `\r` 오염이 원인). S1/S5/S6 재조회로 국내 로봇산업 통계(KOSIS)·삼성전자 실측 재무(DART)·관련 법령 조문 원문(K-LAW)을 반영했다. **핵심**: WACC·밸류에이션·NPV는 사실상 불변, 다만 (a) 국내 상장 로봇피어 8사 중 7사 영업적자라는 신규 하방 리스크, (b) 지능형로봇전문기업 지정 상실 리스크(REG-F1, R9)가 신규 발견됐다. **여전히 남은 유일한 실제 인프라 갭은 bun 런타임뿐**이다.
> **본 문서의 게이트 판정·RAG·권고는 변경되지 않는다.** API 조회 가능 여부는 애초에 이 딜의 Kill 사유가 아니었다 — VDR·현장·경영진 접근 부재가 핵심 사유이며 이는 그대로다. 다만 아래 §5·§6 및 EX-04(리스크 레지스터)의 "인프라 결함" 서술은 이제 부정확하므로 정정 대상이다.

---


# 00. S7 투자심사·실행 — 완료 요약 (삼성전자 × 로보틱스레인보우, Brownfield)

## S6 → S7 연계 확인

S1~S6 산출물 전체(21개 파일)를 정독 후 이어받았다. 승계된 상태:

- **S6 DD 게이트: 미통과(Fail)** — 필수 미충족 **45건**(ma-10 실질 재판정 시 46건), waiver **0건**, 치명적 이슈 **8건(R1~R8)**. 미충족 45건 중 **41건은 VDR·현장·경영진 접근 부재로 검증 행위 자체가 없었던 항목**이다.
- **S6 제안 RAG: Red** — S5 Amber에서 하향. 사유는 재무 악화가 아니라 **검증 부재의 확인**.
- **S6 권고: S7(IC) 진입 보류.** "IC 패키지 작성 자원 배정은 아직 이르다."

> **본 S7 세션의 성격**: S6가 보류를 권고한 상태에서 S7이 실행되었다. 따라서 본 세션은 **투자 승인을 받기 위한 IC 패키지**가 아니라, **DD 미통과라는 실제 상태를 은폐 없이 IC 심의 형식으로 정리한 문서**를 산출했다. DD 실패를 감추고 승인시키는 것은 본 세션의 목적이 아니며, 실제로 절차적으로도 불가능하다.

## S7 필수 산출물 / 완료 기준 (`docs/process-flow.md` §S7)

| 필수 산출물·완료 기준 | 충족 | 근거 |
|---|:---:|---|
| IC 패키지 | **부분** | [`01-ic-package.md`](./01-ic-package.md) 작성 — 템플릿 구조는 완비하였으나 **내용 요건 미완비**(§아래 완비성 판정) |
| 사람 최종 승인(reviewer 기록) | **미충족** | 전 산출물 `reviewed_by` = **PENDING**. 인간 승인은 본 세션에서 발생할 수 없으며, 승인을 위조하지 않았다 |
| **완료 기준**: Entity IC와 Group IC 승인이 모두 기록되었다 | **미충족** | 양 게이트 모두 미승인 |

**S7 활동 수행 상태**

| Activity | Agent | Skills | 수행 |
|---|---|---|---|
| ic-preparation | `pm` | executive-presentation, sample-driven-report-writing | 수행 — `01-ic-package.md` |
| risk-review | `risk-officer` | legal-risk-register | 수행 — `02-risk-register.md` (19건 등록) |
| group-review | `group-review-agent` | group-level-review | 수행 — `03-group-portfolio-review.md` (step 1 하드 리젝션 확인) |

## IC 패키지 완비성 판정 — **미완비**

`procedures/_shared/entity-ic-review/schema.yaml` 및 `templates/deliverables/ic-memo-template.md` 대비:

| 요건 | 상태 | 비고 |
|---|:---:|---|
| step 1 — RAG 제안 등급 (6차원) | **충족** | 6차원 전건 산정, 제안 종합 **Red** |
| step 2 — Kill Criteria 전건 명시 판정 | **충족** | `01` §5 — **halt 조건 2건 발화** |
| step 3 — IC 메모 (템플릿 준거) | **부분** | 구조 완비. 단 §5 DD findings가 `dd_finding` 레코드로 존재하지 않고(**bun 런타임 부재만 남은 인프라 갭** — API 키는 2차 갱신으로 해소), §6 M&A 6축이 **0/6 완료** |
| **step 4 — financing 준비 점검 (선결조건)** | **FAIL** | equity/debt commitment letter, sources-and-uses, funds-flow, 커버넌트 여유 분석 **전건 부재**. 절차상 *"No committed financing evidence = precondition FAIL, not a judgment call"* |
| step 4.5 — 통합 인사이트 검토 | **부분** | `01` §3에서 시장·재무·법률/규제·M&A 특수논점을 통합했으나, 통합 대상 자체가 미검증 |
| step 4.6 — Entity IC 결정 덱 | **미수행** | docs-writer 미디스패치. 심의 대상이 성립하지 않아 덱 제작이 무의미 |
| step 5 — 인간 결정 기록 | **도달 불가** | kill_criteria `analysis_task_reviewed_by_null_on_required_deliverable` → **halt** |
| M&A 6축 (Brownfield 필수) | **0/6** | antitrust·고객이탈·인센티브·HR·지역노동·인증 전건 미수행 |
| AI 2차 cross-domain 검증 | **미실시** | 3개 스테이지 연속 |

> **판정: IC 패키지 미완비.** entity-ic-review 5스텝 중 **완전 충족 2건, 부분 2건, FAIL 1건, 도달 불가 1건**. 특히 step 4는 재량 영역이 아닌 선결조건이므로, 이 한 항목만으로도 패키지는 완비될 수 없다.

## Gate: Entity IC 판정 — **미통과 (Fail)**

| 판정 기준 | 결과 |
|---|---|
| **IC 패키지가 완비되었다** | **미충족** — 위 완비성 판정 참조. financing 선결조건 FAIL, M&A 6축 0/6, 상위 DD 게이트 미통과 |
| **사람 최종 승인 필수 산출물의 `reviewed_by`가 기록되었다** | **미충족** — 전 산출물 `reviewed_by` = **PENDING**. 본 세션은 인간이 아니며 승인을 대리하거나 위조할 수 없다(비협상 경계 #2) |

| Kill 기준 | 해당 여부 |
|---|---|
| 필수 산출물 미승인 | **해당** — 필수 산출물 전건 미승인 |

**발화한 kill_criteria (entity-ic-review schema)**

| 조건 | action | 상태 |
|---|---|---|
| `analysis_task_reviewed_by_null_on_required_deliverable` | halt | **트리거됨** |
| `kill_criteria_condition_triggered` | halt | **트리거됨** — DD 미통과, `wacc_hurdle_still_assumed`(ADR-0064) 무장 |

> **Entity IC 게이트 판정 결과(제안): 미통과.** 최종 판정은 인간 검토자의 몫이며, 본 세션은 분석과 *제안*만 제공한다.

## Gate: Group IC 판정 — **진입 불가 (하드 리젝션)**

| 판정 기준 | 결과 |
|---|---|
| **Entity IC 승인이 선행되었다** | **미충족** — `approval_chain`에 Entity IC 승인 기록 없음. `group-investment-review` step 1은 **soft warning 경로가 없는 시스템 강제 하드 리젝션**(design §6.4) |
| **그룹 관점 포트폴리오 적합성이 검토되었다** | **부분** — `03-group-portfolio-review.md`가 사전 참고 수준의 검토를 제공하나, 계열사 원자료 미대조 및 `intra-group-transaction-compliance` 미실행으로 정식 검토로 인정 불가 |

| Kill 기준 | 해당 여부 |
|---|---|
| 그룹 수준 반려 | **미해당(형식) / 판정 불가(실질)** — 심의에 상정되지 못했으므로 반려도 발생하지 않았다. **"반려되지 않았음"을 통과로 읽어서는 안 된다** |

**Group IC 순위 산정(step 4)**: 5개 입력 중 3개 미확정으로 산정 불가. 다만 산정 가능한 2개(RAG=**Red**, risk-officer Kill 플래그 **5건**)만으로 본 안건은 자본 배분 우선순위 **최하위군**이다.

> **Group IC 게이트 판정 결과(제안): 진입 요건 미충족.**

## 제안 RAG 등급 — **Red** (인간 확정 대상)

| 차원 | 제안 | 발화 규칙 |
|---|:---:|---|
| Financial | Amber(잠정) | hurdle 미달이나, WACC/hurdle `kind='user'` 미충족으로 **스코어링 자격 자체가 없음** |
| Market | Amber | 고성장 국면이나 원자료 미확보 |
| Data Confidence | Amber | S1 Medium 캡 승계 — **이 한 항목만으로 Green 구조적 불가**(비협상 경계 #4) |
| **Regulatory/Permit** | **Red** | R1 인증 이전가능성 · R8 국가첨단전략기술 · 기업결합신고 미확정 |
| **Technical/Execution** | **Red** | 현장실사 0건, tdd 필수 7/7 미충족 |
| **Risk** | **Red** | Red findings 8건, 필수 미충족 45건, waiver 0건 |
| **종합 (제안)** | **Red** | `Red-if-any-Red` 규칙 발화 + Kill Criteria 트리거 |

> **가격 조정으로는 Red가 해소되지 않는다.** Red의 원인은 인수가가 아니라 검증 부재다.

## 권고 — **Hold (보류)**, 조건 성립 시 **Kill**

- **Approve**: 절차적으로 도달 불가(financing precondition FAIL + reviewed_by NULL halt).
- **Conditional**: **부적절.** conditional은 확인된 사실 위에 이행조건을 붙이는 상태다. 본 건은 확인된 사실 자체가 없어, conditional 처리는 **미검증을 조건부 승인으로 세탁**하는 결과가 된다.
- **Hold**: **권고.** 아래 선행조건을 확정·이행한 뒤 **S6(DD)로 되돌려 재판정**.
- **재상정 상태**: `withdrawn_pending_resubmission`(pilot-003 패턴)이 `rejected`보다 정확하다. 단 아래 Kill 트리거 성립 시에는 `rejected`.

**즉시 Kill 전환 트리거 (하나라도 성립 시)**
1. 매도자 희망가격 > **870억원**(Walk-away) — DD 비용 투입 전 Kill 재심.
2. **R1 인증 이전 불가** 확인 — 인수 프리미엄 근거 전액 소각.
3. **R5 drag-along/ROFR로 100% 취득 불가** 확인 — 딜 구조 자체 소멸.
4. VDR·현장·경영진 접근이 **매도자 사유로 계속 거부** — DD 없는 M&A는 본 절차상 실행 불가.

## 다음 단계 — 재개를 위한 선행조건 (우선순위 순)

### A. 즉시 (DD 재개 착수 이전, 저비용)

1. **NDA 판정 기록 생성 및 `project_classification` 등재**(lr-07) — **이 기록 없이 VDR을 여는 것 자체가 절차 위반이다.**
2. **clean team 프로토콜 수립** — gun-jumping 및 경쟁민감정보 교환 차단.
3. **WACC 13.0% / hurdle IRR 15.0%의 `kind='user'` 인간 확인·등록** — ADR-0064 kill #5/#6 해제. **3개 스테이지 연속 이월된 저비용 항목.**
4. **decided_by(승인권자) 및 기명 임원 스폰서 지정** — S3 sf-05, S4 연속 이월.
5. **매도자 희망가격 확인** — 870억 초과 시 즉시 Kill 재심(DD 비용 투입 전).
6. **워크스페이스 인프라 복구**(platform-lead) — **`bun` 런타임만 남음**(API 키 4종은 2026-08-31 해소 확인). **딜의 문제가 아닌 도구의 문제이며 waiver 대상이 아니다.**

### B. DD 실행 (S6 재수행 — 45건 해소)

7. **VDR 개설 및 현장·경영진 접근 확보** — 유형 A 41건은 이것 없이 단 1건도 해소되지 않는다.
8. **검증 우선순위**: R2/R3(CoC) → R4(IP) → R5(주주동의) → R6(환경 Phase I/II) → R7(캐파·폐수처리) → **R1(인증)은 M5 평가순서상 착수는 선행하되 결론은 마지막에 확정**.
9. **QoE(Quality of Earnings) 실시** — brownfield-fs step 1. 정규화되지 않은 EBITDA 위에 전체 밸류에이션이 서 있다.
10. **미판정 체크리스트 3종 판정**: `market-dd-checklist.yaml`, `hr-dd-checklist.yaml`, `financing-plan-checklist.yaml`. → 현재 "45건"은 **DD 게이트 전체 미충족 건수가 아니라 하한**이다.
11. **미디스패치 전문 에이전트 투입**(PM 소관): `antitrust-agent`(5회 연속 이월), `market-intelligence-agent`, `hr-integration-agent`, `customer-retention-agent`, `incentive-agent`, `certification-agent`, `compliance-officer`.

### C. 모델 재산출 (DD 결과 반영)

12. **S5 상향편의 3건 반영 후 NPV 재산출**: ① 환경 우발채무 ② 시너지 C 증설 CAPEX ③ 보상 조화비용. **셋 모두 NPV를 낮추는 방향이며 현재 어느 것도 모델에 없다.**
13. **시너지에 base-rate 적용** — risk-officer 참조 클래스(계획 대비 50~70% 실현) 적용 시 220억 → 135~189억.
14. **R8(국가첨단전략기술) 양방향 반영** — 혜택 축(정부 지원·인허가 신속처리)과 규제 축(기술 처분 자유도 제한). 현재 어느 쪽도 모델에 없다.
15. **몬테카를로 변수 상관 도입** 및 **성장률 top-decile 베이스레이트 체크** 실행.

### D. 거버넌스

16. **AI 2차 cross-domain 검증 실시** — S5·S6·S7 3개 스테이지 연속 미실시. 본 S7 산출물은 전부 functional 도메인 저작이므로, **`platform-lead`(technical) / `industry-lead`(industry) / `region-lead`(region)** 중 최소 1인, 권고는 3인 전원. **functional 내부 상호검토는 2차 검증으로 인정되지 않는다.**
17. **waiver 오용 방지 확인** — 45건 전부 형식상 `waiver_eligible: true`이나, 유형 A 41건에 waiver를 적용하면 waiver 제도가 DD 면제 수단으로 전락한다. **R1~R8 8건은 어떤 경우에도 waiver 대상에서 제외.**
18. **synergy_score 임계값 활성화**(ADR-0051 open question b) — process-governance-manager 소관, 4개 스테이지 미해소.

## 미해결 한계 (인간 심의 시 반드시 병기)

- 본 S7 산출물은 **대상기업에 관한 어떤 1차 사실도 검증하지 못했다.** 재무·계약·IP·인허가·설비·환경 전 영역이 그렇다.
- 리스크 레지스터의 심각도 등급은 **"확인된 위험의 크기"가 아니라 "확인되지 않은 채 남아 있는 노출의 크기"**다.
- **리스크가 스테이지 진행에 따라 감소하지 않고 증가했다** — S5 리스크 중 S6에서 해소된 것 0건, S6에서 Critical 2건 신규 추가. 정상적인 DD 프로세스와 반대 방향이며, 이는 프로세스가 진행된 것이 아니라 **미검증이 누적된 것**임을 의미한다.
- **본 문서에는 "PASS" 도장이 없다.** 위 "검증 불가"·"미확인"·"판정 불가" 항목의 침묵은 승인으로 읽혀서는 안 된다.

## 검토 단계 상태 (Three-Stage Review)

| 단계 | 상태 |
|---|---|
| AI 1차 (형식·완결성) | **완료** — 본 세션. S1~S6 21개 파일 정독, 게이트 기준 대비 전건 판정 |
| AI 2차 (cross-domain) | **미실시** — platform-lead / industry-lead / region-lead 필요 |
| **인간 최종** | **PENDING — 사람 검토 필요.** 본 세션에서 발생할 수 없으며, 어떤 산출물에도 승인을 대리 기록하지 않았다 |

## 파일 목록

- `01-ic-package.md` — IC 메모(경영진 요약, 딜 개요, S1~S6 종합, RAG 제안, Kill Criteria, M&A 6축, financing 점검, cross-domain 2차 검토 요구사항, 권고) — owner: pm
- `02-risk-register.md` — 통합 리스크 레지스터 19건(법적 12 / 재무 9 / 실행 6 / 거버넌스 4, 중복 계상 포함), Kill 에스컬레이션 5건 — owner: risk-officer
- `03-group-portfolio-review.md` — Group IC 5스텝 실행 결과, step 1 하드 리젝션 — owner: group-review-agent
- `00-summary.md` (본 문서)

---

*본 산출물은 의사결정 지원 문서이며 투자자문 또는 법률의견이 아니다. 밸류에이션·RAG 등급·규제 판단은 인간 검토자와 승인권자의 판단을 돕기 위한 것이며, 책임은 그들에게 있다. 인증 이전가능성에 대한 추론은 명시적으로 금지된다.*
