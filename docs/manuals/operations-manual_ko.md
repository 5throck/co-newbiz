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

예약 작업은 OS 레벨에서 실행한다. **인프로세스 타이머가 아니다** — 인프로세스 타이머는 앱과 함께 죽고 그러면 예약 모니터링의 목적 자체가 사라진다. 환경마다 OS 등록 하나(macOS는 launchd LaunchAgent. systemd와 Task Scheduler 방식은 문서로만 있고 자동 설치되지 않는다)가 스케줄러 tick을 1분마다 깨운다(ADR-0189). tick은 `schedule_job` 행(켜짐 여부와 cron. `/admin/schedule`에서 고친다)을 읽어 때가 된 작업을 시작한다. 설치와 확인은 `docs/runbooks/scheduler_ko.md`에, 작업 목록은 [관리자 매뉴얼](admin-manual_ko.md) 6.3절에 있다.

파이프라인: `collect.*` 작업이 외부 자료를 수집(cache-first)하고, `watch.evaluate` 작업이 영향 탐지 → 자동 재실행 → RAG 재평가 → 알림을 하며, `notify.deliver`와 `notify.digest`가 알림을 보낸다. `job_run`이 이 파이프라인의 운영 감사 기록이다 — 예약 실행이 발화하지 않은 것처럼 보이면 가장 먼저 확인할 것.

수동 대안: `bun scripts/co-newbiz/newbiz.ts watch:run`은 tick 밖에서 감시 주기를 한 번 손으로 돌린다. 한 번 확인할 때 쓰고 스케줄 대신으로는 쓰지 않는다.

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

### 3.3 몬테카를로 엔진 GPU 가속 (`CO_NEWBIZ_SIM_GPU`)

S8 몬테카를로 엔진(`python/sim_engine`)은 언제나 CPU(numpy)로 돌아갑니다. GPU는 선택 사항이며 큰 시뮬레이션에서만 이득이 있습니다. `반복 횟수 x 케이스 수`가 **200,000**(`GPU_WORK_THRESHOLD`) 이상일 때만 엔진이 GPU를 쓰고, 그보다 작으면 GPU가 있어도 데이터 옮기는 비용 때문에 CPU가 더 빠릅니다. 그래서 `bc.iterations`를 기본값보다 훨씬 크게 올릴 때에만 GPU가 도움이 됩니다.

**설치는 자동입니다.** `bun run setup:python`(`scripts/co-newbiz/setup-python-env.ts`)이 저장소 맨 위 `.venv`를 만들거나 갱신하고, `python/requirements.txt`를 설치한 뒤, 가속기를 알아내어 맞는 `python/requirements-gpu-<cuda|mps|rocm|xpu>.txt`를 설치합니다. 앱의 `bun run dev`가 시작 전에 이 단계를 먼저 실행합니다(`predev`, 부드러운 모드: 실패해도 개발 서버는 막히지 않으며, 실패한 시도는 6시간 동안 다시 하지 않습니다). 바뀐 것이 없으면 파이썬을 한 번 켜는 비용만 드는 빈 동작입니다(`.venv/.co-newbiz-setup.json`의 도장이 요구 사항 파일, 가속기, 인터프리터의 해시를 담습니다). `sudo`는 쓰지 않으며 모든 것이 `.venv` 안에 머뭅니다.

| 호스트에서 찾은 것 | 가속기 |
|---|---|
| Apple Silicon 맥 | `mps` (float32만) |
| PATH의 `nvidia-smi` (Linux/Windows) | `cuda` |
| 인텔 `xpu-smi` / `sycl-ls` / `ONEAPI_ROOT` (Linux/Windows) | `xpu` |
| PATH의 `rocminfo` / `rocm-smi` (Linux) | `rocm` |
| 위에 하나도 없음 | CPU만 |

우선순위는 엔진 자신의 순서(cuda, mps, xpu, rocm)와 같습니다.

- **강제 또는 끄기**: `bun run setup:python --gpu=cuda|mps|rocm|xpu`는 하나를 강제하고, `--gpu=none`은 CPU 패키지만 설치합니다. `.env`에 `CO_NEWBIZ_SIM_GPU=auto|none|cuda|mps|rocm|xpu`를 두면 선택이 계속 유지됩니다(플래그가 변수보다 먼저입니다). 가속기를 바꾸면 설치된 torch 빌드를 교체합니다. 이 변수는 **설치할** 패키지만 정합니다. 실행할 때 쓸 장치를 CPU로 못 박지는 않습니다. 엔진은 일마다(job-spec의 `device`, 그리고 200,000 이상일 때만 GPU) 스스로 고르므로, `none`이거나 변수가 비어 있어도 이미 GPU용 torch가 깔린 호스트의 GPU 작업을 막지 않습니다.
- **미리 보기 / 확인**: `--dry-run`은 계획만 출력하고 아무것도 바꾸지 않습니다. `--check`도 바꾸지 않으며, 고른 가속기를 `.venv`의 torch가 쓸 수 없으면 종료 코드 1을 돌려줍니다. 끝에는 엔진 자신의 점검 결과(`python -m sim_engine --device-info`)가 나옵니다.
- **잘못된 설정 경고**: `CO_NEWBIZ_SIM_GPU`가 GPU를 요청했는데 torch가 없어 엔진이 CPU라고 알리면, 서버가 `bun run setup:python`을 안내하는 경고를 한 번 남깁니다.
- **Docker**: 운영 이미지는 기본적으로 CPU 전용이며 파이썬이 없습니다. 빌드 인자 `SIM_GPU`(`none` 기본, `cpu`, `cuda`, `rocm`, `xpu`)가 엔진 층을 더합니다: `docker build -f docker/Dockerfile --build-arg SIM_GPU=cuda -t co-newbiz-web:cuda .`. GPU 이미지는 따로 만들어야 하며 실행할 때 GPU를 넘겨 주어야 합니다.

### 3.4 예약 작업: 날마다 하는 점검

스케줄러 tick은 열한 개 작업(자료 수집, 알림, 보존, 감시 평가)을 돌립니다. 작업 목록, 기본 스케줄, 작업마다 필요한 키, 켜는 순서는 [관리자 매뉴얼](admin-manual_ko.md) 6.3절에 있습니다. OS 등록, 심장박동, 실패 점검은 `docs/runbooks/scheduler_ko.md`에 있습니다.

`/admin/schedule`에서 하루에 한 번 다음을 확인합니다(운영 리듬 표의 sre 수집 실패 점검과 같은 범위입니다).

1. **`스케줄러가 발화하지 않습니다` 배너.** 심장박동이 3분보다 오래되었다는 뜻입니다. `docs/runbooks/scheduler_ko.md` 9절을 따릅니다. 운영 환경에서는 tick이 `co-newbiz-web` 컨테이너 안에서 돌기 때문에 컨테이너가 멈추면 여기에 나타납니다.
2. **실패와 시간 초과 실행.** `N회 연속 실패`, `예정보다 지연` 표지를 찾고 그 작업의 `이력`을 엽니다. 연달아 세 번 실패하면 높은 등급 경보입니다.
3. **건너뜀 실행.** `건너뜀`이 늘 고장은 아닙니다. 사유는 화면이 아니라 `job_run.detail_json`에 있습니다.
   - `credential_missing`: 그 작업의 출처 키가 서버에 없습니다. `.env`에 넣고(키 목록은 관리자 매뉴얼 6.1절) 서버를 다시 시작합니다.
   - `kofia_collect_off`: 스위치 `CO_NEWBIZ_KOFIA_COLLECT`가 `on`이 아닙니다. 금투협이 자동 수집을 허용한다고 서면으로 확인해 줄 때까지 `collect.kofia`의 의도된 기본값입니다. 건너뜀을 없애려고 스위치를 켜지 않습니다.
   - 알림 상세의 전달 건(작업 실행이 아닙니다)에 `skipped: channel_unconfigured`가 보이면 그 채널의 SMTP 호스트나 웹훅 주소가 없다는 뜻입니다.
4. **최근의 성공이 아닌 실행**을 한 번에 봅니다.

   ```bash
   sqlite3 db/data/co-newbiz.sqlite "SELECT job_key, started_at, status, substr(COALESCE(error,''),1,120) FROM job_run WHERE env IS NOT NULL AND status <> 'success' ORDER BY started_at DESC LIMIT 20;"
   ```

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
