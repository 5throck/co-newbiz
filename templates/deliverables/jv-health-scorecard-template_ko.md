---
governance_doc_id: tpl-jv-health-scorecard
layer: template
title: "JV 건강도 스코어카드 템플릿"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: jv_health_scorecard
lang: ko
lang_reason: source-material
counterpart: jv-health-scorecard-template.md
---

<!--
  output_type: jv_health_scorecard — "JV lifecycle monitor — seven-dimension
  health scorecard; weights/cadence DECIDED by
  docs/decisions/2026-08-24-class-c-decisions.md (b)".
  Produced by jv-lifecycle-governance step 2 (partnership-agent /
  project-review). Field shape mirrors ADR-0059's venture_scorecard table
  (section/measure/target/actual/status + evidence_ref) so a filled
  scorecard maps 1:1 onto rows now that the E.4 migration has landed.
  Weights: EQUAL/UNWEIGHTED dimension scores with per-dimension red-flag
  thresholds (Ankura/Watermark flat-rollup precedent); differential weights
  revisited after 4-6 quarters of accumulated cycles on cross-case evidence.
  Cadence: QUARTERLY scoring cycle feeding the quarterly JV board; annual
  deepening layer; triennial external governance review; event-driven
  re-score on defined triggers. Record raw assessments, not weighted
  composites — the flat-rollup rule stands until a calibration-backed
  amendment changes it.
  ~20 measures across the card is the cap (balanced-scorecard discipline).
-->

# [JV명] — 건강도 스코어카드

**Run ID**: [run_id] · **프로젝트**: [project_id] · **검토 주기**: [review_cycle] · **venture_class**: jv · **기준 시점**: [as_of]

## 7개 차원 (jv-lifecycle-governance 단계 2)

차원별로 2-3개 측정값. 모든 측정값은 목표치를 수반함 — 목표치 없는 측정값은 무효; 이 JV에 대해 목표치가 미확정인 경우, 추측한 등급이 아니라 상태가 반드시 `insufficient_evidence`여야 함.

| 차원 | 측정값 | 목표 | 실적 | 상태 | 증거 (ADR-0058 ref) |
|---|---|---|---|---|---|
| 성과 | [measure] | [target] | [actual] | on_target / deviation / insufficient_evidence | [ref] |
| 사람 | [measure] | [target] | [actual] | [status] | [ref] |
| 파트너 정렬 | [measure] | [target] | [actual] | [status] | [ref] |
| 의사결정 건강도 | [measure] | [target] | [actual] | [status] | [ref] |
| 마일스톤 및 자금 | [measure] | [target] | [actual] | [status] | [ref] |
| 거버넌스 건강도 | [measure] | [target] | [actual] | [status] | [ref] |
| 가치배분 대칭성 | [measure] | [target] | [actual] | [status] | [ref] |

## 편차 노트 (추세-트리거 관점, 일회성 평가 아님)

모든 `deviation`에 대해: [직전 주기 대비 무엇이 변했는가 · 트리거 함의 — 지표 연동 재편 트리거(단계 4 메뉴) 중 활성화되는 것이 있는가? · 시정 경로와 담당자]

## 주기 및 검토

- **이번 검토 주기**: [cycle — (b) 결정에 따라 분기별] · **독립적 외부 거버넌스 검토**: 3년마다(확정된 주기 체계)
- **입력처**: 연간 전략 자산 검토(단계 3) 및 Section E 포트폴리오 롤업(portfolio-venture-monitoring 단계 1)

## 서명

| 역할 | 키 | 면(Surface) |
|---|---|---|
| 기록자 — partnership-agent | [key] | [점검 범위] |
| 인간 검토자(해당 주기에 지정된 경우) | [registry key] | verified / could not verify / needs judgment |
