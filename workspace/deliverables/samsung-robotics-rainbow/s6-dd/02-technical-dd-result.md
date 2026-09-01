---
stage: S6
gate: DD
owner_agent: technical-dd-agent
date: 2026-08-31
track: brownfield
---

# 02. Technical DD 판정 결과 — `checklists/technical-dd-checklist.yaml` (chk-technical-dd v1.0.0)

> 절차 근거: `procedures/_shared/brownfield-dd/schema.yaml` **step 2** (agent: technical-dd-agent, skills: `technical-due-diligence` + `site-visit-protocol`, output_type: `dd_finding`). `site-infrastructure-assessment` 적용 판단은 §3.
> 단위: 억원(KRW 100M).

## 0. 실행 전제 — 현장실사 미실시

**로보틱스레인보우 생산현장에 대한 방문이 이루어지지 않았다.** 사전 문서요청 리스트 발송, 현장 관찰, 증거 캡처(사진·계측·로그) 중 어느 것도 수행되지 않았다. `technical-dd-agent.md` Constraints는 "현장실사 시 증거 캡처를 생략하지 말 것 — 증거 없는 관찰은 IC 심의를 통과하지 못한다"고 규정하는데, 본 세션에는 **관찰 자체가 없다**. tdd-01/02가 다른 6개 항목의 사실상 선행조건이므로, 이 두 항목의 미충족은 나머지 전 항목으로 전파된다.

## 1. 체크리스트 항목별 판정 (전 8항목, 원문 그대로)

| ID | 항목 원문 | 필수 | waiver 가능 | **판정** | 근거 |
|---|---|:---:|:---:|:---:|---|
| **tdd-01** | Site visit conducted with pre-visit document request list and on-site observation checklist | **필수** | Y | **미충족** | 현장실사 미실시. 사전 문서요청 리스트 미발송, 관찰 체크리스트 미작성. `site-visit-protocol` 스킬 자체가 실행되지 않았다 |
| **tdd-02** | Evidence captured during site visit (photo, measurement, log) — observations without captured evidence do not survive IC scrutiny | **필수** | Y | **미충족** | tdd-01 미실시의 직접 귀결. 캡처된 증거 **0건** |
| **tdd-03** | Technology readiness level (TRL) assessed for core production processes | **필수** | Y | **미충족** | 핵심 생산공정(정밀 감속기 치형 가공·열처리·조립 정밀도 관리, 액추에이터 권선·자석 조립)의 TRL 미평가. **본 건에서 TRL은 밸류에이션에 직결된다** — S5 Base CAGR 22%는 대상기업이 양산 수율을 유지하며 캐파를 확장할 수 있다는 전제인데, 그 전제의 기술적 근거가 검증되지 않았다 |
| **tdd-04** | Bottleneck processes identified | **필수** | Y | **미충족** | 병목공정 미식별. 정밀감속기는 통상 치형 연삭(grinding)·열처리 후 정밀도 안정화가 병목이며, 이 병목이 곧 S3 시너지 C(캡티브 물량 흡수 여력)의 물리적 상한을 결정한다 — **시너지 C의 12% 증분 물량 가정이 캐파 상 실현 가능한지 자체가 미검증** |
| **tdd-05** | Remaining useful life of key equipment assessed | **필수** | Y | **미충족** | 주요 설비 잔존수명 미평가. SKILL.md Step 4는 "대상기업이 제시한 설비연한만으로 판단 금지, 현장 관찰 기반"을 요구하는데 제시 자료조차 없다 |
| **tdd-06** | EHS liability exposure assessed | **필수** | Y | **미충족** | EHS 우발채무 미평가. 정밀가공·열처리 공정은 **절삭유·세척용제(유기용제)·열처리 염욕** 취급으로 토양·지하수 오염 이력 가능성이 구조적으로 존재한다. 한국의 경우 「토양환경보전법」상 토양오염관리대상시설 양수인에게 정화책임이 승계될 수 있다(`region-profiles/KR.yaml` `environmental_liability_succession`) — **100% 주식양수 구조에서는 오염 이력이 그대로 인수된다.** S5 몬테카를로의 우발채무 4건(CL-1~4)에 **환경 항목이 아예 없다**(S5 `03` §7-2가 스스로 "조세·환경·노동 우발채무는 DD 이전 식별 불가"로 기록) → 하방분포가 이 항목만큼 과소추정되어 있다 |
| **tdd-07** | Capex plan independently verified against physical/technical findings, not accepted from management as-is | **필수** | Y | **미충족** | S5 `02` §1의 CAPEX/매출 5.5% 가정은 **경영진 제시조차 아닌 산업 평균 가정치**다. 물리적 실사 대조 없음. SKILL.md Step 6은 이 항목을 "실제와 계획 간 중대 갭이 가장 잘 드러나는 스텝"으로 규정 — 본 건은 그 스텝을 건너뛴 상태로 EV의 100%가 산정되었다 |
| tdd-08 | Certification status of key production lines confirmed (feeds certification-agent, not duplicated here) | 권고 | Y | **미충족** | 생산라인 인증 현황 미확인. 본 항목은 certification-agent 추적으로의 **교차참조**이나, `brownfield-dd` step 11(certification-transferability, legal-counsel)도 미수행이므로 참조 대상 자체가 없다 → `03-legal-dd-result.md` §4, `04-regulatory-antitrust-review.md` §4 참조 |

**Technical DD 소계**: 필수 7항목 **전건 미충족**. 권고 1항목도 미충족.

## 2. Technical 관점 findings (분석 기반, 실사 미기반)

| # | Finding | RAG(제안) | 근거 | value_impact 경로 |
|---|---|:---:|---|---|
| TDD-F1 | **환경 우발채무가 리스크 모델에서 통째로 누락**되어 있다. 정밀가공·열처리 공정 + 토양환경보전법상 양수인 정화책임 승계 가능성에도 불구, S5 몬테카를로 우발채무 목록(CL-1~4)에 환경 항목 없음 | **Red** | `region-profiles/KR.yaml` `environmental_liability_succession`, tdd-06 | S5 하방분포(P10 520) **상향편의** — 신규 CL-5 등재 필요 |
| TDD-F2 | **시너지 C(캡티브 물량 매출 12%, PV 219.8억)의 물리적 실현 가능성 미검증** — 병목공정 캐파 여유가 없으면 증분 물량은 신규 CAPEX를 요구하고, 그 CAPEX는 시너지 PV에서 차감되지 않았다 | **Red** | tdd-04, tdd-07 | 시너지 PV 220억의 일부 또는 전부 |
| TDD-F3 | CAPEX/매출 5.5% 가정이 실사 미대조 — 설비 노후도에 따라 유지보수 CAPEX가 급증할 수 있다 | Amber | tdd-05, tdd-07 | FCFF 직접 |
| TDD-F4 | 핵심 생산공정 TRL 미평가 → Base CAGR 22%의 기술적 실현가능성 미확인 | Amber | tdd-03 | 성장가정 전체 |

## 3. `site-infrastructure-assessment` 적용 판정

`skills/site-infrastructure-assessment/SKILL.md`는 `procedure_keys: [greenfield-fs, greenfield-pre-fs, greenfield-screening]`이며 owner는 `greenfield-agent`, 대상은 **"candidate Green Field sites"**다. 본 건은 track=brownfield의 기존 가동 사업장 인수이므로 **절차적으로는 해당없음**이다.

다만 스킬의 실질(폐수처리 → 전력 → 공업용수 → 물류접근 순의 필수 최소요건 심사)은 브라운필드 사업장의 **증설 여력 판정**에 그대로 유효하며, 본 건에서는 시너지 C의 캐파 확장 가능성과 직결된다. 따라서 **적용 취지만 차용해 아래 항목을 미확인 리스트로 등재**한다 — 이는 스킬의 정식 실행이 아니며, 그렇게 주장하지 않는다.

| 인프라 축 | 브라운필드 증설 관점 확인사항 | 상태 |
|---|---|:---:|
| 폐수·배출 처리 용량 (ss-01 상당) | 현 배출허용량 대비 여유분 — **부재 시 증설 자체가 봉쇄**되므로 최우선 | **미확인** |
| 전력 수전 용량·인입 리드타임 (ss-02 상당) | 정밀가공·열처리는 전력집약 — 증설 시 수전용량 증설 리드타임이 임계경로 | **미확인** |
| 공업용수 (ss-03 상당) | 절삭·세척 공정 용수 | **미확인** |
| 도로·물류 접근 (ss-04 상당) | 중량물 반출입 | **미확인** |

> **판정**: 4개 축 전건 미확인. 특히 폐수 처리 여유가 없을 경우 **시너지 C는 신규 부지 확보 없이는 실현 불가**하며, 이는 시너지 PV 220억의 전제를 붕괴시킨다. 이 리스크는 현재 어떤 산출물에도 반영되어 있지 않다.

## 4. S5 이월 리스크에 대한 Technical DD의 검증 결과

| S5 리스크 | Technical DD 검증 결과 |
|---|---|
| EBITDA 마진 지속가능성(민감도 1위) | **검증 불가** — 수율·불량률·설비가동률 원자료 없음. 마진의 기술적 기반(수율)이 미확인인 채로 남았다 |
| 시너지 제외 시 NPV 음수 | **악화 방향의 신규 발견** — TDD-F1(환경 우발채무 누락), TDD-F2(캐파 CAPEX 미차감)는 모두 NPV를 추가로 낮추는 방향이며, 어느 것도 S5 모델에 반영되어 있지 않다 |
| 인증 이전가능성(CL-3, 확률 15% 추론치) | **검증 불가** — tdd-08 미충족. 비협상 경계 #5상 추론 금지 항목이며 15% 분포는 여전히 잠정 |

## 5. 검증 가능성 구분

| 구분 | 항목 |
|---|---|
| **검증됨** | 없음 — 대상기업 설비·공정에 관해 본 워크스트림이 물리적으로 확인한 사실은 **0건** |
| **검증 불가** | TRL, 병목, 설비 잔존수명, EHS 노출, CAPEX 계획 타당성, 라인 인증현황, 인프라 증설여력 — 체크리스트 및 §3 전 항목 |
| **판단 필요** | 환경 우발채무(CL-5)의 확률·금액 분포를 실사 없이 잠정 등재할 것인지 vs 미등재로 두고 분포 상향편의를 명시만 할 것인지(본 문서는 **후자**를 택하고 편의를 명시했다 — 근거 없는 수치를 몬테카를로에 주입하면 정밀성의 외관만 만들어지기 때문) |

Based on stated assumptions / Not investment advice, not a legal opinion.
