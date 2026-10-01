---
lang: ko
lang_reason: source-material
---

# ADR-0147 — 매출의 질 4축 평가(cdd-08)와 고객 집중도·이탈률의 단일 계산 소유 원칙

- Status: Proposed
- Date: 2026-10-01 (제안)
- Open Points: OP-1~OP-3은 2026-10-01 사용자(사람 검토자)가 결정해 본문에 반영했다. ADR 자체의 수락(Accepted)은 아직 기록되지 않았다
- Deciders: 사용자 지시에 따라 New Business Review Lead (PM)가 초안 작성. **수락은 사람 검토자의 결정** — ADR은 AI 검토만으로 통과할 수 없다(프로젝트 `CLAUDE.md` "Review Model")
- Design of record: 외부 설계 문서 [2026-08-19-co-newbiz-design_ko.md](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md), 본 ADR
- Related: ADR-0016 (RAG: 우선순위 규칙, 가중평균 아님, 데이터 신뢰도 상한), ADR-0021 (정책 변경 → 시스템 반영, `project_policy_pin`), ADR-0023 (지역 프로파일 스키마와 필수 검토 축), ADR-0024 (산업·지역 프로파일 우선 원칙), ADR-0037 (필수 항목 누락의 게이트 차단), ADR-0044 (산업·지역 확장은 프로파일 수로), ADR-0051 (워크플로 공백 해소 — 시장 DD 단계 추가)

## Context

"매출의 질"은 최소 네 개 축 — 집중도, 이익률, 회수 기간, 반복성 — 으로 평가해야 한다. 그런데 현재 DD 체크리스트에서 이 네 축은 흩어져 있고 서로 겹쳐 읽히지 않는다.

| 축 | 현재 다루는 곳 | 빈틈 |
|---|---|---|
| 집중도 | `cdd-01`, `mdd-06`, `ma-08` | 같은 수치를 두 체크리스트가 각각 계산한다 |
| 이익률 | `cdd-03`(가격전가력), `fdd-01`(EBITDA 정상화) | 고객·세그먼트 단위 마진 항목이 없다 |
| 회수 기간 | `fdd-05`의 "DSO/DPO trends" 한 구절 | 전사 평균만 보고, 고객별 연령분석이나 집중도와의 결합이 없다 |
| 반복성 | `cdd-02`, `mdd-07`, `mdd-09` | 반복매출과 일회성 매출의 구분이 없다(`fdd-01`의 non-recurring은 이익 항목) |

네 축은 같은 고객·세그먼트에 겹쳐 볼 때 의미가 생긴다(최대 고객이 가장 늦게 지급하고 마진도 가장 낮은 경우 등). 이 교차 판단을 소유한 항목이 없다.

또한 `mdd-06`/`mdd-07`은 `cdd-01`/`cdd-02`와 같은 데이터룸 자료로 같은 비율(상위 10 고객 비중, 이탈률)을 다시 계산하도록 요구한다. 시장 DD는 "대상기업의 상업적 위치는 상업 DD가 다루고, 시장 DD는 독립적인 시장 측 검증을 더한다"(`market-dd-checklist.yaml` 머리말)는 취지로 도입됐다(ADR-0051). 같은 자료의 재계산은 독립 검증이 아니며, 두 수치가 어긋날 때 어느 쪽이 기준인지도 정해져 있지 않다.

마지막으로 절차 `procedures/_shared/brownfield-dd/schema.yaml`의 step 1·4 설명은 이 구조를 반영하지 않는다.

## Decision

1. **`cdd-08` 신설 (권고, 가급적 수행).** 상위 고객·세그먼트별로 집중도, 이익률, 회수 기간, 반복성을 같은 단위에 겹쳐 평가하고 축별 판정과 근거를 기록한다. 네 축은 **하한선**이다(산업별 축을 더할 수 있다). 축 간 합산 점수는 만들지 않고, `cdd-01`~`03`의 세부 내용은 재서술하지 않는다. 항목은 `mandatory: false`(waiver 가능)이지만 고객 단위 자료가 있으면 수행하는 것이 바람직하며, 건너뛰면 사유와 어느 축을 검증하지 못했는지 기록한다(침묵은 통과가 아니다). 각 축은 `cdd-06`에 따라 `assumption_key` 또는 `dd_finding.value_impact`에 연결한다.
2. **집중도·이탈률 수치는 상업 DD가 한 번만 계산한다.** `cdd-01`/`cdd-02`가 단일 계산 소유 항목이다. `mdd-06`/`mdd-07`은 그 수치를 그대로 받아 시장 측에서만 줄 수 있는 근거(고객 증언, 전환 비용, 이탈 선행지표, 업계·피어 기준)를 더하고, 차이가 크면 발견사항으로 올린다. 항목 ID는 유지한다(`project_checklist_item_state`가 항목 ID를 키로 쓴다). 근거 수집은 병렬로 진행하되 대조는 `cdd-01`/`cdd-02` 수치가 나온 뒤에 한다. `cdd-01`/`cdd-02`가 waiver 또는 미완이면 시장 DD가 그 수치를 직접 계산하고 그 사실을 기록한다(입력이 비는 항목을 만들지 않는다).
3. **프로파일에 선택 섹션 추가.** 산업 프로파일에 `revenue_quality_norms`, 지역 프로파일에 `payment_practice`(회수 기간 기준)를 **선택** 섹션으로 둔다. 있으면 기존 섹션과 같은 출처 규칙(`source`, `verified_on`, `maintainer`, 비어 있지 않은 `data`)을 적용하고, 없으면 유효하다. 이는 지역 프로파일의 **필수 축 변경이 아니다**(ADR-0023의 필수 축 불변). 출처가 있고 사람이 확인한 값만 채운다. **채우는 주체는 프로젝트팀**이며, 딜에서 `cdd-08`을 수행하면서 가급적 채운다(필수 아님). `maintainer`는 채운 에이전트의 agent_key, `verified_on`은 사람이 확인한 날짜다. 값이 없는 동안 `cdd-08`은 `peer-benchmarking`으로 대신한다.
4. **RAG는 바꾸지 않는다.** 축별 판정은 Financial 차원의 근거와 Data Confidence 상한의 입력으로만 쓰며, 새 RAG 차원도 가중평균도 만들지 않는다(ADR-0016 불변).
5. **절차 문구 정정.** `brownfield-dd` step 1은 `cdd-08`과 단일 계산 소유를, step 4는 시장 측 검증으로 재정의된 `mdd-06`/`mdd-07`을 반영하도록 설명만 고친다. 단계 구성, 에이전트·스킬 키, 출력 유형, 킬 기준은 바꾸지 않는다(버전 1.6.0 → 1.6.1).
6. **같은 변경 묶음에 포함된 보조 변경.** `fdd-05`(`cdd-08`을 수행할 때 고객별 DSO·마진을 공급), `ma-08`(집중도의 인수 전후 측정, 반복성은 `cdd-08` 수행 시에만 — 필수 항목의 범위를 권고 항목으로 넓히지 않는다), `dd-to-valuation-bridge`(마진 축과 QoE 정상화의 이중계상 점검)에 교차 참조를 둔다.

## Consequences

- **소급 적용(Retroactivity, 거버넌스 운영 §5-5) — 결정: 이 변경 이후 DD에 진입하는 프로젝트에만 적용한다(2026-10-01, OP-1).** `project_policy_pin`은 `policies/` 문서만 고정하며 절차와 체크리스트는 고정하지 않는다. 확인한 현황: 프로젝트별 상태 행은 평가할 때 생기고, 새 yaml 항목은 기존 프로젝트에 행이 자동으로 생기지 않으며, `ddCompletionSummary`(`app/web-next/lib/dd-checklist-tailor.ts`)는 `fail` 행만 필수 미충족으로 센다. 따라서 `cdd-08`은 진행 중인 프로젝트를 자동으로 막지 않지만, 평가를 건너뛰어도 막히지 않는다는 뜻이기도 하다. `cdd-08`은 권고 항목이라 어느 쪽으로도 막히지 않는다. 진행 중인 프로젝트에는 `pending` 행을 만들지 않으며, 이미 끝난 상업 DD를 다시 열지 않는다. `policy_change` 테이블은 `policy` 행(`policies/`)만 참조하므로 체크리스트 변경의 기록 수단이 아니며, 이 ADR이 소급 결정의 기록이다.
- **쉬워지는 것**: 네 축을 같은 고객 단위로 보는 단일 소유 항목이 생기고, 집중도·이탈률 수치의 출처가 하나로 정리되며, 두 수치가 어긋날 때의 처리 규칙이 생긴다.
- **어려워지는 것**: 상업 DD와 시장 DD 사이에 산출 순서 의존(대조는 `cdd-01`/`cdd-02` 이후)이 생긴다. 고객 단위 마진·DSO 자료는 매출원장과 관리회계가 필요해서, 데이터룸 접근이 없는 세션에서는 `cdd-08`이 "검증 불가"로 기록되거나 사유와 함께 건너뛴다. 권고 항목이라 이것이 게이트를 막지는 않는다.
- **영향 파일**: `checklists/commercial-dd-checklist.yaml`(v1.1.0), `checklists/market-dd-checklist.yaml`(v1.1.0), `checklists/financial-dd-checklist.yaml`(v1.1.0), `checklists/ma-special-topics-checklist.yaml`(v1.3.0), `procedures/_shared/brownfield-dd/schema.yaml`, `industry-profiles/_schema.yaml`·`_validate.ts`·`README.md`, `region-profiles/_schema.yaml`·`_validate.ts`, 스킬 4종(`commercial-due-diligence`, `quality-of-earnings`, `dd-to-valuation-bridge`, `customer-attrition-risk`)과 플랫폼 사본.
- **수락 전 병합 금지**: 이 ADR이 Accepted 되기 전에는 위 변경 묶음을 병합하지 않는다. 절차 변경이 포함되어 있다.

## Open Points

해결됨 (2026-10-01, 사용자 결정):

- **OP-1 (소급)**: 이 변경 이후 DD에 진입하는 프로젝트에만 적용한다. 진행 중인 프로젝트는 소급하지 않는다.
- **OP-2 (프로파일 값)**: 프로젝트팀이 딜에서 `cdd-08`을 수행하면서 채운다. 산업·지역 프로파일 시스템의 소유(industry-lead / region-lead 헌장)는 바뀌지 않으며, 별도의 선채움 작업은 두지 않는다.
- **OP-3 (필수 여부)**: 옵션(`mandatory: false`)으로 두되 가급적 채우는 것이 바람직한 형태로 한다.

남은 항목:

- **OP-4 (미완 강제 범위)**: 필수 항목의 행 부재가 게이트를 막지 않는 현황(위 Consequences 첫 항목)은 이 ADR의 범위 밖이며, 별도 검토 대상이다.
- **수락**: ADR-0147의 Accepted 전환은 사람 검토자의 몫이다.
