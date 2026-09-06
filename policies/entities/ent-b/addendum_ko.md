---
governance_doc_id: pol-ent-b-addendum
layer: policy
title: "법인 추가 조항 — ent-b"
scope: entity
entity_id: ent-b
level: entity
version: "1.0.0"
enforceability: mandatory
owner_agent: process-governance-manager
approver_role: entity-ic
effective_from: "2026-08-20"
review_cycle_months: 12
lang: ko
lang_reason: source-material
counterpart: addendum.md
---

# 법인 추가 조항 — ent-b

**상태**: 유효 (플레이스홀더 법인 — Open Issue O-1 참조)
**확장 대상**: [`policies/group/neb-policy.md`](../../group/neb-policy.md)

> `ent-b`는 `ent-a`와 함께 설계의 O-1 기본값에 따라 시드된 플레이스홀더 법인으로, 스키마와 절차 오버라이드 메커니즘이 단일 사례가 아닌 서로 다른 두 법인에 대해 검증될 수 있도록 한다.

## 그룹 정책에 대한 추가 사항

1. **최소 딜 규모 오버라이드 없음** — ent-b는 내부 사전 스크리닝 없이 그룹 정책의 기본 Screening 진입을 따른다(ent-a와 의도적으로 다르게 설정하여, 오버라이드 메커니즘이 실제로 법인별로 달라짐을 증명한다).
2. **Green Field 우선 산업 분야**: ent-b의 Green Field 검토는 Stage 1 M1의 기본 산업에 따라 조선 인접 제조업을 우선하며, `industry-profiles/shipbuilding-adjacent.yaml`과 일치한다.

## 절차 오버라이드

ent-b는 현재 공유 `greenfield-screening` 또는 `brownfield-screening` 절차를 오버라이드하지 않는다 — 공유 절차를 그대로 소비한다(`overrides:` 키 없는 최소한의 `references:` 블록). 이는 참조-오버라이드 메커니즘이 지원해야 하는 또 다른 유효 사례다(설계 §6.3 "최소 형식").
