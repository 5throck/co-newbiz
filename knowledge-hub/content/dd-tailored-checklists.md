---
governance_doc_id: gov-dd-04
layer: knowledge-hub-content
title: "맞춤 체크리스트"
scope: co-newbiz
owner_agent: commercial-dd-agent
version: "1.0.0"
effective_from: "2026-09-05"
---
# 맞춤 체크리스트 (ADR-0099)

표준 체크리스트(commercial/technical/legal 등)가 권위 원본이며, S9에서 프로젝트 특성에 맞는
**커스텀 항목**이 추가 제안됩니다.

## 절차

1. 맞춤 실행기가 프로젝트 컨텍스트(산업·트랙·S8 케이스)를 읽고 5~10개 커스텀 항목을 제안
2. 제안 항목에는 반드시 **출처 신뢰도 등급**이 붙습니다 — 출처 없는 제안은 등급 **C**로 기록
3. 승인된 항목만 프로젝트 체크리스트에 합류되고 판정 대상이 됩니다

## 웹 검색 실행기

`CO_NEWBIZ_DD_TAILOR_AGENTS` 시임을 통해 웹검색 기반 벤치마킹 실행기를 켤 수 있습니다.
한계가 인간 검토자에게 보이도록 하는 것이 설계 의도입니다.

## 출처 매핑

| 주장 | 근거 |
|---|---|
| 파이프라인·신뢰도 등급 | ADR-0099, dd-checklist-tailor.ts |
| 커스텀 항목 저장 | migration 0069, project_checklist_item_state |
