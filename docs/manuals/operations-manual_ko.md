---
lang: ko
lang_reason: source-material
counterpart: operations-manual.md
---

# 운영 매뉴얼 — 시스템 운영자

> **언어**: [English](operations-manual.md) · **한국어**

**독자**: dba, sre, release-engineer, infra-automation-engineer(또는 이 역할의 인간 담당자)
**대상 아님**: analyst(`business-manual.md` 참조), 시스템 관리자(`admin-manual.md` 참조)

## 이 매뉴얼이 다루는 것

배치 운영, 백업/복구, 사고 대응, 배포/롤백 — 시스템을 계속 가동 상태로 유지하는 상시 운영 리듬. 이 시스템이 수행하는 비즈니스 프로세스 그 자체와는 구별된다.

## 1. 운영 리듬 (미팅 M7 기준)

| 담당 | 주기 | 업무 |
|---|---|---|
| dba | 매일 | 백업 성공 확인 |
| dba | 매주 | 용량 및 쿼리 성능 검토 |
| dba | 매월 | **복구 훈련** — 한 번도 복원해 본 적 없는 백업은 검증된 백업이 아니다. 첫 훈련: 가동 1개월 후. |
| sre | 매일 | 수집 실패 분류(triage) |
| sre | 상시 | 알림 파이프라인 — (project, trigger_type) 쌍별 24시간 쿨다운, 히스테리시스는 RAG 7일 홀드와 동일하게 |
| sre | 사고 발생 시 | 사고 대응 + 사후 분석 |
| security-engineer | 매주/분기 | `docs/security/security-baseline.md` 참조 *(Stage 4)* |

## 2. 배포 및 롤백

1. 모든 마이그레이션은 작성 시점에 **reversible 여부가 태깅**된다 — 사후에 추론하지 않는다.
2. 마이그레이션 직전에 백업을 실행한다.
3. 직후에 헬스체크를 실행한다.
4. 롤백은 릴리스 주기당 최소 1회, reversible 태그 마이그레이션으로 리허설한다.
5. **되돌릴 수 없는(irreversible) 마이그레이션은 출시 전에 release-engineer + dba 공동 서명이 필요** — 기본 리뷰보다 높은 기준이며 의도된 것이다.

## 3. 배치 운영

예약 수집 파이프라인(`newbiz.ts watch:run`, `scripts/co-newbiz/newbiz.ts`)은 OS 레벨(Task Scheduler / systemd timer)에서 실행된다. **인프로세스 타이머가 아니다** — 인프로세스 타이머는 앱과 함께 죽고 그러면 예약 모니터링의 목적 자체가 사라진다.

파이프라인: 수집(cache-first) → 영향 탐지 → 자동 재실행 → RAG 재평가 → 알림. `job_run`이 이 파이프라인의 운영 감사 기록이다 — 예약 실행이 발화하지 않은 것처럼 보이면 가장 먼저 확인할 것.

## 4. 접근 제어 (운영자 대상)

인간 운영자가 실행하는 CLI도 여전히 실제 `project_member` 컨텍스트로 해석된다(운영자 계정 또는 감사되는 `--as-user` 플래그) — **need-to-know에 면제되는 신뢰된 운영자는 존재하지 않는다**(미팅 M7-1 D-M7-1... / M7 D-M7-1). 로컬 CLI 접근을 우회로 취급하지 말 것.

## 5. 사고 대응

1. sre가 분류하고 심각도를 매긴다.
2. 사고가 MNPI 플래그가 붙은 프로젝트에 닿아 있으면, `data_access_log`와 `insider_list` 기록은 부수 정보가 아니라 사고 기록의 일부다.
3. 사후 분석은 모든 프로덕션 사고에 필수이며 운영 전용 포스트모템과 함께 거버넌스 KPI 세트(해당하는 경우 재작업률)에 투입된다.

## 6. 관련 문서

- `docs/governance/governance-operations.md` — 이 문서의 *시스템* 운영과 구별되는 *비즈니스* 거버넌스 운영(컴플라이언스, waiver).
- `docs/security/security-baseline.md` *(Stage 4)*.

## 7. 관련 화면

- `/flows` — 스테이지 플로우 시각화 및 드라이런 레인 (ADR-0183).
- UI 언어 전환 — 쿠키 기반 로케일 협상으로 ko/en 메시지 카탈로그 지원 (ADR-0184).
- `/wiki` — 사용자 안내서 위키의 인앱 뷰어.
