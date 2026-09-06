---
lang: ko
lang_reason: proper-noun
counterpart: process-map.md
---

# 프로세스 맵 — co-newbiz 신사업 검토

**Owner**: process-governance-manager
**Design of record**: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) 섹션 6, [Stage 1 회의](../../memory/archive/meeting-2026-08-20-m1-process-skeleton.md) M1/M2/M6에서 구체화.

> **이 문서를 제품 빌드 Phase 0–6과 혼동하지 말 것** (design 섹션 4/10). 이 문서는 팀의 시스템이 구현하는 *비즈니스 검토 프로세스*를 매핑한다. 제품 빌드 페이즈는 팀이 그 시스템을 어떻게 만들고 출시하는가에 관한 것이고, 이 맵은 만들어진 시스템이 실제로 무엇을 수행하는가에 관한 것이다.

## 스테이지 게이트 시퀀스

```
Screening → Pre-FS → FS → DD → Entity IC → Group IC
```

**스테이지 체인 (flow.spec v2.2.0, ADR-0106)**: S1 시장분석 → S2 기회 발굴 → S3 시너지·적합성 → S4 진출방식 결정 → S5 역량 평가·진출전략(GF) / S6~S7 대상 후보 발굴·스크리닝(BF) → S8 사업성 분석 → S9 실사·검증 → **S10 투자구조 설계** → S11 투자심사·실행 → S12 사후 관리. 스테이지는 작업 구간이며, 게이트(Screening~Group IC, id 변경 없음)는 그 사이에 위치한다. Stage ≠ Gate이며, 기존 ADR들은 v2.2.0 이전 번호를 유지한다(ADR-0106이 매핑의 기준).

**딜 구조화 스테이지 (S10, ADR-0045/0106)**: DD 게이트와 Entity IC 사이에서 `procedures/_shared/deal-structuring/`에서 딜 구조가 설계된다 — 스포(직접 투자 / SPC / holdco / 사내 벤처 스핀오프 / JV)와 4개 필수 축(세무 구조, 책임 격리, 재무 레버리지, 엑시트 구조)이 아티팩트 참조 4축 리뷰와 함께 `deal_structure_hypothesis`에 기록되며, 재무계획(`financing_sources_uses`, migration 0075)은 수지 균형(sources == uses > 0)을 충족해야 한다. S11 IC 패키지는 이 구조를 포함하여, 위원회가 S10이 산출한 것을 승인하도록 한다. Pre-FS 단계의 가설은 이 스테이지가 성숙시키는 초기 초안으로 남는다.

## 게이트별 산출물, 승인자, RACI

| 게이트 | 산출물 | 차단 조건 (Kill Criteria 후보) | 승인자 | R | A | C | I |
|---|---|---|---|---|---|---|---|
| **Screening** | GF: 시장 규모 + 부지 쇼트리스트. BF: 타깃 롱리스트(origin-gated — internal origin은 롱리스트 단계만 면제) + 예비 HHI 스크린(`target.has_external_market_presence`라는 팩트에 근거하며 origin 라벨로 판정하지 않음 — 2026-08-22 design Decision 5e; 두 `applies_when` 술어 모두 `db/lib/applies-when.ts`가 평가). | GF: 필수 인프라 최소 기준을 통과하는 부지 후보가 0건(폐수 처리 용량이 대표 케이스 — 전력보다 먼저 확인). | process-governance-manager | greenfield-agent / brownfield-agent | pm | industry-lead, region-lead | risk-officer |
| **Pre-FS** | GF: 인프라 리드타임/비용 추정 + 인센티브-NPV 부지 비교. BF: 딜 구조 가설. WACC/허들 IRR이 `kind=user`로 확정. | WACC/허들 IRR이 여전히 `assumed` — 잠정 할인율로는 FS를 시작할 수 없음. BF 논거에 결정적인 인증 이전 가능성이 미확정. | process-governance-manager | valuation-agent, quant-methodologist | pm | certification-agent, legal-counsel | risk-officer |
| **FS** | GF: 인가 크리티컬 패스를 포함한 전체 capex 일정. BF: 전체 밸류에이션, 6방향 M&A 교차검증 *착수*. | risk-officer 서명 없이 상위 10% 기저율을 벗어나는 성장 전망. | process-governance-manager | financial-analyst, market-intelligence-agent | pm | quant-methodologist | risk-officer |
| **DD** | 상업 + 기술 DD 완료. BF: 6개 M&A 밸리데이터 전부 커버 — 완료된 컴플라이언스 행, 또는 적용성 레지스트리가 적용하지 않는 밸리데이터에 대한 live `not_applicable` 스킵 행 (brownfield-dd 단계 6-11, ADR-0048). | DD 종료 시점에 6개 BF 밸리데이터(antitrust, hr-comp, customer, incentive, contingent-liability, certification) 중 APPLICABLE인 것이 하나라도 누락 — **워이버 경로 없음**, 이는 완전성 검사이며, 레코드는 6 declared / N applicable / M completed. | process-governance-manager | commercial-dd-agent, technical-dd-agent | pm | brownfield-agent | risk-officer |
| **Entity IC** | IC 메모, RAG 평가(에이전트가 제안, 인간 리뷰어가 확정). | 필수 산출물 중 하나라도 `analysis_task.reviewed_by`가 NULL. | Entity IC (인간) | process-governance-manager | Entity IC | valuation-agent, risk-officer | group-review-agent |
| **Group IC** | `group_agenda` 랭킹 항목. `approval_chain`에 기록된 Entity IC 승인 완료가 선행. | Entity IC 승인이 아직 기록되지 않음 — 그룹 레벨 프로시저는 시스템이 강제로 접근 불가. | Group IC (인간) | group-review-agent | Group IC | process-governance-manager | pm |

## Green Field vs. Brown Field 분기

| | Green Field | Brown Field |
|---|---|---|
| 주 리스크 축 | 인프라, 인허가, 인재, 지역사회 | 딜 구조, 우발부채, 6밸리데이터 완전성 — 6 declared / N applicable / M completed로 기록 (분류 인지, ADR-0048) |
| Screening 단계 하드 필터 | 인프라 최소 기준(폐수가 전력에 선행) | 예비 독점규제 스크린(개략적 HHI) |
| 고유 필수 밸리데이터 | site-infrastructure-assessment, talent-pipeline-planning, community-partnership-planning | antitrust, hr-comp(임원 CoC 보상), customer(CoC 유지), incentive clawback, contingent-liability, certification-transferability — 단계 6-11의 여섯 가지 (ADR-0048 레지스트리가 분류별 적용 여부 결정) |
| 부지/타깃 비교 | 2단계: 하드 사전 필터 → 가중 점수(인프라 30 / 인센티브-NPV 25 / 물류 15 / 노동력 15 / 인허가 크리티컬 패스 15%) | 딜 구조 가설 → 순차적 특수주제 연계를 갖춘 밸류에이션 |

## 인증·인허가 트랙 (병렬, 미통합)

인허가(`permit`/`permit_edge`)와 인증(`certification`/`certification_edge`)은 **별도의 크리티컬 패스를 가진 별도의 DAG**로 운영된다 — 인허가는 운영을 가능하게 하고, 인증은 판매를 가능하게 한다. [용어집: 선급](../../glossary/industry.yaml) 및 design 섹션 8.8-1 참조.

## RACI 범례
R = Responsible(작업 수행), A = Accountable(결과에 대한 책임, 단일 이름), C = Consulted(의사결정 전 쌍방향 입력), I = Informed(의사결정 후 통보).

## 게이트 프로시저

위 시퀀스의 모든 게이트는 이제 정식 `procedures/_shared/*/schema.yaml`을 갖추고 있다(2026-08-20 완료, 파일럿 001-004의 발견을 반영 — `docs/pilots/` 참조):

| 게이트 | Green Field | Brown Field |
|---|---|---|
| Screening | `procedures/_shared/greenfield-screening/` | `procedures/_shared/brownfield-screening/` |
| Pre-FS | `procedures/_shared/greenfield-pre-fs/` | `procedures/_shared/brownfield-pre-fs/` |
| FS | `procedures/_shared/greenfield-fs/` | `procedures/_shared/brownfield-fs/` |
| DD | `procedures/_shared/greenfield-dd/` | `procedures/_shared/brownfield-dd/` (6밸리데이터 무워이버 완전성 검사, 단계 14; 밸리데이터는 ADR-0051에 따라 단계 6-11) |
| Entity IC | `procedures/_shared/entity-ic-review/` (공유 — 양쪽 동일 형태) | |
| Group IC | `procedures/_shared/group-investment-review/` (공유 — 양쪽 동일 형태) | |

Entity IC와 Group IC의 의사결정 모델은 모두 네 번째 상태인 `withdrawn_pending_resubmission`을 갖는데, 이는 `docs/pilots/pilot-003-doosan-bobcat-robotics.md` 발견 F-2에 따라 추가된 것으로, 기존 3상태(approved/rejected/conditional) 모델이 표현할 수 없었던 실제 사건의 철회 후 재제출 패턴이다.

**병렬 진입 체인 — 딜 형태 선택 (ADR-0052 §A)**: `procedures/_shared/deal-shape-chain/`은 위의 시장 기반 체인과 병행되는 두 번째 진입 경로로, 인수 이전에(또는 인수 대신) 파트너를 원하는 역량 격차 해소를 위한 것이다: P0 필요도·퍼널 → P1 파트너십 스크린 → P2 파트너 DD → P3 딜 형태 선택 → P4 계약(형태 키 프리사이닝 게이트, `checklists/deal-shape-presigning-checklist.yaml`) → P5 출시 후 리뷰. 완전 M&A 결과는 변경 없이 brownfield 체인으로 OUT 라우팅된다; P3 결정이 분류 축을 *기록*하므로(ADR-0047 §A.5) 이 체인 자체는 `applies_when`을 갖지 않는다 — 분류가 존재하기 전에 실행되기 때문이다.

**클로즈 후 체인 — PMI (ADR-0052 §B)**: Brown Field 인수가 완료되는 경우, `procedures/_shared/pmi-integration-execution/`이 Group IC 이후의 새로운 `post_close` 게이트 슬롯에서 signing → close → integration → BAU를 담당한다: pre-close(IMO, 통합 논거, 클린 팀, 단계별 시너지 목표) → day-1(연속성, 통제 인수인계) → 첫 100일(캐던스, 약속 대비 실적 시너지, 30/60/90 이탈) → BAU exit — 인간 Finance 인증(`bau-exit-certifier`); 미인증 시너지 런레이트는 인수인계를 중단시킨다. 비지배 인수는 ADR-0045의 지분 축에 따라 범위가 한정된 축소 페이즈 세트(pre-close + day-1 + 모니터링만)를 실행한다.

**설립 후 라이프사이클 — JV 거버넌스 (ADR-0052 §C)**: `procedures/_shared/jv-lifecycle-governance/`(`applies_when: origin = joint`)는 `entity-establishment-execution`이 의도적으로 멈추는 지점(단계 5 완료 확인, JV 부칙 ef-13..17)부터 엑시트까지의 긴 기간을 담당한다: 운영(이사회 승인 거버넌스 프레임워크, reserved-matters 맵, 3유형 CoI 프로토콜, 정상가격 거래) → 모니터링(7개 차원 건강도 스코어카드; 지정 임원 책임, 포트폴리오 게임보드, 소급 검토 등 모회사 측 규율을 싣는 연례 전략 자산 리뷰) → 재구성(지표 연동 트리거, 6개 항목 메뉴, 시간 제한 교착 상승 사다리) → 엑시트(설립 시 ef-16 엑시트 조항을 실행하는 5단계 실무 — 설립 시 설계되고 여기서 실행됨). 단계 1–2는 상시 캐던스로, 3은 연례로, 4–5는 트리거 시 실행 — 일회성 게이트가 아닌 페이즈다. 스코어카드 저장(스키마 추가)은 ADR-0052 열린 질문 (e)이며, 섹션 E 포트폴리오 스크립트의 선행 조건이다.

**FS 정량 디스패치 + R&BD 게이팅 (ADR-0052 §D)**: 양쪽 FS 프로시저 모두 이제 `quant-methodologist`를 디스패치한다 — 밸류에이션에서 `monte-carlo-simulation`(시드 고정 P50/P95 NPV + value-at-risk, `distributional_valuation`; 프록시 체인 신뢰도는 수요 드라이버 분산으로 반영), 리스크 평가에서 `scenario-planning`(다운사이드/베이스/업사이드 + 금리 충격 커버넌트 테스트, `scenario_risk_assessment`)으로, 두 트랙 모두에서 해당 에이전트의 제로 디스패치 상태를 해소했다. R&BD 트랙의 게이트별 TRL/MRL 증거 매트릭스(기준 회의 전까지 cutoffs는 ILLUSTRATIVE), GAO-20-48G 증거 품질 규칙(명명된 테스트/환경/아티팩트, 논챔피언 리뷰어), 단계적 자금의 리얼옵션 규율은 `checklists/rbd-technology-checklist.yaml` v1.3.0 (rbd-08..rbd-15)에 있다 — 참조 프로시저를 통해 pre-FS/DD에서 강제되고, 다른 게이트에서는 `gate_pass_record` 완전성 검사를 통해 강제된다; 기술 베팅의 게이트 어휘는 Go/Kill에 Hold/Recycle을 추가한다.

**포트폴리오 모니터링 — 벤처 셀 (ADR-0052 §E)**: `procedures/_shared/portfolio-venture-monitoring/`(그룹 레벨, `applies_when: origin in [internal, hybrid, joint]`)은 벤처 성격 셀(5/6/7/8/9/10)에 IC 이후 가시성을 제공한다: 리뷰 사이클별 재무/전략 이분 스코어카드 롤업, 스테이지 전환 증거 패키지(트랜치 선행조건, 출자-책임 의무, 시간 제한 창, 6옵션 엑시트 경로 평가: integrate / standalone / spinout / reduce ownership / divest / kill), 그리고 인간의 트랜치 + kill/graduate 결정(`venture-portfolio-ic` — kill은 조용한 방치가 아니라 학습을 수집하는 거버넌스화된 결정이다). 스크립트 뷰(스테이지 진행 원장, 자본 대비 마일스톤 비교)는 스코어카드 저장 스키마를 기다린다 — ADR-0052 열린 질문 (e), 가장 리드타임이 긴 체인.

## 관련 문서
- `skills/stage-gate-governance/SKILL.md` — 게이트 시퀀스와 6개 항목의 구속력 있는 Kill Criteria 목록을 운영 스킬로 정리한 것
- `docs/stage-gates.md` *(이 문서의 짝 문서 — 아직 미생성 — Stage 2.4)*
- `docs/audits/2026-08-23-readiness-audit.md` — 위 프로시저들의 4축 준비성 감사(판정 + 잔여 레지스터 R1–R10)
- `docs/pilots/` — 위 게이트 프로시저에 반영된 4건의 실제 케이스 수동 파일럿
- [회의 M1](../../memory/archive/meeting-2026-08-20-m1-process-skeleton.md), [M2](../../memory/archive/meeting-2026-08-20-m2-entity-group-boundary.md), [M6](../../memory/archive/meeting-2026-08-20-m6-site-selection-criteria.md)
