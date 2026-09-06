---
governance_doc_id: tpl-portfolio-scorecard-rollup
layer: template
title: "포트폴리오 스코어카드 롤업 템플릿"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: portfolio_scorecard_rollup
lang: ko
lang_reason: source-material
counterpart: portfolio-scorecard-rollup-template.md
---

<!--
  output_type: portfolio_scorecard_rollup — "Portfolio monitoring —
  bifurcated financial/strategic metrics rollup over the venture portfolio
  (ADR-0052 §E.1)". Produced by portfolio-venture-monitoring step 1
  (group-review-agent / portfolio-fit-assessment). Field shape mirrors
  ADR-0059's venture_scorecard table (run-scoped, review-cycle time-series,
  venture_class breakdown, per-measure target REQUIRED). The 20-30% CVC
  benchmark odds are ILLUSTRATIVE. ~20 measures per section family is the
  cap; a measure without a target is invalid (status insufficient_evidence
  instead).
-->

# 벤처 포트폴리오 — 스코어카드 롤업

**Run ID**: [run_id] · **검토 주기**: [review_cycle] · **포트폴리오 범위**: [이번 주기의 대상 벤처, 각 venture_class 표기: driving / enabling / emergent / passive / jv] · **기준 시점**: [as_of]

## 1. 재무 섹션

| venture_class | 벤처 | 측정값 | 목표 | 실적 | 상태 | 증거 (ADR-0058 ref) |
|---|---|---|---|---|---|---|
| [class] | [venture] | [예: IRR-할수율 스프레드 / cash-on-cash / 마일스톤 계획 대비 투입 자본 / 매출 성장률 / 단계 정규화 평가액] | [target] | [actual] | on_target / deviation / insufficient_evidence | [ref] |

## 2. 전략 섹션

| venture_class | 벤처 | 측정값 | 목표 | 실적 | 상태 | 증거 (ADR-0058 ref) |
|---|---|---|---|---|---|---|
| [class] | [venture] | [예: 전달된 소개 건수 / 제품-파트너십-JV로 진전되는 학습(선행 vs 후행) / 단계 진전률 / kill-graduate 건수] | [target] | [actual] | [status] | [ref] |

## 3. 클래스별 롤업 (클래스별 보고 — 평탄화 금지)

| venture_class | 건수 | on_target | deviation | insufficient_evidence | 비고 |
|---|---|---|---|---|---|
| driving / enabling / emergent / passive / jv | [n] | [n] | [n] | [n] | [클래스 수준 판독] |

## 4. 벤치마크 프레임 (예시용)

20-30% CVC 성공 확률 — 이 범위가 암시하는 수준을 넘어 벤처에 자금을 지원하려면 여기에 명시적 증거가 필요: [evidence 또는 "n/a"].

## 5. 입력 및 출처(provenance)

- 이번 주기 범위 내의 게이트 `gate_pass_record` 산출물: [refs]
- 입력되는 JV 스코어카드(jv-lifecycle 단계 2): [refs]
- PMI 시너지 트래커 입력(해당하는 경우): [refs]

## 서명

| 역할 | 키 | 면(Surface) |
|---|---|---|
| 기록자 — group-review-agent | [key] | [점검 범위] |
| 입력처 | portfolio-venture-monitoring 단계 2 (증거 팩) → 단계 3 (인간 IC 결정) | — |
