---
governance_doc_id: tpl-venture-transition-evidence
layer: template
title: "벤처 전환 증거 팩 템플릿"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: venture_transition_evidence
lang: ko
lang_reason: source-material
counterpart: venture-transition-evidence-template.md
---

<!--
  output_type: venture_transition_evidence — "Portfolio monitoring —
  stage-transition evidence pack: tranche preconditions, obligation
  tracking, exit-path evaluation, time-boxed windows (ADR-0052 §E.2/E.3)".
  Produced by portfolio-venture-monitoring step 2 (process-governance-
  manager / project-review). This pack is the EVIDENCE the human step 3
  decides on — it contains no decision; the decision record is a separate
  output (venture_transition_decision) with its own template.
-->

# [벤처명] — 단계 전환 증거 팩

**Run ID**: [run_id] · **검토 주기**: [review_cycle] · **제안된 전환**: [from stage] → [to stage] · **venture_class**: [class] · **기준 시점**: [as_of]

## 1. 트랜치 선결조건 (단계별 자금 집행 원칙에 따름)

| 선결조건 | 상태 | 증거 (ADR-0058 ref) |
|---|---|---|
| [선결조건 — 예: 마일스톤 달성 / rbd 체크리스트 rbd-08..rbd-13에 따른 TRL-MRL 증거 / 옵션 가치 대비 단계 프리미엄 기록(rbd-15)] | met / not_met / insufficient_evidence | [ref] |

다음 단계 자금만 집행 — 어떤 트랜치도 이후 단계를 조기 집행하지 않음.

## 2. 의무 추적 (기여-책임)

| 의무 | 담당 | 기한 | 상태 | 증거 |
|---|---|---|---|---|
| [벤처의 거버넌스 문서에 명시된 의무] | [party] | [date/window] | on_track / overdue / disputed | [ref] |

## 3. 엑시트 경로 평가 (6개 옵션 모두 평가 — 유리한 옵션만이 아님)

| 옵션 | 이번 주기 판독 | 트리거 조건 | 증거 |
|---|---|---|---|
| 핵심으로 통합 | [reading] | [conditions] | [ref] |
| 독립 운영 | [reading] | [conditions] | [ref] |
| 스핀아웃 | [reading] | [conditions] | [ref] |
| 지분 축소 | [reading] | [conditions] | [ref] |
| 매각 | [reading] | [conditions] | [ref] |
| Kill (학습 포함) | [reading] | [conditions] | [ref] |

## 4. 기한이 정해진 기간(time-boxed windows)

[이번 주기에 만료되는 기간: 예: 의사결정 마감, 옵션 만기, 펀딩 콜 일자 — 각각을 놓쳤을 때의 결과를 함께 명시]

## 5. 보류 중인 편차 및 리스크

[롤업(단계 1)에서: 이 전환에 중요한 미해결 편차, 각각 증거 참조 첨부]

## 서명

| 역할 | 키 | 면(Surface) |
|---|---|---|
| 기록자 — process-governance-manager | [key] | [점검 범위 — 검증되지 않은 항목을 명시할 것] |
