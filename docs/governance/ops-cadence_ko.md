---
lang: ko
lang_reason: source-material
counterpart: ops-cadence.md
---

# 운영 리듬과 동시 딜 수용력 (Operating Rhythm and Concurrent-Deal Capacity)

**Owner**: process-governance-manager (시스템 의존 행은 platform-lead와 공동)
**Design of record**: design v1.0 §1-10 / 회의 M7-3 / 회의 M8
**상태**: Stage 3 초안 — 캐던스 표는 오늘날 수동으로 실행 가능(Stage 2/3); 자동화 행(`job_run`, 예약 알림)은 Stage 5 출시와 함께 활성화된다.

## 1. 캐던스 표

| 캐던스 | 작업 | Owner |
|---|---|---|
| 일간 | 헬스 체크, 백업 확인, 수집 배치 결과/실패, 에러 로그 분류, 알림 큐 | sre *(Stage 5)* |
| 주간 | 의존성 취약점 스캔, 감사 로그 검토, 용량 추이, staleness 리포트, 오탐 알림 검토, 미등록 용어 리포트, 컴플라이언스 리포트 + 만료 임박 워이버 | security-engineer, dba *(Stage 5)*; glossary-curator, compliance-officer *(현재 활성)* |
| 월간 | 복구 훈련, 접근 권한 검토, 쿼리 성능 검토, **RAG 임계값 보정**, 거버넌스 KPI 집계, 해석 검토/게시, ADR 백로그 정리 | dba, security-engineer *(Stage 5)*; process-governance-manager, compliance-officer, docs-writer *(현재 활성)* |
| 분기 | 위협 모델 갱신, DR 훈련, 마스터데이터 일관성 감사, **프록시 체인 재보정**, 규제/프로시저 정기 검토(워이버 집중 조항과 해석 질의 주제가 개정 우선순위를 결정), 지역 프로필 갱신, 온보딩 자료 갱신 | security-engineer, platform-lead *(Stage 5)*; process-governance-manager, compliance-officer, region-lead *(현재 활성)* |
| 연간 | 전체 거버넌스 문서 정기 검토(`governance_doc.review_cycle_months` 기반 만료 문서 강제 재승인), 전체 규제 시스템 회고 | process-governance-manager, compliance-officer |

*(Stage 5)* 표기 행은 스케줄러와 모니터링 시스템을 필요로 하며 수동으로 실행할 수 없다 — 시스템이 존재하기 전에 캐던스 계약을 고정해두기 위해 여기에 나열된 것이다(design의 문서 우선 원칙, ADR-0032). *(현재 활성)* 표기 행은 Stage 3부터 수동으로 실행된다.

## 2. 동시 딜 수용력 — 사이클마다 계산, 고정 아님 (O-16 해결)

회의 M7-3이 수식을 확정했다:

```
concurrent_deal_cap = min(reviewer_capacity / 0.3, wall_group_compatible_assignments)
```

**O-16은 Stage 1 마감 시 "리뷰어 배분 확정"으로 사용자에게 에스컬레이션되었다.** 사용자의 해결(2026-08-20, `docs/planning/transition-plan.md` §5.5): 리뷰어 구성은 리뷰마다 달라지므로 단일 고정 FTE 수치는 인력이 바뀌는 순간 쓸모없어진다. 이것은 연기가 아니라 **상시 운영 규칙**으로 해결되었다:

- `reviewer_capacity`는 **모든 리뷰 사이클 시작 시점에 새로 읽는다**, 해당 사이클에 실제 활성 리뷰어로 배정된 사람들 기준으로(각 리뷰어의 확정 투입 일수/주 ÷ 5의 합, FTE로 표현).
- 상한은 고정 표에서 조회하는 것이 아니라 **매 사이클 재계산**된다. 확정 리뷰어 시간이 0.5 FTE인 사이클은 `cap = min(0.5/0.3, wall_group_compatible) ≈ 1`; 1.5 FTE인 사이클은 wall-group 상한이 적용되기 전까지 `cap ≈ 5`.
- **보수적 하한**: 사이클에 리뷰어 용량 수치가 아직 없는 경우(예: 배정 확정 전의 첫 사이클), 상한은 design 원안의 "3에서 시작"이 아니라 회의 M7-3에서 확정된 보수적 값인 **1**로 기본 설정된다 — 원안은 실제로 확인된 적 없는 더 강한 리뷰어 기반을 가정한 것이었다.
- 이 계산은 Stage 5가 실제 `project_member`/`reviewer` 배정 레코드에 대해 자동화할 때까지 수동이다(해당 사이클의 확정 리뷰어 명단에 대한 `process-governance-manager`의 계산).

**이것이 연기가 아니라 옳은 해결인 이유**: 오늘 정한 고정 숫자는 인력이 처음 바뀌는 시점에 틀리게 되고, 어떤 리뷰어가 조용히 과부하에 걸리기 전까지는 아무도 눈치채지 못한다. 사이클마다 재계산하는 것은 design 자체의 수식이 의도대로 작동하는 것이며, 이전의 "지금 O-16을 확정하라"는 프레이밍은 실무에서 성립하지 않는 전제(단일 안정 배분 수치)에 근거하고 있었다.

## 3. 역할·권한 매트릭스 (RACI) — `docs/governance/raci.md` 참조

게이트별 RACI 표는 별도 문서에 있다. `docs/governance/process-map.md`, `docs/manuals/business-manual.md`, 엔터티 온보딩 워크스루(`docs/planning/transition-plan.md` §4)에서 참조되기 때문이며, 분리해두면 세 곳의 사본이 어긋나는 것을 피할 수 있다.

## 4. 관련 문서

- `docs/governance/governance-operations.md` §6 — 이 문서가 이행하는 상위 수준의 캐던스 포인터.
- `docs/planning/transition-plan.md` §5.5 — O-3/O-16 해결 기록.
- `memory/meeting-2026-08-20-m7-3-deal-execution-model.md` — 수식의 출처와 "1에서 시작" 수정 사항.
