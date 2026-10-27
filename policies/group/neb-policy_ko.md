---
governance_doc_id: pol-group-neb
layer: policy
title: 그룹 신사업 검토 정책
scope: shared
level: group
version: "1.2.0"
enforceability: mandatory
owner_agent: process-governance-manager
approver_role: group-ic
effective_from: "2026-08-20"
review_cycle_months: 12
lang: ko
lang_reason: source-material
counterpart: neb-policy.md
---

# 그룹 신사업 검토 정책

**상태**: 유효 (v1.2.0, 2026-10-27 [ADR-0187](../../docs/adr/0187-process-ssot-decision-evidence.md)으로 개정; 기록 `DEC-20261027-03`. 이전: v1.1.0, [ADR-0186](../../docs/adr/0186-gate-integrity.md), 기록 `DEC-20261027-01`)
**설계 기준 문서**: [design v1.0 §6](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md), [Stage 1 회의](../../memory/meeting-2026-08-20-m1-process-skeleton.md)에서 구체화됨.

## 1. 목적 및 적용 범위

이 정책은 그룹 전체의 모든 신사업 검토 — Green Field(신규 설립)와 Brown Field(M&A) — 를 스크리닝(Screening)부터 그룹 IC까지 규율한다. 이 문서는 5계층 거버넌스 위계(정책 → 절차 → 가이드라인 → 체크리스트 → 템플릿)의 최상위 문서이며, 개별 법인은 추가 조항(addendum, `policies/entities/<entity>/addendum.md` 참조)을 둘 수 있지만 이 정책의 강제 조항을 약화시킬 수 없다.

## 2. 강제 요건

1. **스테이지 게이트는 순차적이며 시스템이 강제한다.** 한 게이트의 GO는 트랙 사다리(ladder)에서 바로 앞 게이트의 유효한 GO 기록과 이전 게이트 산출물의 기록을 필요로 한다. 사다리는 Green Field: Screening → Pre-FS → FS → DD → Entity IC → Group IC, Brown Field: Screening → Pre-FS → Target Screening → FS → DD → Entity IC → Group IC 이다. 법인 IC 또는 그룹 IC의 GO는 제2의 인원이 연서(countersign)한 뒤에만 유효하며(§2.9), 낡았거나 연서되지 않은 의결은 사다리에서 GO가 아닌 것으로 본다. HOLD와 KILL은 사다리에 막히지 않는다. 법인 IC 승인은 그룹 수준 절차 진입의 필수 선결 조건이며, 시스템은 경고가 아니라 진입 자체를 거부한다.
2. **FS 게이트가 열리기 전에 WACC와 hurdle IRR은 반드시 `kind=user`여야 하며 `assumed`일 수 없다.** 잠정 할인율은 모든 후속 NPV를 무효로 만든다. WACC 대상(subject)과 두 비율이 모두 사용자 확인을 마치기 전에는 S8이 완료되지 않으며 FS GO도 거부된다(Brown Field는 bf-13 면제로 인수자 기준 대체안이 기록된 경우가 아니면 대상은 피인수 대상 회사이고, Green Field는 투자 법인이다). 확인 전까지 할인율을 쓰는 모든 산출물에는 잠정(provisional) 표시를 붙인다.
3. **Brown Field 검토는 6개 필수 교차검증 밸리데이터 전부**(antitrust, customer-retention, incentive, hr-integration, 인증 이전 가능성, region-lead 노동 검토)가 DD 종료 전에 기록되어야 한다. 이 요건에는 면제 경로가 없다 — 이는 판단 사안이 아닌 완전성 검증이기 때문이다. 완전성은 밸리데이터 완전성 엔진(선언 6 / 해당 N / 완료 M)에서 도출하며, 수동으로 설정한 체크리스트 상태로는 정하지 않는다. 체크리스트 항목(bf-01)은 도출 결과를 읽기 전용으로 보여 주며, 해당 밸리데이터가 하나라도 빠져 있으면 DD GO는 거부된다.
4. **인증(change-of-control) 이전 가능성**이 Brown Field 딜 논거에 핵심적인 경우, Pre-FS 게이트 종료 전에 반드시(must) 확인되어야 한다 — 인증 기관 자체 규정을 근거로 하며, 피인수사의 주장에 근거한 추론은 인정되지 않는다. 딜 논거에 핵심적인 경우 이 확인은 Pre-FS GO를 막는 강제 차단 조건이다(체크리스트 항목 bf-03은 bf-01, bf-02와 같이 구속력이 있고 면제할 수 없으며, 단순 확인(acknowledgement) 항목이 아니다).
5. **Kill Criteria는 구속력을 갖는다.** Kill Criteria 조건(설계 §8.2, 프로세스 맵)에 해당하는 프로젝트는 중단된다. Kill Criteria를 재정(overriding)하려면 기록된 명시적 그룹 IC 의결이 필요하며, 법인의 일방적 조치로는 불가하다. 재정은 `group-ic-reviewer` 역할을 가진 사람이 법인별·기준별로 사유와 함께 발행하는 기록·감사 대상 `kill_criteria_override`이며, 공식 그룹 IC 회의 이전에도 발행할 수 있다. 조치가 `halt`인 기준은 구속력이 있다. 일치하는 재정이 없으면 GO는 거부되며, 발행자는 그 재정으로 풀리는 의결을 기록하는 사람과 달라야 한다. 다른 조치의 기준과 시스템이 평가하지 못한 기준은 사유가 담긴 확인(acknowledgement) 기록이 필요하다.
6. **정보 보호는 타협 불가** (설계 §8.10, 회의 M7-1). 에이전트는 호출한 사용자의 권한을 상속받으며 자체 계정을 갖지 않는다. `management_package`는 실명을 저장하지 않는다. `comp_benchmark`는 최소 5인의 코호트를 요구한다. MNPI 프로젝트는 어떤 접근보다도 먼저 내부자 등록이 필요하다.
7. **모든 산출물은 게이트 개방 전 3단계 검토**(AI 형식 검토 → AI 교차도메인 검토 → 인간 최종)를 통과해야 한다. 규정, 게이트 승인, 투자 의사결정, 보안/프라이버시 모델, ADR은 AI 검토만으로 통과할 수 없다. **명시된 예외 — Target Screening:** Brown Field `target_screening` 게이트 의결(S7 Short List)은 게이트 검토 파이프라인을 거치지 않는다(AI 2차 단계와 인간 최종 스냅숏 없음). 사람의 게이트 기록과 후보별 스크리닝 근거가 검토를 맡으며, 게이트에는 여전히 사람의 의결 기록이 필요하다(ADR-0153 addendum 2026-10-22 a, ADR-0187로 여기에 명시). 다른 예외는 없다. 모든 단계 산출물은 검토 등록부에 검토 요건과 함께 올라 있으며, 기본값은 AI 2차 검토 필요다. 등록부에 빠진 산출물은 보고하고 고칠 범위 결함이며, 묵시적 면제가 아니다.
8. **프로젝트는 시작 시점에 고정된 정책 버전**(`project_policy_pin`)으로 평가되며, 그룹 IC 시점에도 마찬가지다. 다만 중대한 정책 변경이 있으면 `policy_change`로 기록된 명시적 재평가 의결을 강제한다.
9. **게이트 기록 무결성.** 모든 게이트의 GO는 의결 시점에 알려진 사실에 대해 서버가 계산한 불변 스냅샷과 함께 기록된다. 스냅샷에는 Kill Criteria 결과(발동, 미평가, 비활성), RAG 등급과 데이터 신뢰도 상한, 밸리데이터 완전성, 열려 있는 면제 불가 항목, WACC 상태, 유효한 면제와 열려 있는 조건이 들어간다. 기록자는 판단이 필요한 항목마다 사유와 함께 확인(acknowledge)하며, 클라이언트가 이 사실들을 직접 제공하는 일은 없다. 이 정책이 이미 구속하는 항목(§2.1 사다리, §2.2 WACC, §2.3 밸리데이터, §2.4 bf-03, §2.5 구속력 있는 Kill Criteria)만 강제 차단이며, 나머지는 모두 확인 항목이다. 의결 근거(rationale)는 실질을 보여야 한다(스크립트가 정한 최소 길이와 단어 수를 채우고, 자리표시자와 반복 문자는 거부한다). 이 검사는 형식만 보며, 추론이 타당한지는 사람 검토자의 몫으로 남는다. AI 권고가 있는데 기록된 의결이 이와 다르면 차이 사유(divergence reason)가 필요하다. 법인 IC와 그룹 IC 의결에는 작성자/확인자(maker/checker) 분리가 필요하며, 확인자는 작성자와 다른 사람으로서 해당 사람 역할(`entity-ic-reviewer` 또는 `group-ic-reviewer`)을 가져야 한다. HOLD와 KILL은 막히지 않으며, 이미 기록된 의결은 소급해 고치거나 무효로 하지 않는다. 기존(legacy) 기록은 다시 쓰지 않고 표시만 한다. 에이전트와 MCP 도구는 제안할 수는 있으나 확인, 연서, 승인, 해소, 재정은 결코 할 수 없다.
10. **선결 조건(condition precedent)을 추적한다.** 조건부 의결 또는 GO 의결에 붙은 조건은 담당 역할, 해소 시점(그룹 IC, 설립 또는 종결), 상태를 가진 추적 대상 객체이다. 그룹 IC 범위의 미해소 조건은 그룹 IC GO를 막고, 설립 또는 종결 조건이 미해소이면 S11은 완료되지 않은 것으로 본다. 조건은 IC 검토자 역할을 가지면서 그 조건을 만들지 않은 사람만 메모(종결 조건은 증빙 포함)와 함께 해소할 수 있다. 열려 있는 HOLD의 누락 산출물과 `mark_conditional` Kill 결과는 후보 조건으로 제시되며, 후보를 제외하려면 사유가 필요하다.
11. **면제와 `na` 규칙.** 면제는 최대 90일간 유효하다. 면제는 한 사람이 요청하고 다른 사람이 승인한다. 승인자는 요청자와 달라야 하고 `entity-ic-reviewer`(그룹 수준 항목은 `group-ic-reviewer`)를 가져야 하며, 승인 시각은 자유 입력 이름이 아니라 승인자의 인증된 신원과 함께 기록한다. 면제는 필수이면서 면제 불가인 항목을 덮을 수 없고, 모든 면제는 실재하는 체크리스트 항목을 지정해야 한다. 필수 항목을 `na`로 표시하려면 사유가 필요하고 제2의 인원이 확인한다. 확인되지 않은 필수 항목의 `na`는 미결(pending)로 본다. 구속력 항목은 `na`로 표시할 수도, 면제할 수도 없다.

## 3. 그룹 IC 고유 검토 축

회의 M2에 따라, 그룹 IC는 법인 IC가 구조적으로 답할 수 없는 질문에 답한다:

- **포트폴리오 적합성** — 그룹 내 타 회사 사업과의 중복 또는 잠식(cannibalization) 여부.
- **그룹 내 거래 컴플라이언스** — 계열사 거래가 포함된 딜에 대한 공정거래법 제47조(관계기업에 대한 부당지원) 스크리닝.
- **자본 배분 우선순위** — 그룹 IC는 통상 단일 딜에 대한 단순 승인/거부가 아니라, 동일한 자본 예산을 두고 경쟁하는 동시 진행 `group_agenda` 제안 전반에 대한 우선순위 의결이다.
- **그룹 신용도 및 지주회사 행위제한 컴플라이언스.**

그룹 IC 의결은 `approved`, `rejected`, **`conditional`**(감액 승인 또는 특정 시정 조건부 승인) 중 하나이며 — `conditional`은 `approved`에 덧붙이는 메모가 아니라 독립적인(first-class) 결과값이다.

## 4. Kill Criteria (그룹 수준 구속 목록)

Kill Criteria 등록부(`procedures/_kill-criteria/<procedure>__<criterion>.json`)가 유일한 정본 목록이다. 각 기준의 문언과 조치는 절차 YAML 선언이 정하며, 등록부는 절차마다 한 건씩 그것을 기록한다. `process/flow.spec.yaml`은 게이트마다 그 게이트에서 구속하는 등록부 키(`killCriteriaRegistry`)를 나열하며, `killCriteria` 문자열은 사람이 읽는 요약일 뿐이다. 아래 그룹 수준 구속 목록은 등록부의 부분집합이며 키로 인용한다.

| # | 그룹 수준 기준 | 등록부 키 |
|---|---|---|
| 1 | 필수 인프라 최소 기준을 충족하는 부지 후보가 하나도 없는 경우 (Green Field). | `greenfield-screening__zero_site_clears_infrastructure_minimums` |
| 2 | DD 종료 시점에 6개 Brown Field 필수 밸리데이터 중 하나라도 누락된 경우. | `brownfield-dd__any_of_six_ma_validators_missing_at_dd_exit` |
| 3 | risk-officer 서명 없이 성장 전망이 상위 10% 역사적/동종업계 기저율을 벗어나는 경우. | `greenfield-fs__growth_projection_outside_top_decile_without_risk_officer_signoff` |
| 4 | 다운사이드 시나리오에서 커버넌트 위반이 발생하는 경우. | `brownfield-dd__covenant_breach_with_coc_acceleration_under_downside` (Brown Field). Green Field: 아직 등록부 항목이 없다 — ADR-0187 P2 단계에서 절차에 선언하며, 그 전까지는 검토자가 S10 자금조달 계획에 비추어 판단한다. |
| 5 | 딜 논거에 핵심적인 필수 인증이 이전 불가능한 경우. | `greenfield-pre-fs__certification_transferability_unconfirmed_and_load_bearing`, `brownfield-pre-fs__certification_transferability_unconfirmed_and_load_bearing`, `brownfield-dd__certification_transferability_computed_by_inference_not_confirmation` |
| 6 | 파트너 없이는 사업 진행이 불가능한데도 파트너 조달에 실패한 경우 (partnership-agent 참조). | `greenfield-screening__partner_dependency_unconfirmed_and_no_alternative`, `brownfield-dd__partner_dependency_unconfirmed_and_no_alternative` |

이 목록에 기준을 더하거나 빼는 일은 등록부 항목·절차 선언과 함께, ADR과 `policy_change` 기록(§5)을 거쳐서만 한다. ADR-0187 P1 단계부터는 정합 검증기가 이 표, 등록부, flow.spec `killCriteriaRegistry`를 같게 유지한다.

## 5. 개정

이 정책의 개정에는 ADR(설계 §6.5/§11 트리거 목록)과 영향 분석을 포함한 `policy_change` 기록이 필요하며, 이후 효력이 발생한다. 소급 적용은 `project_policy_pin`이 규율한다(위 §2.8). 이력: v1.2.0 (2026-10-27) — ADR-0187에 따라 §2.7에 Target Screening 검토 예외와 검토 등록부 기본값을 명시하고, §4가 Kill Criteria 등록부를 정본 목록으로 인용함. `docs/decisions/DEC-20261027-03.md` 참조. v1.1.0 (2026-10-27) — ADR-0186에 따라 §2.1–§2.5를 개정하고 §2.9–§2.11을 추가함. `docs/decisions/DEC-20261027-01.md` 참조.

## 6. 관련 문서

- `policies/entities/*/addendum.md` — 법인별 추가 조항
- `procedures/_shared/*` — 이 정책의 요건을 구현하는 절차
- `procedures/_kill-criteria/` — Kill Criteria 정본 등록부 (§4)
- `docs/governance/governance-operations.md` — 컴플라이언스 모니터링, 면제, 해석 레지스트리
- `docs/planning/transition-plan.md` — 기존 검토 관행의 이 정책으로의 이행 방안
