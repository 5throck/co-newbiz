---
lang: ko
lang_reason: source-material
---

# Design: 디자인 프로세스 확립 — 원칙에서 표준 화면까지 (2026-09-01)

**Status**: Accepted (ADR-0087)
**Scope**: co-newbiz 웹 전체의 디자인 관련 작업 수행 순서·산출물·게이트
**Benchmark**: Material Design 3(토큰 3계층), IBM Carbon, Atlassian/Shopify Polaris(거버넌스), EightShapes(스케일), Ramotion("시스템은 컴포넌트·토큰이 아니라 원칙에서 시작된다"), Martin Fowler(토큰 = 배포 가능한 디자인 결정 데이터)

---

## 1. 확립하는 프로세스 — 7단계 파이프라인

외부 표준들의 합의된 순서를 따른다. **뒤 단계의 산출물은 앞 단계 없이 만들지 않는다.**

```
① 디자인 원칙 (Philosophy & Principles)
② 디자인 토큰 (Tokens — primitive → semantic → component 3계층)
③ 스타일 가이드 · 컬러 시스템 (Style Guide)
④ 표준 아이콘 선정 (Iconography)
⑤ 주요 컴포넌트 구성 (Components)
⑥ 표준 화면 패턴 (Screen Patterns — P0~P5, ADR-0086)
⑦ 화면 조립·개발 (Screens — 패턴 조합 + 슬롯 채움)
```

### ① 디자인 원칙
- 철학·원칙 5항목은 `2026-09-01-standard-screen-patterns-design_ko.md` §2에 확정돼 있음
  (프로세스가 화면을 만든다 / 하나의 정신 모델 / 구조 고정·내용 확장 / 판정은 사람 / 절제의 심미성).
- **모든 디자인 산출물은 원칙과 충돌하면 반려**된다 — 원칙이 최상위 판정 기준.

### ② 디자인 토큰 (3계층 — Material 3·Contentful 합의안)
| 계층 | 예 | 소유 |
|---|---|---|
| primitive | `blue-500: #4c6ef5`, `space-2: 8px` — 절대값 사전 | 디자인(시스템) |
| semantic | `--primary: blue-500`, `--danger: red-500`, `--border` | 디자인+개발 합의 |
| component | `btn-ghost padding: var(--space-2) var(--space-6)` | 개발 |
- **토큰은 데이터로 관리한다**(Fowler): 디자인 결정을 `design-tokens.json` 단일 원본으로
  두고 styles.css가 이를 소비하는 구조로 전환한다(현행 styles.css 산재 값의 정리본).
- 근거: 현재 `sizing-new-form` 등 semantic-only 클래스가 CSS 정의 없이 쓰인 사례(ADR-0082)는
  토큰 원본 부재의 직접 피해였다.

### ③ 스타일 가이드 · 컬러 시스템
- 컬러: 기능 롤 기반 팔레트(primary·danger·상태 5종(success/warning/info/neutral/risk)·
  다크/라이트 쌍) — 현행 status-chip 색 체계의 정식화. 대비율(WCAG AA 4.5:1) 검증 포함.
- 타이포·간격: 단일 타이포 스케일, 4/8px 간격 스케일(ADR-0083 2-size 버튼과 정합)을
  가이드 문서로 확정.

### ④ 표준 아이콘 선정
- 단일 아이콘 세트 지정(현행 lucide-react 사용 중 — 이를 공식 표준으로 확정).
- **아이콘 어휘표**: 도메인 개념당 1개(시장=🏭 계열 아이콘 어휘를 표로 고정), 크기는
  버튼 2-size에 연동(16/20px). 신규 아이콘은 어휘표 등록 후 사용.

### ⑤ 주요 컴포넌트 구성
- components/(layout, crud, StageFrame) + styles.css 클래스가 컴포넌트 인벤토리.
- 컴포넌트는 토큰만 참조하고 하드코딩 금지 — design-lint 검출 대상.

### ⑥ 표준 화면 패턴 / ⑦ 화면 조립
- ADR-0086 확정 내용 그대로: P0 StageFrame + P1~P5 패턴, 슬롯 확장, 패턴 신설은 설계 개정+ADR.

## 2. 시스템 개발·구축 시 설계 단계 반영 (원칙)

**"UI를 포함한 시스템 개발의 설계 단계에는 본 파이프라인의 ①~⑥ 산출물이 설계 문서에
포함되어야 하며, ⑦ 구현은 ⑥ 패턴의 조합으로만 기술한다."**

- 설계 문서 템플릿 체크리스트(신규 화면·기능 설계 시):
  1. 사용 패턴 명시(P1~P5 중) + 신규 패턴 여부
  2. 사용 토큰·컴포넌트 목록(신규 토큰/컴포넌트는 이 단계에서 추가 승인)
  3. CRUD 상호작용(등록/수정/삭제) 표준 부합 여부 (ADR-0082)
  4. 아이콘 어휘표 등재 여부
- 판정 주체: design-system-agent(리뷰), platform-lead(승인) — 기존 3단계 리뷰(AI 1st →
  AI 2nd → 사람)와 동일 체계 안에서 운영.
- 게이트: 구현 PR은 design-lint를 통과해야 한다 —
  `cd app/web-next && bun run lint:design` (R1 버튼 2-size · R2 하드코딩 색상 ·
  R3 툴바 우회 · R4 단계 h1 · R5 window.confirm · R6 삭제 라벨).
  설계 문서 템플릿은 `DESIGN-CHECKLIST.md`, 토큰 원본은
  `app/web-next/design/design-tokens.json`.

## 3. 참고 출처
- [Material Design 3 — Design tokens](https://m3.material.io/foundations/design-tokens)
- [Contentful — 3계층 토큰](https://www.contentful.com/blog/design-token-system/)
- [Martin Fowler — Design Token-Based UI Architecture](https://martinfowler.com/articles/design-token-based-ui-architecture.html)
- [NN/g — Design Systems 101](https://www.nngroup.com/articles/design-systems-101/)
- [Figma — Design Systems 101](https://www.figma.com/blog/design-systems-101-what-is-a-design-system/)
- [Ramotion — Principles and Governance](https://www.ramotion.com/blog/design-system-guide-chapter-2-principles-and-governance/)
- [Atlassian Design Tokens](https://atlassian.design/tokens/design-tokens)
- [EightShapes — Tokens in Design Systems](https://medium.com/eightshapes-llc/tokens-in-design-systems-25dd82d58421)
