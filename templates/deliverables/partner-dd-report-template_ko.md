---
governance_doc_id: tpl-partner-dd-report
layer: template
title: "파트너 실사 보고서 템플릿"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: partner_dd_report
lang: ko
lang_reason: source-material
counterpart: partner-dd-report-template.md
---

<!--
  output_type: partner_dd_report — "Deal-shape chain P2 — seven-workstream
  partner DD report with deal-shape recommendation (ADR-0052 §A)".
  Produced by deal-shape-chain step 3 (partnership-agent /
  partner-due-diligence, gate P2). Findings feed the P3 shape decision
  (deal_shape_decision, its own output) and the chain's kill criteria.
  Required evidence item per the procedure: reference at least two of the
  partner's other alliance partners. Technical workstream evidence follows
  the rbd checklist (rbd-08..rbd-15): named tests/environments/artifacts,
  non-champion reviewer (GAO-20-48G discipline).
-->

# [파트너명] — 파트너 실사 보고서

**Run ID**: [run_id] · **체인 단계**: deal-shape-chain P2 · **가정된 딜 형태(P1/P0 기준)**: [shape] · **기준 시점**: [as_of]

## 워크스트림 조사 결과 (7개)

| # | 워크스트림 | 조사 결과 | 심각도 | 증거 (ADR-0058 ref) |
|---|---|---|---|---|
| 1 | 법률 / 권리관계 | [조사 결과 — IP 소유권, 부담(encumbrance), 소송 포함] | green / amber / red | [ref] |
| 2 | 기술 — 우리의 다음 게이트 대비 TRL/MRL 증거 | [조사 결과 — 명명된 테스트/환경/아티팩트 포함; non-champion 검토자] | [severity] | [ref] |
| 3 | 협업 역량 | [finding] | [severity] | [ref] |
| 4 | 재무 | [finding] | [severity] | [ref] |
| 5 | 상업적 충돌 (경쟁 중복) | [finding] | [severity] | [ref] |
| 6 | 문화 | [finding] | [severity] | [ref] |
| 7 | 엑시트 / 가역성 | [조사 결과 — 제휴 실패 시 종료/엑시트 옵션 포함] | [severity] | [ref] |

## 제휴 트랙 레코드 (필수 증거 항목)

파트너의 다른 제휴 파트너 중 최소 2개 인용:
| 인용된 파트너 | 관계 | 결과/교훈 | 출처 |
|---|---|---|---|
| [파트너 1] | [context] | [outcome] | [ref] |
| [파트너 2] | [context] | [outcome] | [ref] |

## Red 조사 결과 → kill-criteria 스크리닝

[각 red 조사 결과를 체인의 kill criteria와 대조 확인(파트너 DD red 조사 결과는 이를 입력함) — 기준, 적용 여부, 결과, 증거. 없는 경우: "red 조사 결과 없음" 명시.]

## 딜 형태 권고 (P3의 입력이며 결정이 아님)

**권장 형태**: [license-in / co-development / minority investment / JV / full M&A / recycle] · **5개 기준 평가**: 통제 필요성 [판독] · IP 위치 [판독] · 위험 자본 [판독] · 엑시트 선택권 [판독] · 시장 진입 시간 [판독] · **근거**: [2-3문장]

## 서명

| 역할 | 키 | 면(Surface) |
|---|---|---|
| 기록자 — partnership-agent | [key] | [점검 범위 — 검증되지 않은 항목을 명시할 것] |
