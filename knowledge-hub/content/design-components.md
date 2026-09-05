---
governance_doc_id: gov-des-03
layer: knowledge-hub-content
title: "주요 컴포넌트 카탈로그"
scope: co-newbiz
owner_agent: frontend-engineer
version: "1.0.0"
effective_from: "2026-09-05"
---
# 주요 컴포넌트 카탈로그

표준 화면을 구성하는 재사용 컴포넌트. 구현 위치는 `app/web-next/components/`.

| 컴포넌트 | 용도 | 적용 화면 |
|---|---|---|
| StageFrame | 스테이지 프레임(제목·설명 슬롯·children) | 모든 S1~S12 스테이지 화면 |
| ProjectSubNav | 프로젝트 하위 탭(개요·사업성·실사·투자구조·IC·사후·추진계획·프로세스) | /projects/[id]/* |
| GateDecisionPanel | 게이트 결정 카드(APPROVE/HOLD/KILL + 사유·결정자 기록) | 게이트 보유 화면 |
| CommitteePanel | 위원회 좌석·스코어카드·회의록 | S4·S11 심의 |
| ListBackButton | 목록 복귀 버튼(단일 패턴) | 목록→상세 화면 |
| data-table + .table-scroll | 목록·요약 표(폭 초과 시 가로 스크롤) | 전체 |

## 규칙

- 새 상세 화면은 ProjectSubNav를 반드시 포함(고아 화면 금지 — ADR-0105 패리티).
- 표 헤더와 셀의 정렬은 열 단위로 일치(ADR-0088 세부).
- 목차·prev/next는 knowledge-hub 문서 페이지 규약을 따른다.

## 출처 매핑

| 주장 | 근거 |
|---|---|
| 컴포넌트 목록 | docs/ui-spec.md as-built, docs/designs/2026-09-01 표준화면패턴 |
| 목록 복귀 단일 패턴 | PR #219 디자인 정비(ListBackButton 통합) |
