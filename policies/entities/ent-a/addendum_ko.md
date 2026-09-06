---
governance_doc_id: pol-ent-a-addendum
layer: policy
title: "법인 추가 조항 — ent-a"
scope: entity
entity_id: ent-a
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

# 법인 추가 조항 — ent-a

**상태**: 유효 (플레이스홀더 법인 — Open Issue O-1 참조)
**확장 대상**: [`policies/group/neb-policy.md`](../../group/neb-policy.md)

> `ent-a`는 실제 법인 목록이 확정되기 전까지 설계의 O-1 기본값(설계 §15.2, 회의 M8 D-M8-3)에 따라 시드된 플레이스홀더 법인이다. 이 추가 조항은 추가 조항의 형식을 시연하기 위한 것이며, 그 기준값들은 예시일 뿐 실제 자회사의 리스크 성향에 맞춰 보정된 값이 아니다.

## 그룹 정책에 대한 추가 사항

이 추가 조항은 그룹 정책에 내용을 **추가**하며, 어떤 강제 조항도 약화시키지 않는다.

1. **Brown Field 검토 최소 딜 규모**: 100억 원. 이 기준 미만의 딜은 경량 스크리닝 트랙을 따른다(별도로 정의 예정 — 아직 작성되지 않음, Stage 2 후속 과제).
2. **추가 내부 사전 스크리닝**: ent-a는 Screening 게이트 진입 전 내부 전략실 사전 검토를 요구하며, 당분간은 이 시스템 외부에서 기록한다(수동 서명 — 추후 시스템 반복 버전에서 통합 예정).

## 절차 오버라이드

절차 수준의 `references:` + `overrides:` 선언(설계 §6.3)은 [`procedures/entities/ent-a/brownfield-screening/schema.yaml`](../../../procedures/entities/ent-a/brownfield-screening/schema.yaml)을 참조하라.
