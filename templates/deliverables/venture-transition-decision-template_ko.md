---
governance_doc_id: tpl-venture-transition-decision
layer: template
title: "벤처 전환 결정 기록 템플릿"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: venture_transition_decision
lang: ko
lang_reason: source-material
counterpart: venture-transition-decision-template.md
---

<!--
  output_type: venture_transition_decision — "Portfolio monitoring — human
  tranche + kill/graduate decision: next_tranche_released |
  held_evidence_incomplete | graduate_to_core | reduce_or_divest |
  kill_with_learning_captured (ADR-0052 §E.2/E.3)". Produced at
  portfolio-venture-monitoring step 3 — a HUMAN-authority step
  (venture-portfolio-ic, procedures/_human-roles.yaml). The tranche call
  AND the kill/graduate call are taken in one sitting, on the step-2
  evidence pack. A kill is a governed decision with learning capture, not
  a silent starve. This template IS the signature surface — no PASS stamp;
  the human surface is verified / could not verify / needs judgment.
-->

# [벤처명] — 벤처 전환 결정

**Run ID**: [run_id] · **검토 주기**: [review_cycle] · **증거 팩**: [venture_transition_evidence ref] · **기준 시점**: [as_of]

## 1. 결정 (폐쇄형 어휘 — 정확히 하나)

**결정**: [ ] next_tranche_released · [ ] held_evidence_incomplete · [ ] graduate_to_core · [ ] reduce_or_divest · [ ] kill_with_learning_captured

**근거** (결정을 이끈 증거 팩 행을 인용할 것, 재진술 금지): [2-4문장]

## 2. 트랜치 처분 (kill/graduate 판정과 같은 자리에서 완료)

- **해당 트랜치**: [stage / amount] · **선결조건 상태**: [n met / n total, 증거 팩 §1 기준]
- **held_evidence_incomplete인 경우**: 명명된 미비 증거: [items] · 재검토 기한: [date]

## 3. kill_with_learning_captured인 경우 — 학습 기록 (kill 시 필수 섹션)

- **kill 전까지 벤처가 검증한 것**: [learning, 증거 참조 포함]
- **트랜치 집행 시점에는 없었으나 포트폴리오가 현재 알고 있는 것**: [statement]
- **향후 게이트를 위한 학습 저장 위치**: [ref — assumption registry / review model input]

## 4. graduate_to_core인 경우 — 인수인계 기록

- **인수하는 핵심 조직**: [org] · **BAU-exit 선결조건 상태**: [refs] · **이전되는 미해결 의무**: [list]

## 5. 인간 서명 (인간 권한 단계 — ADR-0053)

| 위원 (venture-portfolio-ic) | 면(Surface) | 비고 |
|---|---|---|
| [member] | verified / could not verify / needs judgment | [검증되지 않은 항목, 있다면] |

침묵은 결코 승인으로 읽히지 않음; 검증되지 않은 항목은 기록에 명시적으로 남김.
