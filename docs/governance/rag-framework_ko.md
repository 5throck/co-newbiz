---
lang: ko
lang_reason: proper-noun
counterpart: rag-framework.md
---

# RAG 채점 프레임워크 — 상세 규칙

**Owner**: process-governance-manager (financial-analyst, quant-methodologist, risk-officer와 공동)
**Design of record**: design v1.0 §4-2 / 회의 M3 / ADR-0016
**상태**: Stage 3 초안 — 아래 임계값은 회의 M3 결정(D-M3-1~D-M3-4)이며 향후 `rag_rule` 테이블(Stage 5)을 시드할 만큼 구체화되어 있다. 수동 적용은 지금 시작된다.

## 1. 6개 차원

Financial, Market, Data Confidence, Regulatory/Permit, Technical/Execution, Risk. 각 차원의 입력이 어디서 오는지는 `docs/governance/process-map.md` 참조.

## 2. Financial 차원 밴드 (D-M3-1)

| 등급 | 조건 |
|---|---|
| Green | IRR ≥ 허들 + 2.0pp **그리고** 다운사이드 시나리오에서 DSCR ≥ 1.3x |
| Amber | IRR ≥ 허들이나 Green 밴드에는 미달 (두 조건 중 하나 미충족) |
| Red | 베이스 케이스에서 IRR < 허들 |

전제조건: 이 차원을 채점하기 전에 WACC/허들이 `assumption.kind = 'user'`(design §4-1)여야 한다 — 회의 M1이 이것을 Pre-FS 진입 조건으로 확정했으므로 순서는 이미 성립한다.

## 2.5. Regulatory/Permit 차원 — 구조적 vs. 행태적 시정조치

독점규제 또는 규제 시정조치가 단일한 채점 패턴을 갖지는 않는다 — 파일럿 케이스에서 구조적으로 다른 두 실제 형태가 나타났으며 서로 다르게 채점해야 한다:

- **행태적 시정조치**(지속적인 컴플라이언스 의무 — 예: `docs/pilots/pilot-001-hd-hyundai-stx-heavy-industries.md`의 3년 공급/가격 조건): 의무의 **전체 기간 동안** Amber로 채점한다. 중도에 해소 이벤트는 없다 — 의무는 여전히 활성(Amber)이거나 만료(재평가)된다.
- **구조적 시정조치**(일회성 클로징 조건 — 예: `docs/pilots/pilot-008-delivery-hero-woowa-brothers.md`의 의무 매각): 조건이 **열려 있는 동안**은 Amber로 채점하되(실제 클로징 리스크 존재 — 예: 매각 인수자 탐색 실패 가능), **조건의 해소가 확인되면** Green으로 재채점 가능하다 — 행태적 시정조치와 달리 해소 후 모니터링할 것이 남지 않기 때문이다.

두 형태에 동일한 채점 패턴을 적용하지 말 것 — 해소된 구조적 시정조치와 활성 행태적 시정조치는, 둘 다 "조건부 승인"에서 비롯되었더라도 동일한 리스크가 아니다.

## 3. Data Confidence 차원과 상한 (D-M3-2, D-M3-3)

| 체인 신뢰도 등급 | 데이터 신뢰도 등급 |
|---|---|
| A | Green |
| B | Amber |
| C, 또는 staleness-gate 위반 | Red ("판단 보류") |

**전체 RAG 규칙은 우선순위 순이며 가중평균이 아니다** (D-M3-3, 이것이 프레임워크에서 가장 하중이 큰 단일 규칙이다 — ADR-0016 참조):

```
overall = RED   if any dimension is RED, OR a Kill Criteria condition is triggered
overall = GREEN if all six dimensions are GREEN (including data confidence)
overall = AMBER otherwise
```

데이터 신뢰도는 구조적으로 상한을 제한한다. Green 규칙이 요구하는 6차원 중 하나이기 때문이다 — B등급 프록시 체인(confidence = Amber)이 있으면 나머지 5개 차원이 아무리 강해도 전체 Green은 불가능하다.

## 4. 히스테리시스 (D-M3-4)

| 전환 | 트리거 |
|---|---|
| 승격 Amber → Green | IRR ≥ 허들 + 2.0pp, 1회의 완전한 run 사이클 동안 지속(단일 일일 fetch가 아님) |
| 강등 Green → Amber | IRR < 허들 + 0.5pp |
| 최소 보유 기간 | 7일, `run` 타임스탬프 기준 — 같은 날짜에 수동으로 재실행한 2회의 run은 보유 기간을 충족하지 않음 |

## 5. 스테이지 게이트 임계값 적용 범위

design §4-2에 따라 임계값은 `stage_gate`별로 선언되며 위 밴드는 완전한 재무 모델이 존재하는 FS부터 적용된다. Screening과 Pre-FS는 축소된 점검을 사용한다(재무 차원은 완성된 모델이 있을 때까지 기본 Amber-capped; 나머지 5개 차원은 정상 채점).

## 5-1. 스테이지 게이트 임계값 적용 범위 — Market 차원 (Decision 6, 초안)

`market` 차원의 **증거 레이어가 착지했다**(migration 0017, PR-6): `project_variable_snapshot` 테이블, 최초의 채점 변수 시드(9개 시장/right-to-win 변수 + `market.link_fit_quality`), 그리고 `_threshold_placeholder` 스칼라와 함께 `enabled=0`으로 스테이징된 5개의 `market-dd-*` 규칙 행 — 임계값 회의가 채워 넣는 안변경(tamper 방지) 골격이다. **임계값 회의가 이제 완료되었다**: 승인 기록 `docs/decisions/market-thresholds.md`(2026-08-23)가 모든 숫자, 필러, `switching_cost_grade` CHECK enum(migration 0019로 착지), 그리고 `competitive_intensity`의 단독 변수 영구 금지를 소유한다; migration 0019는 스테이징된 5개 행을 그 자리에서 최종 확정하고 기록이 요구한 3개 행을 추가했다(screening/pre-FS TAM-성장 게이트 분할과 `market-dd-right-to-win-absent`). **활성화가 착지했다**(migration 0022, PR-9): 7개의 non-green market 행이 기록 그대로의 `policy_id` + `thresholds_source`와 함께 `enabled=1`이 되었고 `db/lib/rule-assessment.ts`가 run마다 채점한다(§5-3); green `market-dd-right-to-win` 행만 `enabled=0`으로 남는다 — Decision 9의 Green 상한은 보정 이후에야 해제된다. 이 소절은 design의 Decision 6(2026-08-22 RAG 정식화 설계, §1.1)에서 합의된 단계적 규칙을 §5의 `financial` 처리와 같은 패턴으로 문서화한다.

| 스테이지 게이트 | 규칙 |
|---|---|
| Screening | `market`은 기본 Amber-capped. `TAM`과 `growth_rate`만 평가되며 `fact_industry`에서 소싱. 나머지 시장 축(교섭력, 경쟁 강도, 전환 비용, 진입 장벽, right-to-win)은 평가되지 않은 채 유지. |
| Pre-FS | `TAM`/`growth_rate`는 증거에 기반해야 함(단순 존재가 아니라 `evidence_ref` 필수, non-null 값만으로는 불충분). 이 단계에서 완전한 6축 `value_chain_link` 증거는 아직 기대하지 않음. |
| DD | 완전한 6축 `value_chain_link` 증거가 활성화되고 Amber 상한이 해제됨. |

이것은 재무 차원의 단계적 접근(§5)을 따른다: 완성된 증거 기반이 없는 차원은 Green 등급을 낼 수 없지만 가용 증거가 뒷받침하는 곳에서는 Amber/Red 신호가 여전히 살아 있다.

### 수정된 증거 매핑 (Decision 6)

design의 회의 검토는 원래 계획의 매핑 오류를 수정했다(design 문서의 "뒤집힘 4" 참조): `value_chain_link.concentration_hhi`는 상하류 교섭력(인접 공급망 계층의 산업 집중도)을 측정하지, 수평적 경쟁 강도를 측정하지 않는다 — 둘은 반대 방향을 가리킬 수 있으며 이를 혼동하면 조용히 잘못 채점된다. 수정된 매핑:

- `concentration_hhi` → `bargaining_power`(원래 의미), **`competitive_intensity` 아님**.
- `competitive_intensity`는 **신규이며 아직 소싱되지 않은** 변수다 — `concentration_hhi`가 아니라 `fact_industry` 관례 또는 `dimension_input`에서 소싱될 예정.
- `switching_cost_grade`는 migration 0019부터 CHECK 제약 enum(`negligible`\|`low`\|`moderate`\|`high`\|`very_high`, D-M-MKT-2)이므로 그 위의 `in` 술어는 오타에 안전하다; `substitution_threat`는 migration 0020부터 CHECK 제약 — D-M-MKT-2 부칙으로, `switching_cost_grade`의 멤버를 따르는 5멤버 순서형이 구현 제안으로 착지했고(저장소 전역 스캔에서 기존 어휘를 발견하지 못함) 2026-08-23 `docs/decisions/substitution-threat-vocabulary.md`로 **비준**되었다(의장: process-governance-manager). 아직 이 컬럼을 읽는 규칙은 없으며 최초로 읽는 규칙이 그 기록을 어휘 출처로 인용할 수 있다.
- `value_chain_link`에서 소싱되는 변수는 `r2 >= 0.6`을 요구한다(`gradeChain()` 자체의 신뢰도 임계값과 동일) — 그 미만이면 변수는 존재하는 것으로 취급되지 않고 저신뢰로 제외된다. missing-vs-저신뢰 구분이 이제 스키마 수준에 존재한다: `project_variable_snapshot.status`는 네 번째 멤버 `low_confidence`를 갖는다(migration 0017 — design DDL은 세 상태만 스케치했지만 Decision 6 본문이 이 구분을 요구했다). 강제가 착지했다: `db/lib/snapshot-filler.ts`(필러 PR)가 기록들의 변수 계약에 따라 run마다 시드된 22개 채점 변수를 모두 기록한다 — r2 0.6 미만의 arg-max 링크는 값은 유지한 채 `market.bargaining_power_hhi`를 `low_confidence`로 기록하고, `market.link_fit_quality`는 하한 미만이어도 정직하게 `present`로 기록된다. market 규칙은 migration 0022(PR-9)부터 활성화되어 `db/lib/rule-assessment.ts`가 run마다 평가한다(§5-3).

## 5-2. Technical/Execution 및 Risk 차원 — 단계적 증거 레이어 (PR-7)

`technical_execution`과 `risk` 차원의 **증거 레이어가 착지했다**(migration 0018, PR-7): 11개의 추가 `evidence_var` 시드 — market의 주장형 판단 변수와 달리 모두 `computed`인데, 모든 소스가 기존 테이블/컬럼이기 때문이다(`dd_finding`, `certification`, `permit`+`permit_edge`, `contingent_liability`, `covenant_test`, `partner_candidate`) — 그리고 8개의 `tech-dd-*` / `risk-dd-*` 규칙 행이 `enabled=0`으로 스테이징되었다(`technical_execution` ×4, `risk` ×4, 리스크 안건의 Decision-8 축에 따라: 안건이 스케치한 두 형태 모두의 우발부채, 커버넌트 위반, 파트너 소싱 실패 — 원래 매핑이 완전히 누락했던 risk-officer kill 트리거). **임계값 기록들이 이제 착지했다**: `docs/decisions/technical-execution-thresholds.md`와 `docs/decisions/risk-thresholds.md`(모두 2026-08-23, 기존 `docs/decisions/open/` 안건 대체), 그리고 migration 0019가 스테이징된 8개 행을 모두 기록들의 매핑 테이블로 그 자리에서 최종 확정했다(모든 어휘 컬럼의 CHECK enum 포함) + 3개의 technical Red 행을 추가했다(`tech-dd-trl-pre-validation`, `tech-dd-ip-disputed`, 새로운 `cert.load_bearing_non_transferable_on_coc` 변수와 함께 `tech-dd-cert-load-bearing-loss`). **활성화가 착지했다**(migration 0022, PR-9): 11개 행 모두 기록들 그대로의 `policy_id` + `thresholds_source`와 함께 `enabled=1`이 되었고, `db/lib/rule-assessment.ts`가 run마다 채점한다(§5-3).

별도의 줄을 둘 가치가 있는 두 가지 경계 선언:

- **`antitrust_finding`은 전제상 `risk`에서 제외된다**(리스크 안건 §2.1): 이미 `regulatory_permit`에 반영되며 하나의 발견을 6차원 중 두 곳에서 세면 전체 등급이 단일 증거에 과도하게 민감해진다. 번복에는 별도의 ADR이 필요하며 절대 임계값 결정으로 처리하지 않는다.
- **이 차원들에 대한 완전한 게이트 사다리는 아직 문서화되지 않았다** — 의도적이다. Market의 §5-1 사다리는 design의 Decision 6이 그렇게 결정했기 때문에 존재한다; technical/risk의 경우 2026-08-23 기록들이 screening→pre_fs→fs 사다리가 아니라 규칙별로 스테이지 게이트를 배정했다(모든 technical 행은 `dd`; risk 파트너 소싱 행은 `pre_fs`로 재확인, D-M-RISK-7), 그리고 술어의 fail-closed `is_null` 처리를 넘어선 게이트별 미증거 처리는 여전히 활성화 작업(PR-9)이지 확정된 사다리가 아니다.

## 5-3. 규칙 평가 경로 (PR-9 활성화)

`db/lib/rule-assessment.ts`(`assessRulesForRun`)은 단계적 레이어들이 기다리던 규칙 평가 소비자다. run마다 다음을 수행한다:

1. run의 `project_variable_snapshot`을 채운다(`snapshot-filler.ts` 1.1.0 — live `project_industry` 바인딩이 기본 fact-family 산업 세트),
2. 스테이지 게이트의 **활성화된** 규칙을 로드하고(우선순위 순) ADR-0046 술어 엔진(Kleene 의미론)으로 스냅샷에 대해 각 `condition_expr`을 평가한다,
3. 각 차원을 **우선순위 최초 일치 우선**으로 채점한다(D-M-RISK-5, PR-9에서 확정): 차원 등급은 최고 우선순위 TRUE 규칙의 등급이다 — Red 규칙이 더 낮은(우선하는) 우선순위 번호를 가지므로 Red 우위는 구조적이다(D-M-RISK-4 레이어 2, D-M-TE-8),
4. **평가된** 차원마다 `rag_assessment` 행을 하나 기록한다 — TRUE 규칙이 없고 UNASSESSED 규칙이 하나라도 있으면 차원은 UNASSESSED이며 **행을 기록하지 않는다**(기본값 Amber는 절대 영속화되지 않음),
5. 모든 규칙이 결정론적으로 FALSE인 경우 **Decision 9 Green 상한 하의 Amber**로 채점한다 — 보정 전에 절대 Green이 아니며 상한이 영속화된 근거에 명시된다.

런타임 가드는 마이그레이션 수준의 가드를 따른다: green 채점 규칙이 차원에서 이기면 Green을 내는 대신 **throw**하고(Decision 9 / D-M-MKT-11.2), market/technical_execution/risk 밖의 차원을 대상으로 하는 활성 규칙은 조용히 건너뛰는 대신 throw한다. `financial`/`data_confidence`/`regulatory_permit`은 기존 채점기를 유지한다(`rag-engine.ts`) — 이들은 술어 규칙이 아니다 — 그리고 여기서 overall 행은 구성하지 않는다(ADR-0049 §2: 불완전한 평가는 overall 등급을 내지 않는다). Run은 불변이다(ADR-0005): 스냅샷 복합 PK 때문에 같은 run을 두 번 채점하면 throw한다.

## 5-4. Kill-Criteria 평가 경로 (ADR-0057)

kill-criteria 레지스트리에 이제 런타임 소비자가 있다: `db/lib/kill-criteria.ts`(`evaluateKillCriteria`)는 프로시저의 **활성화된** 레지스트리 항목을 run의 `project_variable_snapshot`에 대해 §5-3과 동일한 ADR-0046 술어 엔진으로 평가한다(동일한 변수 강제; fill-once 구성, 지원 순서는 평가-전-판정). ADR-0057의 의미론: TRUE ⇒ 해당 항목의 action과 함께 `triggered`; **UNASSESSED ⇒ `unassessed`에 나열되고 호출자가 결정** — kill criteria에 적용된 ADR-0049 정직 규칙(증거의 부재는 깨끗한 판정이 아니며 기본 halt도 없다); FALSE ⇒ 결정론적으로 미트리거. 읽기 전용 — 위 §1의 줄("...Kill Criteria 조건이 트리거되면 overall = RED")은 게이트 플로우 배선이 평가 기록을 소비할 때까지 인간 게이트 라우팅 규칙으로 유지된다; 그 기록이 이제 존재한다: `db/repositories/kill-criteria.repository.ts`(`recordKillCriteriaEvaluation`, ADR-0058 §1)가 기준별 완전 원장을 `kill_criteria_evaluation`에 영속화하고(migration 0023 — triggered/false/unassessed 모두 기록, 앵커 스냅샷; 의도적으로 compliance_check도 gate_pass_record도 아님), 게이트 플로우 리더도 함께 착지했다: `getRecordedEvaluation`(같은 저장소, 1.1.0)가 원장을 게이트 영향 요약(`halt`/`mark_conditional`/`escalate_to_risk_officer`/`unassessed`/`evaluated_false`)으로 묶으며 명시적 `never_evaluated` 상태를 갖는다 — 요청된 범위에 행이 0개인 것은 절대 빈 것처럼 보이는 통과가 아니다(읽기 시점의 ADR-0049). 사실만: 트리거된 기준이 게이트를 막는지는 여전히 인간 게이트의 판단이다(불가침 경계 #2). 두 ADR-0055 항목(커버넌트 halt, D-M-RISK-2; 파트너 mark_conditional, D-M-RISK-3)은 `policy_id: gd-0022-risk-thresholds`와 함께 활성화되어 있다 — 레지스트리 상태 29 declared / 2 executable / 2 enabled(ADR-0052 §A/§B 딜 형태 체인과 PMI 항목 6개가 2026-08-23 inert로 합류), 활성-비앵커 상태에 대한 로드 시점 안변경 검사가 throw한다.

## 6. 보정 (Stage 3 후속)

회의 M3의 액션 아이템 A-3: 위 밴드들을 라이브 게이팅에 신뢰하기 전에 5-10건의 과거 의사결정에 대해 보정 드라이런을 수행한다. 이것은 `docs/planning/transition-plan.md`에 따른 엔터티 온보딩이 보정에 충분한 과거 케이스를 만들어낼 때 실행된다 — Stage 3 후속으로 추적되며 그때까지 밴드를 수동으로 사용하는 것을 막지 않는다(수동 적용은 보정 데이터셋이 존재하기 전에 인간이 모든 등급을 샌ity-체크하게 만든다).

**두 가지 다른 보정 경로, 하나가 아님** — `docs/pilots/pilot-004-sk-group-capital-rebalancing.md` 발견 F-1: 독점규제 스크리닝 인접 단계(RAG의 Regulatory/Permit 차원, `brownfield-dd`의 antitrust 단계)는 실제 공개 규제 결정에 대해 백테스트가 가능하다 — 파일럿 001-003이 정확히 이것을 했다. `group-investment-review`의 그룹 아젠다 랭킹 단계(단계 4: 허들 초과 IRR 스프레드 + 등급 + 요청 자본)는 **할 수 없다** — 그 입력은 어떤 그룹도 그 세밀함으로 공개적으로, 영원히 공개하지 않는 내부 자본배분 수치다. 이 단계의 보정은 팀 자신의 내부 과거 케이스를 기다려야 한다; 다른 단계와 달리 공개 케이스 대체 경로가 존재하지 않는다.

## 7. 시드 데이터 형태 (Stage 4/5 선행 참조)

위 규칙들은 `rag_rule` 테이블(design §4-2 스키마)이 존재하게 되면 직접 인코딩 가능하도록 작성되었다: 여기의 각 행은 `(stage_gate, dimension, grade, condition_expr, priority)` 튜플이 된다. Stage 3에서는 스키마 작업이 없다 — 이 섹션은 Stage 4의 SRS가 회의 논쟁록에서 임계값을 다시 도출하는 대신 확정된 소스를 참조할 수 있도록 존재한다.

## 8. 관련 문서

- `docs/governance/process-map.md` — RAG 평가가 스테이지 게이트 플로우에서 차지하는 위치.
- `docs/manuals/business-manual.md` §3 — 인간 리뷰어가 등급을 읽는 방법.
- `memory/meeting-2026-08-20-m3-rag-criteria.md` — 출처 회의와 전체 논의.
