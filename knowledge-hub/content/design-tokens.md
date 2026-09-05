---
governance_doc_id: gov-des-02
layer: knowledge-hub-content
title: "디자인 가이드 — 토큰·타이포·간격"
scope: co-newbiz
owner_agent: design-system-agent
version: "1.0.0"
effective_from: "2026-09-05"
---
# 디자인 가이드 — 토큰·타이포·간격

원본: `docs/design-guide.md`. 여기는 화면 제작 시 빠르게 참조하기 위한 요약입니다.

## 색 토큰 (handbook-variables.css)

| 토큰 | 용도 |
|---|---|
| `--bg`, `--bg2`, `--bg3` | 화면 배경 3단 (본문/패널/강조 배경) |
| `--text`, `--text-muted`, `--text-dim` | 본문/보조/흐림 텍스트 |
| `--border` | 경계선 전용 |
| `--accent` 계열 | 상호작용·강조(링크, 활성 탭) |
| `--bg-info/note/warn/success/error` | 콜아웃·안내 배경 |

색은 반드시 토큰으로만 지정한다. 다크모드는 `:root → prefers-color-scheme → .dark` 3계층으로
자동 대응되므로, 새 색을 추가하면 세 계층 모두 정의해야 한다.

## 타이포·간격

- 본문 15px/1.65, 보조 14px, 라벨 12px(마이크로) — 화면 요소 위계의 기준.
- 간격은 8px 그리드(`--spacing-unit`) 배수.
- 금액 표기: 정수 백만원 + 콤마(예: 9,000), 소수점 없음 — 전 화면 공통.

## 출처 매핑

| 주장 | 근거 |
|---|---|
| 토큰 목록 | docs/design-guide.md, knowledge-hub/docs/assets/css/handbook-variables.css |
| 금액 표기 | ADR-0061(dd value_impact 단위), 2026-09-05 디자인 정비 PR #219 |
