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

### 3.1 위원회 회의 방식 (`CO_NEWBIZ_COMMITTEE_ENGINE`)

위원회 사전 검토의 진행 방식은 새 회의마다 정해진다(ADR-0204). 2026-11-21 소유자 결정부터 대화형(turn 방식) 회의가 기본이다.

| 설정 | 새 회의에 미치는 효과 |
|---|---|
| 비어 있음(기본) | `turns` - 대화형 회의 |
| `CO_NEWBIZ_COMMITTEE_ENGINE=turns` | 기본과 같다(분명히 적은 것) |
| `CO_NEWBIZ_COMMITTEE_ENGINE=rounds` | 이전 방식으로 되돌림 - 위원이 라운드마다 입장문을 한 편씩 쓰는 방식 |
| 그 밖의 값 | 회의를 열 때 오류로 거부한다. 다른 값으로 바꿔 읽지 않는다 |

- **이전 방식으로 되돌리기**: 서버 환경에 `CO_NEWBIZ_COMMITTEE_ENGINE=rounds`를 넣고(`.env.sample` 참조) 다시 시작한다. CLI는 `scripts/co-newbiz/committee-deliberation.ts`에 `--engine rounds`를 준다. 명시한 플래그가 환경 변수보다 앞선다.
- **이미 연 회의**는 세션 메타에 저장된 방식 그대로다. 변수를 바꿔도 이미 연 회의는 바뀌지 않고, 저장된 행은 고쳐 쓰지 않는다.
- **조용한 대체 없음**: LLM 호출이 실패하면 회의 열기가 멈춘다. `rounds`로 몰래 바꾸지 않는다. LLM 공급자가 설정되지 않으면 `llm_required`로 거부한다.
- **되돌리기(롤백)**: 위처럼 `rounds`로 정한다. 이미 쌓인 turn 행은 이력으로 그대로 읽힌다.

### 3.2 외부 자료 출처 키

앱 수집과 예약 수집 작업은 키(`DART_API_KEY`, `KRX_API_KEY`, `ECOS_API_KEY`, `LAW_API_OC`, `KOSIS_API_KEY`, `DATA_GO_KR_API_KEY`)를 서버가 시작할 때 저장소 맨 위 `.env`에서 읽습니다. 바꾼 뒤에는 서버를 다시 시작합니다. 키가 없으면 앱 수집은 `503 <출처>_api_key_missing`을 돌려 주고 예약 작업은 `credential_missing`으로 건너뜁니다. 키가 있어도 출처가 계정이나 데이터셋을 승인하지 않았으면 실패할 수 있습니다. 출처별 신청 방법, 승인 안내, data.go.kr 데이터셋 등록부는 [관리자 매뉴얼](admin-manual_ko.md) 6절에 있습니다.

## 4. 접근 제어 (운영자 대상)

인간 운영자가 실행하는 CLI도 여전히 실제 `project_member` 컨텍스트로 해석된다(운영자 계정 또는 감사되는 `--as-user` 플래그) — **need-to-know에 면제되는 신뢰된 운영자는 존재하지 않는다**(미팅 M7-1 D-M7-1... / M7 D-M7-1). 로컬 CLI 접근을 우회로 취급하지 말 것.

## 5. 사고 대응

1. sre가 분류하고 심각도를 매긴다.
2. 사고가 MNPI 플래그가 붙은 프로젝트에 닿아 있으면, `data_access_log`와 `insider_list` 기록은 부수 정보가 아니라 사고 기록의 일부다.
3. 사후 분석은 모든 프로덕션 사고에 필수이며 운영 전용 포스트모템과 함께 거버넌스 KPI 세트(해당하는 경우 재작업률)에 투입된다.

## 6. 관련 문서

- `docs/governance/governance-operations.md` — 이 문서의 *시스템* 운영과 구별되는 *비즈니스* 거버넌스 운영(컴플라이언스, waiver).
- `docs/security/security-baseline.md` *(Stage 4)*.
- [`mcp-admin-guide_ko.md`](mcp-admin-guide_ko.md) — MCP 패키지 릴리스와 90일마다 하는 `NPM_TOKEN` 순환.

## 7. 관련 화면

- `/flows` — 스테이지 플로우 시각화 및 드라이런 레인 (ADR-0183).
- UI 언어 전환 — 쿠키 기반 로케일 협상으로 ko/en 메시지 카탈로그 지원 (ADR-0184).
- `/wiki` — 사용자 안내서 위키의 인앱 뷰어.
