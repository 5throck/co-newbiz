---
governance_doc_id: gov-des-05
layer: knowledge-hub-content
title: "접근성·유니버설 디자인"
scope: co-newbiz
owner_agent: design-system-agent
version: "1.0.0"
effective_from: "2026-09-05"
---
# 접근성·유니버설 디자인 (UD)

모든 화면의 출하 조건입니다. UD 감사(2026-09-05)에서 확정된 규칙:

1. **키보드**: 전역 `focus-visible` 링 — 마우스 없이 모든 조작 가능.
2. **표**: `caption`(sr-only) + `scope` 속성으로 구조 전달, 헤더/셀 정렬 열 단위 일치.
3. **상태 색**: 색맹 사용자를 위해 색+텍스트 라벨 병용(배지는 항상 텍스트 포함).
4. **모션**: `prefers-reduced-motion` 존중(로그인 롤링 배경은 정적 프레임 대체).
5. **라벨**: 아이콘 단독 버튼은 `aria-label` 필수.
6. **대비**: 본문 텍스트 대비 4.5:1 이상(다크/라이트 양쪽 테마에서 토큰 검증).

## 🌐 외부 참고 — 디자인 시스템·접근성 표준

- 토큰은 색상값이 아닌 **용도 기반 의미명**으로(예: color-text-primary) — Material Design 3
  https://m3.material.io/foundations/design-tokens (접근일 2026-09-05)
- 대비는 토큰 문서의 정적 수치만으로 보장되지 않음 — 런타임 페어 검증 필요
  https://medium.com/@SaraTariqMustafa/design-tokens-dont-fix-accessibility-they-can-hide-it-dc07534864e6 (접근일 2026-09-05)
- WCAG 2.1 대비 기준: 일본문 4.5:1, 대형 텍스트 3:1 — https://www.w3.org/TR/WCAG21/ (접근일 2026-09-05)

## 출처 매핑

| 주장 | 근거 |
|---|---|
| 1~5항 | 2026-09-05 UD 감사 정비(PR #219 계열), ui-spec as-built |
| 대비 기준 | W3C WCAG 2.1 (위 외부 참고) |
