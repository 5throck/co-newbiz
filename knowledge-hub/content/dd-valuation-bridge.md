---
governance_doc_id: gov-dd-06
layer: knowledge-hub-content
title: "DD→밸류에이션 브릿지"
scope: co-newbiz
owner_agent: valuation-agent
version: "1.0.0"
effective_from: "2026-09-05"
---
# DD→밸류에이션 브릿지

실사 발견이 숫자로 이어지지 않으면 실사는 문서일 뿐입니다.

## 반영 경로

1. `dd_finding.value_impact`(KRW 백만원)가 발견사항의 정량 영향
2. 영향은 S8 채택 Business Case의 시나리오(하방/base/상방)에 반영
3. 반영 결과가 IC 패키지의 재무 요약 + RAG 등급 산출로 이어짐

## 규칙

- 발견사항을 IC 패키지에 올리려면 value_impact 또는 "환산 불가" 사유가 필요합니다.
- data confidence가 RAG 등급을 상한 제한합니다(경계 #4).

## 출처 매핑

| 주장 | 근거 |
|---|---|
| 브릿지 절차 | skills/dd-to-valuation-bridge, ADR-0098 |
| 상한 제한 | docs/rag-framework.md, ic-package 라우트 주석 |
