---
lang: ko
lang_reason: source-material
---

# 머리 액션·스트립 위치·AI 버튼·폰트 스케일 표준화 — S1–S12 머리 통일 (Implemented)

- **일자**: 2026-10-22
- **상태**: Implemented (사용자 리포트 4건 — 우상단 버튼 기능 불일치, S8 머리 밀림, 스트립 위치 불일치, 폰트·AI 버튼 비표준 — 에 대한 실측 기반 수선)
- **관련**: `docs/design-system/design-screens.md`(표준 해부 순서 등록), `design-guide.md`(AI 액션 버튼 표준), `docs/design/icon-vocabulary.yaml`(🤖 AI 마커 확장), ADR-0120(단계 연계 스트립), ADR-0160 부록 b(범위 밖 항목), `components/StageFrame.tsx`(railSlot·head nav)

## 1. 결정

| # | 항목 | 결정 |
|---|---|---|
| 1 | 머리 우상단 버튼의 기능 | **모든 단계 화면(S1–S12)의 머리 우상단 버튼 = "다음: {다음 적용 단계명} →" 내비게이션으로 통일.** StageFrame이 렌더 책임(단일 구현)이며, 트랙 인지 스킵(nextApplicableStage)으로 다음 적용 단계를 계산한다. 단계의 기록·생성·제안·종료 액션은 머리에서 각 작업 면(결정 탭·폼·목록)으로 이동(인라인) — GateDecisionJump에 inline 전달 추가. S12(종료)는 다음이 없어 숨긴다. 트랙 미확정(로딩 중)에도 숨긴다(fail-honest — 트랙 전용 단계로 잘못 안내 방지). |
| 2 | 스트립 위치 | **입력과 출력 스트립은 목적선 바로 다음, 레일/StageTabs 행 앞**에 렌더 — S1–S12 전 화면 동일 순서(h1 → 목적 → 스트립 → 레일/탭 → 가이던스 → 본문). 절대 px는 화면 크롬(브레드크럼·탭 행 높이)에 따라 달라질 수 있으나 슬롯 순서는 동일. |
| 3 | 복합 단계(S6·S7) | 현재 경로의 단계(pathStageId)를 기준으로 다음을 계산 — /s6은 "다음: 대상 선정", /s7은 "다음: 사업성 분석". StageFrame이 usePathname으로 /sN 세그먼트를 읽어 ids 범위에서만 채택. |
| 4 | 프로젝트 화면 머리 밀림 | /projects/** 화면의 StageTabs(스테퍼·탭 행·서브탭 행)가 StageFrame보다 먼저 렌더되던 구조를 **railSlot prop으로 해소** — StageFrame이 h1 → 목적 → StageTabs(레일 슬롯) → 스트립 → 가이던스 순서로 머리를 최상단 유지. |
| 5 | 폰트 스케일 | 2단계 토큰(--fs-body/--fs-caption) 외 잔존을 전부 수렴: TSX 189+8건(codemod), **styles.css 컴포넌트 계층 22건(0.9/0.95rem → var(--fs-body))**. h1(16px)은 프레임 고정. 실측: S12 화면 13/14/16px만 존재. |
| 6 | AI 액션 버튼 표준 | **[아이콘 + 기능 + (AI)]** 형태로 통일 — 생성·재생성 계열: "🤖 추천 생성 (AI)", "🤖 재생성 (AI)"; AI 초안 보조 동작: "초안 버리기 (AI)". 🤖는 icon-vocabulary의 경계 #2 마커(emoji-ai-marker). icon-vocabulary.yaml에 결정-of-record 등록. |
| 7 | 복합 단계 머리 내비게이션 | S6·S7 복합 프레임의 머리 버튼이 항상 S6 기준이던 결함 — 경로의 단계 기준으로 계산(pathStageId). |

## 2. 검증

- 12경로 실측: 머리 버튼 라벨·스트립 top 전수 확인(S12는 숨김이 정답), S12 폰트 13/14/16px만 존재, tsc 0 에러, design-lint 5/5 PASS, 단위 테스트 전체 green(라벨 고정 테스트 5건 수정된 계약으로 갱신).

## 3. 문서 반영

- design-screens.md: 표준 해부 순서에 스트립 위치·복합 단계 경로 기준 등록.
- design-guide.md: AI 액션 버튼 표준(🤖 기능 (AI)) 등록.
- icon-vocabulary.yaml: emoji-ai-marker 엔트리에 액션 버튼 표준 등록(완료).
- 라벨 교정: S5 "타당성 검토 실행" → "평가 기록 (사람이 확정)", S11/S12 "투심(S11)·포트폴리오(S12)" → "투자심사(S11)·사후 관리(S12)" (스테이지명 기반).
