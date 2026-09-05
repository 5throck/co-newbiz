---
governance_doc_id: gov-des-04
layer: knowledge-hub-content
title: "표준 화면 패턴 P0~P5"
scope: co-newbiz
owner_agent: design-system-agent
version: "1.0.0"
effective_from: "2026-09-05"
---
# 표준 화면 패턴 P0~P5

12단계 화면 행위는 5가지 동형 클래스로 수렴합니다(2026-09-01 표준화면패턴 설계문서 §3).

| 패턴 | 성격 | 대표 화면 |
|---|---|---|
| P0 Shell | 공통 골격(헤더·사이드바·StageRail) | 전체 |
| P1 Registry | 목록·레지스트리 관리 | S6 Long List, S7 Short List |
| P2 Report | 리포트 열람 | S1 시장분석, S9 DD 리포트 |
| P3 Decision | 판정·채점 | S3 판정, S4, S7 판정, S10 투자구조, S11 IC |
| P4 Execution | 실행·체크리스트 | S5, S9 체크리스트, S11 설립 실행, S8 파이프라인 |
| P5 Monitoring | 모니터링 대시보드 | S12, /pipeline |

**복합 단계 규칙**: 한 단계가 복수 패턴이면 위→아래 배치, 패턴 전환 지점은 SectionToolbar로 구분.
**완료 강제**: 선행 단계 미완료 시 done 불가(S11 설립 실행 선례) — 화면도 엔진 술어와 동일하게.

## 출처 매핑

| 주장 | 근거 |
|---|---|
| 패턴 정의 | docs/designs/2026-09-01-standard-screen-patterns-design_ko.md §3~5 |
| S10 추가 | flow.spec v2.2.0, ADR-0106 |
