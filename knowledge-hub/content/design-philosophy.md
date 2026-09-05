---
governance_doc_id: gov-des-01
layer: knowledge-hub-content
title: "디자인 철학·원칙"
scope: co-newbiz
owner_agent: design-system-agent
version: "1.0.0"
effective_from: "2026-09-05"
---
# 디자인 철학·원칙

이 문서는 co-newbiz 웹 화면 전체(S1~S12)를 관통하는 디자인 판단 기준을 모은 것입니다.
표준 화면 패턴 설계문서(`docs/designs/2026-09-01-standard-screen-patterns-design_ko.md`)와
`docs/design-guide.md`를 종합합니다.

## 원칙

1. **상태가 아니라 판정을 보여준다** — 배지·칩은 "상태"(진행중/대기)와 "판정"(승인·거절·필수)을
   시각적으로 구분한다. 사용자가 색만으로 승인 여부를 오독해서는 안 된다.
2. **엔진 권고 ≠ 채택** — AI 제안 값은 항상 "제안" 라벨과 함께 표시되고, 인간 결정 UI(게이트
   결정 카드)와 시각적으로 분리된다(경계 #2).
3. **한 화면 한 목적** — 목록은 고르고, 상세는 읽고, 판정은 결정한다. P0~P5 표준 패턴 참조.
4. **토큰 우선** — 색·간격·타이포는 handbook-variables.css 토큰만 사용. 화면 코드에 새 하드코딩
   색상 금지.
5. **접근성은 기본값** — 키보드 focus-visible 링, 표준 aria 속성, reduced-motion 존중(로그인
   배경 등)은 모든 화면의 출하 조건.

## 출처 매핑

| 주장 | 근거 |
|---|---|
| 경계 #2 시각 분리 | docs/adr/0106, flow.spec 경계 불변식 |
| 토큰 우선 | docs/design-guide.md, 표준화면패턴 설계문서 §2 |
| 접근성 출하 조건 | ui-spec as-built(UD 감사), manual-authoring 스킬 |
