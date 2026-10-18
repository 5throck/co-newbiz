---
title: "Synergy 4-element relationship diagram, tab reorder, AI suggestions, capability coverage factor, and review confirmation"
status: implemented
date: 2026-10-18
owner: platform-lead
lang: ko
lang_reason: proper-noun
---

# 시너지 4요소 관계도·탭 재배열·AI 추천·필요 역량 충족도 5팩터·검토 확정

ADR-0182 구현 설계. 디시더 방향: 관계 도식화, 흐름 순서 탭 재배열, AI 추천 부재 해소, 점수 방법론 기술·팩터별 점수 표시, 필요 역량 충족도 5팩터 반영, 3단계 검토 확정 기능.

자세한 내용은 docs/adr/0182-synergy-subject-market-and-capability-factor.md 참고.

주요 산출물: SynergyFlowDiagram(관계도), SynergyCapabilityTab(독립 탭), SynergyScoreEvidence(산정 근거), POST /api/synergy/ai-areas(AI 영역 제안), capability_coverage 5팩터, GateDecisionPanel 의사결정 탭 이동, 검토 확정 스냅샷.
