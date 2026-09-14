---
governance_doc_id: gov-des-03
layer: docs-content
title: "주요 컴포넌트 카탈로그"
scope: co-newbiz
owner_agent: frontend-engineer
version: "1.0.0"
effective_from: "2026-09-05"
lang: ko
lang_reason: source-material
counterpart: design-components.md
---
# 화면마다 반복되는 부품들을 어떻게 재사용하는가

> **언어**: [English](design-components.md) · **한국어**

레고 블록처럼, 화면을 이루는 조각들을 한 번 잘 만들어두면 여러 화면에서 그대로 가져다 쓸 수
있습니다. 이런 재사용 가능한 화면 조각을 **컴포넌트**라고 부릅니다. 매번 새로 만드는 대신
이미 검증된 컴포넌트를 조합하면, 화면마다 디자인이 미묘하게 달라지는 문제를 막을 수 있고
개발 속도도 빨라집니다. 실제 구현 코드는 `app/web-next/components/`에 있으며, 아래는 co-newbiz
화면에서 반복적으로 쓰이는 대표 컴포넌트입니다.

| 컴포넌트 | 무슨 역할을 하는가 | 어디서 쓰이는가 |
|---|---|---|
| StageFrame | 각 단계 화면의 뼈대(제목·설명·본문이 들어갈 자리) | S1~S12 모든 단계 화면 |
| ProjectSubNav | 한 프로젝트 안에서 개요·사업성·실사·투자구조·투자심의 등 하위 화면을 넘나드는 탭 | 프로젝트 상세 화면 전체 |
| GateDecisionPanel | "승인/보류/중단"을 선택하고 그 사유·결정자를 기록하는 카드 | 사람의 승인이 필요한 모든 화면 |
| CommitteePanel | 위원회 참석자 좌석 배치, 점수표, 회의록을 보여주는 패널 | S4·S11 위원회 심의 화면 |
| ListBackButton | 목록 화면으로 되돌아가는 버튼(모든 화면에서 똑같이 동작) | 목록에서 상세로 들어간 화면 |
| data-table + .table-scroll | 목록·요약 데이터를 보여주는 표(화면 폭보다 넓으면 가로로 스크롤) | 전체 화면 |
| list-table (data-table 변형) | 목록 표준 — 행별 작업 버튼이 있는 표. 고정 열 레이아웃, 최대 폭 64rem 제한, 모든 열에 헤더 | 전체 목록 화면 (S1 산업 목록, S2 기회 퍼널, 계열사 목록, 시너지 분석 목록, 관리자 사용자·사업목표) |

## 화면을 만들 때 지켜야 할 규칙

- 새로운 상세 화면을 만들 때는 반드시 ProjectSubNav를 포함해야 합니다. 이 탭 없이 만들어진
  화면은 다른 하위 화면들과 단절된 "고아 화면"이 되어, 사용자가 거기서 다른 메뉴로 돌아가는
  법을 찾지 못하게 됩니다.
- 표의 헤더와 실제 데이터 셀은 같은 열끼리 정렬 방식(왼쪽/가운데/오른쪽 맞춤)을 반드시
  일치시킵니다. 헤더는 가운데 정렬인데 셀은 왼쪽 정렬이면 표가 시각적으로 어긋나 보입니다.
- **목록 테이블 표준**: 행별 작업 버튼(`sizing-actions-cell`)을 렌더링하는 `.data-table`에는
  반드시 `list-table` 클래스를 함께 씁니다. 자동 레이아웃 표에서 폭 제약이 없는 유일한 열인
  라벨 열(기회명·산업명)이 남은 화면 폭을 전부 흡수하면 점수·작업 열이 화면 오른쪽 끝으로
  밀려나 이름과 동떨어져 보이는 문제를 막는 표준입니다. 규칙: (1) `.list-table`은 고정 열
  레이아웃에 최대 폭 64rem 제한을 걸습니다. (2) 기본 라벨 열을 제외한 모든 열에 폭 클래스를
  명시합니다. (3) every column is headed in the accessibility tree — the actions column header is a visually hidden (`sr-only`) `작업`: sighted readers need no label for self-evident row buttons, screen readers still announce the column (2026-09-15 readability report); (4) 긴 상태 칩은 열을 넘어서지
  않고 열 안에서 줄바꿈됩니다. (5) 날짜 열(YYYY-MM-DD)에는 `col-date` 클래스를 씁니다 — 표준폭 7rem + 줄바꿈 금지로
  날짜가 두 줄로 접히지 않습니다. design-lint가 클래스·작업 헤더가 빠진 행 작업 표를 실패
  처리합니다.
- 이 문서 자체를 포함한 모든 참조 문서는 `/library` 화면(목록+상세 2단 뷰)에서 열람하며,
  별도의 챕터 분할이나 페이지 이동 버튼 없이 문서 하나가 그대로 한 화면에 표시됩니다.

## 🌐 외부 참고 — 컴포넌트 목록은 업계에서 어떻게 관리되는가

전통적으로는 컴포넌트를 "원자(atom) → 분자(molecule) → 유기체(organism)"처럼 화학 용어로
분류하는 Atomic Design 방식이 널리 쓰였습니다. 다만 2026년 기준 업계 흐름은 이런 추상적인
분류 이름보다, 컴포넌트의 이름 자체가 "무엇을 하고 어디에 쓰이는지"를 바로 알려주는 의미
기반 네이밍으로 옮겨가고 있습니다. co-newbiz의 컴포넌트 이름(StageFrame, GateDecisionPanel
등)은 이미 이런 의미 기반 네이밍을 따르고 있어 이 흐름에 부합합니다. 업계는 또한 "화면의 모든
요소가 어떤 표준 컴포넌트에 속하는지 추적할 수 있어야 한다"는 점을 컴포넌트 카탈로그의 핵심
체크 항목으로 꼽는데, "새 상세 화면은 ProjectSubNav를 반드시 포함해야 한다"는 co-newbiz의
규칙이 바로 이 원칙의 구체적인 적용 사례입니다. 출처·상세는
[docs/research/component-catalog-naming.md] 문서 참조 (조사일 2026-09-05).

## 출처 매핑

| 주장 | 근거 |
|---|---|
| 컴포넌트 목록 | docs/architecture/ui-spec.md as-built, docs/designs/2026-09-01 표준화면패턴 |
| 목록 복귀 단일 패턴 | PR #219 디자인 정비(ListBackButton 통합) |
| 카탈로그 네이밍 관행 | docs/research/component-catalog-naming.md |
