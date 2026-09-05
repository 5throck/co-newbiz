---
lang: ko
lang_reason: source-material
counterpart: component-catalog-naming.md
---

# 리서치 노트 — 컴포넌트 카탈로그·네이밍 표준 관행

> **언어**: [English](component-catalog-naming.md) · **한국어**

> 🌐 외부 참고 자료. 조사일: 2026-09-05. 주요 컴포넌트 카탈로그 문서화 방식의 업계 관행 비교용.

## 표준 관행

1. **Atomic Design 구조는 여전히 널리 쓰인다**: atoms(버튼·아이콘·입력) → molecules(입력그룹·
   리스트 아이템) → organisms(내비게이션바·카드) → templates(레이아웃 골격) → pages — 파일/폴더
   조직화에 특히 유용
2. **2026년 흐름은 "화학 은유"에서 "의미 기반 네이밍"으로 이동**: atom/molecule/organism 같은
   추상적 분류 대신, 컴포넌트가 무엇을 하고 어디에 쓰이는지 이름 자체가 전달하는 목적 기반 네이밍이
   확산 — 구조적 위계는 폴더 구조로, 실제 사용 이름은 의미 기반으로 이원화하는 하이브리드가 주류
3. **네이밍 컨벤션 예시**: 접두사 기반(`btn-`, `card-`, `nav-`), BEM(Block-Element-Modifier),
   또는 CFPB 디자인 시스템처럼 CSS 클래스에 `a-`(atom)/`m-`(molecule)/`o-`(organism)/`u-`(utility)
   접두사를 붙이는 방식
4. **카탈로그 문서화 체크리스트**: 모든 UI 요소가 하나의 atom으로 추적 가능해야(organism·template에
   raw markup 없음), 컴포넌트가 디자인 토큰을 참조해야, 컴포넌트당 단일 책임, 계층구조가 문서화되어
   있거나 디렉터리 구조에서 자명해야 함
5. **토큰-컴포넌트 연결**: 토큰 네이밍이 명확·일관되어야 컴포넌트가 무엇을 참조하는지 혼란이
   줄어든다 — 컴포넌트 카탈로그와 토큰 카탈로그는 별개 문서가 아니라 상호 참조되어야 한다

## co-newbiz 매핑

- 현재 컴포넌트 카탈로그(StageFrame·ProjectSubNav·GateDecisionPanel·CommitteePanel 등)는
  기능 목적 기반 네이밍(의미 기반)을 이미 따르고 있어 2026년 업계 흐름과 부합.
- "새 상세 화면은 ProjectSubNav를 반드시 포함(고아 화면 금지)" 규칙은 카탈로그 문서화 체크리스트의
  "모든 UI 요소가 하나의 표준 컴포넌트로 추적 가능해야 한다"는 원칙과 동일한 방향.
- 표(data-table) 헤더·셀 정렬 규칙, 목록 복귀 단일 패턴(ListBackButton)은 "컴포넌트당 단일 책임 +
  전역 재사용" 원칙의 구체 사례.

## 출처

- CFPB Design System, "Atomic components" — https://cfpb.github.io/design-system/development/atomic-components (접근일 2026-09-05)
- Namastedev, "Design Systems 101: Tokens, Components, and Documentation" — https://namastedev.com/blog/design-systems-101-tokens-components-and-documentation/ (접근일 2026-09-05)
- UX Design Bootcamp (Medium), "A guide to naming components on Design System effectively" — https://bootcamp.uxdesign.cc/a-guide-for-naming-components-on-design-system-effectively-7c32f76861a9 (접근일 2026-09-05)
