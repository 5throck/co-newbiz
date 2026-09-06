---
governance_doc_id: tpl-bau-exit-evidence-pack
layer: template
title: "PMI BAU-Exit 증거 팩 템플릿"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: bau_exit_evidence_pack
lang: ko
lang_reason: source-material
counterpart: bau-exit-evidence-pack-template.md
---

<!--
  output_type: bau_exit_evidence_pack — "PMI — the BAU-exit precondition
  evidence presented for Finance certification (ADR-0052 §B)". Produced by
  pmi-integration-execution step 4 (pmi-agent / pmi-planning), consumed by
  the HUMAN step-5 certification (bau-exit-certifier — decision vocabulary
  demobilization_approved | held_pending_certification |
  conditional_with_named_gaps; that decision is a separate output_type).
   An uncertified synergy run-rate HALTS the handover (kill-criteria
   registry: synergy_run_rate_uncertified_at_bau_handover — halt).
   Certification criteria are DECIDED: docs/decisions/2026-08-24-class-c-decisions.md
   (c) — certified = >=90% of committed COST-synergy run-rate in annualized
   P&L actuals vs the baseline locked at close, sustained 2 consecutive
   quarters (or 3 monthly closes), CFO-signed with owner countersignatures;
   revenue synergies annexed; baseline changes post-close need CFO approval +
   disclosure. The 90-day attrition bands from the same record: >=10%
   escalation / >=15% steering intervention / >=20% failure classification.
-->

# [프로젝트명] — BAU-Exit 증거 팩

**Run ID**: [run_id] · **프로젝트**: [project_id] · **검토 시점**: [as_of] · **IMO**: [integration management office] · **정책 버전**: [project_policy_pin]

## 1. 시너지 run-rate 증거 (재무가 인증하는 완전성 사실)

| 시너지 항목 (단계별 목표 기준) | 약정 | 실제 run-rate | 지속 개월 수 (2연속 분기 필요) | 인증 상태 | 증거 (ADR-0058 ref) |
|---|---|---|---|---|---|
| [synergy item] | [target] | [actual] | [months] | certified / >=90% + 2분기 규칙 대비 NOT certified | [ref] |

**인증되지 않은 행이 하나라도 있으면** → 인수인계는 중단(halt)됨; 완곡하지 않게 여기에 명시: [statement]

## 2. 첫 100일 인수 항목 (hundred_day_review 기준)

- 30/60/90일 시점 약정 대비 실제 시너지: [hundred-day 기록 참조]
- 임계값 대비 핵심 인력 이탈: [90일 시점 측정된 regretted attrition %] vs 확정된 밴드(>=10% escalation / >=15% steering / >=20% failure) — risk-officer 에스컬레이션 상태: [status]
- 미해결 핵심 의사결정: [list 또는 "none"]

## 3. 데모빌리제이션(해체) 준비도

| 선결조건 | 상태 | 증거 |
|---|---|---|
| 통합 논리(thesis) 완료 또는 종결 | [status] | [ref] |
| IMO 헌장 의무 종결 | [status] | [ref] |
| 클린팀 프로토콜 종료 (gun-jumping 노출 종료) | [status] | [ref] |
| 통제 인수인계(재무/HR/IT/법무)의 BAU 담당자 수용 | [status] | [ref] |
| Day-1 연속성 항목 전부 해결 또는 담당자 배정 | [status] | [ref] |

## 4. 명명된 미비 사항 (이 팩이 입증하지 못한 것)

[미비 사항을 명시적으로 기술 — 인증자의 conditional_with_named_gaps 옵션은 정확히 이 목록을 위해 존재함; 빈 미비 섹션은 당연한 것이 아니라 헌득되어야 함]

## 서명

| 역할 | 키 | 면(Surface) |
|---|---|---|
| 기록자 — pmi-agent | [key] | [점검 범위] |
| 제출 대상 | bau-exit-certifier (인간 registry) — 결정은 별도로 bau_exit_decision으로 기록 | — |
