# 리서치 노트 — 디자인 토큰 아키텍처(W3C DTCG) 표준 관행

> 🌐 외부 참고 자료. 조사일: 2026-09-05. handbook-variables.css 토큰 체계의 업계 표준 비교용.

## 표준 관행

1. **W3C DTCG 표준 정식화**: Design Tokens Community Group이 2025-10-28 v2025.10 안정 규격을
   발표(Adobe·Figma·Google·Microsoft 등 40개 이상 조직 참여) — `$value`/`$type` 공통 스키마,
   `{color.brand.500}` 형태의 참조가 플랫폼 전반에서 일관되게 해석된다
2. **3계층 아키텍처가 지배적 권고안**: Primitive(`blue-500`) → Semantic(`action-color`) →
   Component(`button-bg-primary`) — 계층을 올바르게 나누면 값 하나 변경이 전체 화면에 깨끗하게
   전파된다. 토큰 혼란의 대부분은 한 계층으로 뭉개서(컴포넌트가 원시 hex를 직접 참조) 생긴다
3. **범위는 작게 시작**: 색·간격·타이포·radius를 아우르는 30~50개 토큰으로 시작 — 아무도 채택하지
   않는 400개 토큰 목록은 아무도 쓰지 않는 300개 컴포넌트 라이브러리와 같은 실패 패턴
4. **단일 진실 원천(SSOT) 원칙**: 토큰마다 원천을 하나로 정하고 나머지는 그로부터 생성 — Figma와
   코드가 따로 놀면 사실상 두 개의 디자인 시스템을 유지하게 된다
5. **거버넌스**: 토큰 변경은 공유 API 변경과 동일한 무게로 다뤄야 한다 — `color-primary-500`을
   blue에서 green으로 바꾸는 PR은 리뷰 없이 병합되어서는 안 된다

## co-newbiz 매핑

- `handbook-variables.css`의 `--bg/--text/--border/--accent` 체계는 이미 **용도 기반 Semantic
  계층**을 따르고 있음(하드코딩 색상 금지 규칙과 일치) — Primitive 계층(원시 hex)이 별도 파일로
  분리되어 있는지는 별도 확인 필요.
- ":root → prefers-color-scheme → .dark" 3계층 다크모드는 DTCG의 "참조가 플랫폼 전반에서 일관
  해석"되어야 한다는 원칙과 같은 방향 — 신규 색 추가 시 3계층 모두 정의해야 하는 co-newbiz 규칙은
  "토큰 변경을 API 변경처럼 다뤄라"는 거버넌스 권고의 구체적 구현.

## 출처

- Design Tokens Community Group, "Design Tokens Format Module 2025.10" — https://www.designtokens.org/tr/drafts/format/ (접근일 2026-09-05)
- CoderCops, "Design Tokens in 2026: The W3C Format Finally Standardizing Cross-Platform Design" — https://blog.codercops.com/blog/design-tokens-2026-w3c-format-guide (접근일 2026-09-05)
- The Masterly, "Design Tokens: A Practical Guide to Naming, Tiers, and the Figma-to-Code Workflow" — https://www.themasterly.com/blog/design-tokens (접근일 2026-09-05)
- Malaka Venugopal Reddy, "Design tokens with the W3C standard" — https://malakavenu.com/articles/design-tokens-w3c-2026 (접근일 2026-09-05)
