---
governance_doc_id: gov-des-00
layer: docs-content
title: "디자인 가이드 — Onyx 3.0"
scope: co-newbiz
owner_agent: design-system-agent
version: "1.0.0"
lang: ko
lang_reason: source-material
counterpart: design-guide.md
---
# Design Guide — co-newbiz Onyx 3.0

> **언어**: [English](design-guide.md) · **한국어**

> **상태**: v1.0 — 웹 앱(`app/web-next`)의 공식 디자인 정책. co-price의
> `docs/design.md`(UI/UX Design System v6.0)에서 파생되어 co-newbiz의 딜 검토
> 도메인에 맞게 조정되었습니다. 런타임 토큰은 `app/web-next/app/styles.css`에
> 있으며, 이 문서는 그 토큰이 구현하는 명세입니다. `bun run design:lint`가
> 기계적 규칙을 강제합니다.

---

## 1. 디자인 철학

1. **명확성 우선(Clarity-first)** — 모든 화면은 한 눈에 "무엇을 보고 있는지,
   무엇을 할 수 있는지, 다음에 무슨 일이 일어나는지"에 답합니다. 밀도는 높되,
   결코 답답하지 않게.
2. **근거 기반(Evidence-driven)** — 숫자, 출처, 이력(provenance)은 일급
   시민입니다. 재무 수치는 산 세리프(sans) 스택에 `tabular-nums` 정렬을 적용하며
   (`JetBrains Mono`는 코드/ID로 범위를 한정 — §4 참조), 모든 중요 값은 그 근거
   (소스 툴팁 / anchor_ref)에 연결됩니다.
3. **단계 안내(Stage-guided)** — UI는 S1~S7 프로세스를 반영합니다. 사용자는
   항상 딜이 어느 단계에 있는지, 현재 단계가 무엇을 요구하는지 보게 됩니다.
4. **에이전트 우선, 사람 확정(Agentic-first, Human-final)** — 에이전트가 실행하고
   추천하며, UI는 에이전트 출력을 검토하는 작업대입니다. 사람의 입력은 확인과
   수정이지, 처음부터 데이터를 입력하는 것이 아닙니다.
5. **일관성을 통한 신뢰(Trust through consistency)** — 동일한 의미는 어디서든
   동일하게 렌더링됩니다(RAG 색상, 상태 칩, 게이트 배지, 날짜/숫자 형식).
6. **기본값으로서의 접근성(Accessible by default)** — WCAG AA 명도 대비, 보이는
   포커스, 상태는 절대 색상만으로 전달하지 않음(아이콘 + 라벨 + 색상).

## 2. 디자인 원칙 (운영 규칙)

| # | 원칙 | 규칙 |
|---|---|---|
| P1 | 정의 기반 UI | 화면 구조는 `process/flow.spec.yaml`에서 나옵니다. 컴포넌트에 단계 하드코딩 금지 |
| P2 | 라이트 기본, 다크 대등 | `:root`는 라이트이며, `[data-theme="dark"]`는 대등한 일급 테마입니다. 흰색/검정을 하드코딩하지 말고 토큰을 사용 |
| P3 | 사실당 소스 하나 | 값은 저장된 레코드에서 렌더링되며, UI에서 재계산하지 않습니다 |
| P4 | 쓰기 경로는 명시적 | 모든 생성/수정/삭제에는 폼/다이얼로그, 감사 추적(audit trail), 성공/실패 피드백이 있습니다 |
| P5 | 신호는 다중 인코딩 | 상태 = 색상 + 아이콘 + 텍스트 (신호등: ● 완료 / ◐ 진행 / ○ 대기 / ✕ 종료) |
| P6 | 파생 상태는 계산 | `currentStage` 등은 계산됩니다(evaluateProcess). 저장하거나 손으로 편집하지 않습니다 |

## 3. 색상 시스템 (HSL 시맨틱 토큰)

모든 색상은 `styles.css`의 CSS 커스텀 프로퍼티로 존재합니다. 컴포넌트에
하드코딩된 hex/rgba 값은 린트 에러입니다(`design:lint`).

### 3.1 베이스 (라이트 `:root` / 다크 `[data-theme="dark"]`)
| 토큰 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `--bg` | `#f6f7f9` | `#0a0c10` | 페이지 배경 |
| `--surface` | `#ffffff` | `#12151b` | 카드, 패널 |
| `--surface-2` / `--surface-elevated` | `#f1f3f6` / `#ffffff` | `#181c24` / `#1a1f2a` | 돌출된 콘텐츠 |
| `--fg` / `--muted-fg` | `#171a21` / `#5d6572` | `#eceef2` / `#9aa1ad` | 텍스트 위계 |
| `--border` (+`-subtle`, `-bright`) | rgba(16,22,34,…) | rgba(255,255,255,…) | 구분 스케일 |
| `--primary` | `hsl(217 91% 45%)` | `hsl(217 91% 60%)` | 액션, 링크, 활성 내비게이션 |

### 3.2 상태 색상 (절대 색상만으로 판단 금지)
| 토큰 쌍 | 의미 | 항상 함께 사용 |
|---|---|---|
| `--green-bg/fg/border` + `status-green` | 통과 / GO / 완료 | ✓ 또는 ● 아이콘 + 라벨 |
| `--amber-bg/fg/border` + `status-amber` | 보류 / 노후(stale) / 경고 | ⚠ 또는 ◐ 아이콘 + 라벨 |
| `--red-bg/fg/border` + `status-red` | 실패 / 중단(kill) / 오류 | ✕ 또는 ● 아이콘 + 라벨 |
| `status-not-started` | 대기 / 잠김 | ○ 아이콘 + 라벨 |

### 3.3 파생 인터랙션 토큰
`--input-bg`, `--hover-bg`, `--sidebar-bg`, `--placeholder-fg`,
`--scrollbar-thumb(-hover)`, `--glass-bg`, `--glass-inset` — 테마당 하나의
정의만 두고, 컴포넌트는 토큰만 참조합니다.

## 4. 타이포그래피

| 역할 | 폰트 | 크기 / 굵기 | 비고 |
|---|---|---|---|
| 페이지 제목 (h1) | Pretendard | 1.25–1.5rem / 800 | 페이지당 하나 |
| 섹션 제목 (h2/h3) | Pretendard | 1–1.15rem / 700 | |
| 본문 | Pretendard | 0.85–0.9rem / 400 | line-height ≥ 1.55 |
| 보조 라벨 / 메타 | Pretendard | 0.8125–0.875rem (`--fs-caption`이 하한) | `--muted-fg`, 컬럼 헤더는 대문자 |
| 재무 수치 | Pretendard (sans) | 모두 / 700 | `tabular-nums`, 근처에 KRM 단위 라벨 |
| 코드 / ID | JetBrains Mono | 0.8125rem (`--fs-caption`) | `code` 요소 |

> **2026-10-22 리뷰 정합 (품평회 잔여 #5)**: 종전 보조 라벨 범위 `0.72–0.8rem`
> (11.5–12.8px)은 Wave U-2의 13px 하한(`--fs-caption` 0.8125rem — "13px 아래
> 마이크로 단계 없음", design-tokens.md) 밑이었다. 하한을 `--fs-caption`으로
> 못 박아 문서와 코드 토큰을 일치시켰다. 재무 수치의 레코드 기록(record)은
> **sans + `tabular-nums`** 이다 — 코드는 한 번도 JetBrains Mono로 렌더한 적이
> 없으므로 모노 규정은 문서 쪽 드리프트였고, JetBrains Mono는 코드/ID로 범위를
> 한정한다.

간격은 8px 기본 그리드(`0.25rem` 단위)를 따릅니다: 카드 패딩 16–24px, 리스트
간격 8–10px, 섹션 구분 24px 이상.

## 5. 레이아웃 아키텍처

- **앱 셸**: 고정 사이드바(S1~S7 단계 그룹, 관리자 섹션) + 상단바(왼쪽
  브레드크럼; 오른쪽 테마 토글, 사용자, 로그아웃) + 스크롤 가능한 콘텐츠 창.
- **콘텐츠 폭**: 콘텐츠 창은 가용 폭을 채웁니다(`max-width: none`) — 중앙
  정렬 max-width 변형은 열이 눌리는 결함을 유발하여 제거되었습니다. 밀도 높은
  테이블은 창 전체 폭을 사용할 수 있습니다.
- **딜 상세**는 단계 안내형입니다: 탭 바 위에 고정(sticky) 진행 헤더(S1~S7
  신호등 + 게이트 배지)가 있으며, Workflow 탭이 기본값입니다.
- **반응형**: 880px 이하에서는 사이드바가 접히고, 그리드는 1열로 축소됩니다.

## 6. 컴포넌트 표준

| 컴포넌트 | 사양 |
|---|---|
| 카드 | `.card` / `.glass` — surface + border + radius-3xl, 호버 시 들림 ≤4px |
| 버튼 | `.btn-primary`(기본 액션, 화면당 하나 — `PrimaryAction`이 렌더하는 클래스; `.btn-premium`은 폐기 예정 별칭, 2026-10-22 리뷰 — 남은 호출처를 이관하고 새 코드에 쓰지 않음), `.btn-ghost`(보조), 파괴적 액션은 확인 다이얼로그 필수 |
| 테이블 | `.data-table` — border-b 행; **헤더 셀은 기본적으로 중앙 정렬**(`.data-table th`), 본문 셀은 왼쪽 정렬, 숫자 컬럼은 `.col-num`으로 오른쪽 정렬(헤더+셀); 넓은 테이블은 `min-width`와 함께 `.table-scroll`로 감쌈; 수치에는 `tabular-nums`, `caption.sr-only`. 헤더 정렬 예외는 컬럼별 오버라이드로만 허용 — 기본값을 다시 왼쪽 정렬로 바꾸지 않음 |
| 배지 / 칩 | `.status-chip status-*` — 아이콘 + 텍스트, 절대 색상만으로 판단 금지 |
| 폼 컨트롤 | 토큰 배경/테두리, 포커스 링 `--primary` 3px, 라벨 필수 |
| 탭 | `.tab-nav` / `.stage-stepper` — `aria-current`, 상태는 URL에 보존 |
| 모달 | `.modal-backdrop` + `.modal-panel` — ESC/배경 클릭 닫기, 포커스 트랩 |
| 신호등 | `.process-light pl-*` — 아이콘 + 단계 ID + 상태 라벨 |

## 7. 접근성

- 명도 대비 ≥ AA (라이트 테마 토큰이 이에 맞게 조정되어 있음; design:lint
  보고서로 검증).
- 아이콘만 있는 컨트롤에는 `aria-label`을, 모든 테이블에는 `caption.sr-only`를
  제공하며, 상태는 아이콘+텍스트+색상을 함께 사용해 전달합니다.
- 포커스는 항상 보입니다(포커스 링 토큰); 다이얼로그는 포커스를 이동시키고
  원위치시킵니다.

## 8. 디자인 린트 (기계적 강제)

`bun run design:lint` (scripts/co-newbiz/design-lint.ts)는 다음 경우 CI를
실패시킵니다:
- `components/**`와 `app/**`에서 styles.css 토큰 정의부 외부에 하드코딩된
  hex/rgba 색상,
- `onInput=` 핸들러 (한국어 IME 조합 버그),
- `.app-content` 내부의 `<main>` 중첩,
- `aria-label` 없는 아이콘 전용 버튼,
- `api.delete` 호출에 `window.confirm`이 없는 삭제 핸들러.
