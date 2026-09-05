---
governance_doc_id: gov-dd-03
layer: knowledge-hub-content
title: "DD 발견사항 기록 규칙"
scope: co-newbiz
owner_agent: commercial-dd-agent
version: "1.0.0"
effective_from: "2026-09-05"
---
# DD 발견사항 기록 규칙

발견사항은 서술로만 남기지 않습니다. **`dd_finding` 레코드**로 착지시켜야 밸류에이션과
IC 패키지에 반영됩니다.

## 필수 요소

- `description` — 무엇을 발견했는가 (명확한 사실 서술)
- `value_impact` — 정수, 단위 **KRW 백만원**(ADR-0061). 금액 환산이 불가능한 발견은 그 사유를 기재
- `assumption_key` — 관련 가정과 연결(가정 레지스트리)
- `evidence_ref` — 증적 위치

## 흐름

```mermaid
flowchart LR
  D[실사 발견] --> F[dd_finding 기록\nvalue_impact 포함] --> V[밸류에이션 반영] --> IC[IC 패키지]
```

## 출처 매핑

| 주장 | 근거 |
|---|---|
| value_impact 단위·의무 | ADR-0061, business-manual_ko §"DD 발견사항" |
| IC 패키지 포함 | ADR-0100, ic-package 라우트 |
