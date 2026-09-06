---
governance_doc_id: pol-group-neb
layer: policy
title: 그룹 신사업 검토 정책
scope: shared
level: group
version: "1.0.0"
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

**상태**: 유효
**설계 기준 문서**: [design v1.0 §6](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md), [Stage 1 회의](../../memory/meeting-2026-08-20-m1-process-skeleton.md)에서 구체화됨.

## 1. 목적 및 적용 범위

이 정책은 그룹 전체의 모든 신사업 검토 — Green Field(신규 설립)와 Brown Field(M&A) — 를 스크리닝(Screening)부터 그룹 IC까지 규율한다. 이 문서는 5계층 거버넌스 위계(정책 → 절차 → 가이드라인 → 체크리스트 → 템플릿)의 최상위 문서이며, 개별 법인은 추가 조항(addendum, `policies/entities/<entity>/addendum.md` 참조)을 둘 수 있지만 이 정책의 강제 조항을 약화시킬 수 없다.

## 2. 강제 요건

1. **스테이지 게이트는 순차적이며 시스템이 강제한다.** 프로젝트는 이전 게이트의 산출물이 기록되지 않으면 다음 게이트에 진입할 수 없다. 법인 IC 승인은 그룹 수준 절차 진입의 필수 선결 조건이며, 시스템은 경고가 아니라 진입 자체를 거부한다.
2. **FS 게이트가 열리기 전에 WACC와 hurdle IRR은 반드시 `kind=user`여야 하며 `assumed`일 수 없다.** 잠정 할인율은 모든 후속 NPV를 무효로 만든다.
3. **Brown Field 검토는 6개 필수 교차검증 밸리데이터 전부**(antitrust, customer-retention, incentive, hr-integration, 인증 이전 가능성, region-lead 노동 검토)가 DD 종료 전에 기록되어야 한다. 이 요건에는 면제 경로가 없다 — 이는 판단 사안이 아닌 완전성 검증이기 때문이다.
4. **인증(change-of-control) 이전 가능성**이 Brown Field 딜 논거에 핵심적인 경우, Pre-FS 게이트 종료 전에 반목적기(must)로 확인되어야 한다 — 인증 기관 자체 규정을 근거로 하며, 피인수사의 주장에 근거한 추론은 인정되지 않는다.
5. **Kill Criteria는 구속력을 갖는다.** Kill Criteria 조건(설계 §8.2, 프로세스 맵)에 해당하는 프로젝트는 중단된다. Kill Criteria를 재정(overriding)하려면 기록된 명시적 그룹 IC 의결이 필요하며, 법인의 일방적 조치로는 불가하다.
6. **정보 보호는 타협 불가** (설계 §8.10, 회의 M7-1). 에이전트는 호출한 사용자의 권한을 상속받으며 자체 계정을 갖지 않는다. `management_package`는 실명을 저장하지 않는다. `comp_benchmark`는 최소 5인의 코호트를 요구한다. MNPI 프로젝트는 어떤 접근보다도 먼저 내부자 등록이 필요하다.
7. **모든 산출물은 게이트 개방 전 3단계 검토**(AI 형식 검토 → AI 교차도메인 검토 → 인간 최종)를 통과해야 한다. 규정, 게이트 승인, 투자 의사결정, 보안/프라이버시 모델, ADR은 AI 검토만으로 통과할 수 없다.
8. **프로젝트는 시작 시점에 고정된 정책 버전**(`project_policy_pin`)으로 평가되며, 그룹 IC 시점에도 마찬가지다. 다만 중대한 정책 변경이 있으면 `policy_change`로 기록된 명시적 재평가 의결을 강제한다.

## 3. 그룹 IC 고유 검토 축

회의 M2에 따라, 그룹 IC는 법인 IC가 구조적으로 답할 수 없는 질문에 답한다:

- **포트폴리오 적합성** — 그룹 내 타 회사 사업과의 중복 또는 잠식(cannibalization) 여부.
- **그룹 내 거래 컴플라이언스** — 계열사 거래가 포함된 딜에 대한 공정거래법 제47조(관계기업에 대한 부당지원) 스크리닝.
- **자본 배분 우선순위** — 그룹 IC는 통상 단일 딜에 대한 단순 승인/거부가 아니라, 동일한 자본 예산을 두고 경쟁하는 동시 진행 `group_agenda` 제안 전반에 대한 우선순위 의결이다.
- **그룹 신용도 및 지주회사 행위제한 컴플라이언스.**

그룹 IC 의결은 `approved`, `rejected`, **`conditional`**(감액 승인 또는 특정 시정 조건부 승인) 중 하나이며 — `conditional`은 `approved`에 덧붙이는 메모가 아니라 독립적인(first-class) 결과값이다.

## 4. Kill Criteria (그룹 수준 구속 목록)

1. 필수 인프라 최소 기준을 충족하는 부지 후보가 하나도 없는 경우 (Green Field).
2. DD 종료 시점에 6개 Brown Field 필수 밸리데이터 중 하나라도 누락된 경우.
3. risk-officer 서명 없이 성장 전망이 상위 10% 역사적/동종업계 기저율을 벗어나는 경우.
4. 다운사이드 시나리오에서 커버넌트 위반이 발생하는 경우.
5. 딜 논거에 핵심적인 필수 인증이 이전 불가능한 경우.
6. 파트너 없이는 사업 진행이 불가능한데도 파트너 조달에 실패한 경우 (partnership-agent 참조).

## 5. 개정

이 정책의 개정에는 ADR(설계 §6.5/§11 트리거 목록)과 영향 분석을 포함한 `policy_change` 기록이 필요하며, 이후 효력이 발생한다. 소급 적용은 `project_policy_pin`이 규율한다(위 §2.8).

## 6. 관련 문서

- `policies/entities/*/addendum.md` — 법인별 추가 조항
- `procedures/_shared/*` — 이 정책의 요건을 구현하는 절차
- `docs/governance/governance-operations.md` — 컴플라이언스 모니터링, 면제, 해석 레지스트리
- `docs/planning/transition-plan.md` — 기존 검토 관행의 이 정책으로의 이행 방안
