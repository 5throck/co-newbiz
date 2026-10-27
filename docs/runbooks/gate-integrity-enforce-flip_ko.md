---
lang: ko
lang_reason: source-material
counterpart: gate-integrity-enforce-flip.md
---

# 런북: 관문 무결성 enforce 전환 (ADR-0186 P5)

대상: 실행하는 시스템 소유자와 운영자, shadow 검토를 운영하는 `compliance-officer`, Docker 스택을 자문하는 `release-engineer`. 관련 문서: `docs/adr/0186-gate-integrity.md`, `docs/designs/2026-10-26-gate-integrity-design.md` 7, 11, 13절, `docs/governance/governance-operations.md` 4.1절의 KPI.

**에이전트는 이 런북에서 운영 환경을 바꾸거나 스택을 재시작하는 어떤 단계도 수행하지 않는다.** `.env.prod` 변경과 포트 7749 컨테이너 재생성은 소유자가 한다. 에이전트는 shadow 보고서를 읽고 근거를 준비할 수만 있다. 전환 결정은 계열별 결정 기록에 남는 사람의 결정이다.

## 1. 계열

각 계열은 `CO_NEWBIZ_GATE_INTEGRITY_<FAMILY>`(값 `off | shadow | enforce`)로 제어한다. 운영 기본값은 `shadow`이며 변경하려면 재시작이 필요하다.

| 계열 | 변수 | 근거와 enforce 시 동작 | 선행 조건(모두 증빙) |
|---|---|---|---|
| rationale | `CO_NEWBIZ_GATE_INTEGRITY_RATIONALE` | 자리표시자나 형식이 부족한 사유를 거부(422 `rationale_insufficient`), D2. 순수한 기록 위생. | 최근 실제 사유로 거부 목록 검토, 설명되지 않은 `would_block:rationale_insufficient` 0건, UI가 422 메시지를 분명히 표시. |
| waiver | `CO_NEWBIZ_GATE_INTEGRITY_WAIVER` | 별도 승인 행위, 승인자는 요청자와 다르고 해당 역할 보유, 90일 상한, `not_waivable`, `na` 2인 확인(D5). | 확인되지 않은 옛 필수 `na` 26행(PRJ-DSE4PW 17행, 삭제 처리된 프로젝트 9행)을 사람이 검토해 각각 확인, 재개 또는 옛 기록으로 수용 처리. 90일 초과이거나 `approved_at`이 없는 유효 면제 없음. 승인 역할이 평소 요청자 외 1명 이상에게 부여됨. |
| ladder | `CO_NEWBIZ_GATE_INTEGRITY_LADDER` | 관문 N의 GO는 트랙 사다리의 N-1 GO를 요구(D7). | 진행 중인 모든 프로젝트와 기회에서 선행 관문 누락 점검. 알려진 공백(경과 규정 적용 1건)은 문서화. 설명되지 않은 `would_block:gate_sequence` 0건. |
| validators | `CO_NEWBIZ_GATE_INTEGRITY_VALIDATORS` | 해당 핵심 검증기가 없으면 브라운필드 `dd`, `entity_ic`, `group_ic` GO 차단(409 `validators_incomplete`), `pre_fs`의 bf-03 인증 차단(D1, D4, O-3). | DD 이후 모든 브라운필드 프로젝트에 핵심 검증기 6종 기록(또는 해당 없음 판정 문서) 존재. Pre-FS 브라운필드의 bf-03 상태 점검. 설명되지 않은 차단 예정 0건. |
| wacc | `CO_NEWBIZ_GATE_INTEGRITY_WACC` | WACC 주체가 설정되고 `wacc`/`hurdle_irr`가 `kind=user`가 아니면 `fs` GO 차단. `assumed`로 되돌리면 이후 관문 차단(D8). | S8 진행 중 프로젝트마다 WACC 확정, 또는 소유자가 사유를 달아 잠정 상태 수용을 기록. KPI G11이 0이거나 전부 설명됨. PRJ-DSE4PW는 별도 절차(`docs/runbooks/prj-dse4pw-reconfirmation_ko.md`)로 처리. |
| snapshot_ack | `CO_NEWBIZ_GATE_INTEGRITY_SNAPSHOT_ACK` | GO는 `snapshot_hash`와 항목별 확인이 필요. 오래된 해시는 409(D1, 3.10). | 사람이 처음부터 끝까지 확인 흐름 수행(제안, 확인, 오래된 해시 재시도). KPI G4가 확인 거부를 수용 가능한 수준으로 보임. 미평가 비중(G5) 파악. |
| kill_binding | `CO_NEWBIZ_GATE_INTEGRITY_KILL_BINDING` | 발동된 `halt` 기준은 `group-ic-reviewer`의 예외가 없으면 GO를 차단(409 `kill_binding_unoverridden`). | `group-ic-reviewer` 권한 보유자가 있고 비운영 시나리오에서 시험 예외를 발급함. 모든 `halt` 기준의 근거 변수에 TRUE와 UNASSESSED 시험 존재. G5에서 모든 곳에서 미평가인 halt 계열 기준 없음. `snapshot_ack`와 함께 전환. |
| divergence | `CO_NEWBIZ_GATE_INTEGRITY_DIVERGENCE` | 저장된 AI 권고와 다른 결정은 실질적인 `divergence_reason` 필요(422 `divergence_reason_required`), D9. | KPI G3 부족분 설명. MCP 포함 모든 관문 경로에서 브리프 저장(`brief_id`) 확인. |
| maker_checker | `CO_NEWBIZ_GATE_INTEGRITY_MAKER_CHECKER` | IC GO는 해당 역할의 다른 사람이 연서하기 전까지 `pending_countersign`(D6, O-1). | `GET /api/admin/human-roles/readiness`에서 `entity-ic-reviewer`와 `group-ic-reviewer` 각각 서로 다른 보유자 2명 이상. 두 보유자가 예행연습에서 각각 연서 수행. 소유자가 두 번째 사람에게 기대 역할을 안내. 멈춰 선 IC 결정 없음(G7). |

## 2. shadow 보고서 수용 기준

다음이 모두 성립하면 계열을 전환할 수 있다.

1. `shadow`로 연속 14일 이상 운영했고, **그리고** 관련 관문 기록이 10건 이상 관찰됨(또는 고정 시험 자료로 모든 코드 경로를 점검한 문서가 있음). 한산한 시스템이 쓰이지 않아서 통과하는 일을 막기 위함이다.
2. `compliance-officer`가 주간으로 검토한 해당 계열의 `gate_integrity.would_block:<code>` 이벤트가 **14일 동안 설명되지 않은 차단 예정 0건**. 보고서 입력은 `bun scripts/co-newbiz/gate-integrity-shadow-report.ts [--days 14] [--json] [--db-path <path>]`로 만든다(읽기 전용, 계열별 차단 예정 이벤트와 관문 기록 10건 최소 요건을 뒷받침하는 기록량을 보여준다). "설명됨"은 각 이벤트가 고정 시험 자료, 알려진 옛 기록, 이미 고친 결함 중 하나로 귀속되어 그렇게 기록된 것을 뜻한다.
3. 1절의 모든 계열 선행 조건을 기억이 아니라 포인터(질의, 화면 캡처, 준비 상태 출력)로 증빙.
4. 결정 기록에 계열, 근거, 날짜를 적고 소유자가 승인.

process-governance-manager의 이 기준 해석은 소유자에게 올리는 제안이며 결정이 아니다.

## 3. 권장 전환 순서

설계 7절에 따르며 근거는 다음과 같다.

1. **rationale** - 기계적이고 거래 판단이 없어 후회 비용이 가장 낮다.
2. **waiver** - 자기 승인 공백을 닫는다. 먼저 옛 `na` 검토가 필요하다.
3. **ladder** - 이미 있는 정책 조항을 강제한다. 데이터상 이미 지켜지고 있다.
4. **validators** - 정책상 구속력이 있다. 브라운필드 검증기 기록이 완비되어야 한다.
5. **wacc** - 정책상 구속력이 있다. S8 WACC 세션이 열려 있어야 한다.
6. **snapshot_ack와 kill_binding**(함께) - 확인 계약과 halt 구속은 함께일 때만 의미가 있다. 사용자에게 가장 크게 보이는 변화이므로 더 단순한 차단이 안정된 뒤에 한다.
7. **divergence** - 브리프 저장과 사용자의 확인 흐름 이해에 달려 있다.
8. **maker_checker** - 두 번째 사람의 확보(O-1)에 달려 있고 GO가 유효해지는 주체를 바꾸므로 마지막이다.

새 차단을 귀속시킬 수 있도록 한 번에 한 계열씩, 전환 사이에 영업일 3일 이상 둔다.

## 4. Docker 운영 스택(포트 7749) 단계 - 소유자가 실행

에이전트로서 이 중 어떤 것도 실행하지 않는다. 참고: `docs/runbooks/deployment_ko.md`(컨테이너는 루트 `.env`가 아니라 `.env.prod`를 읽으며, 강제 재생성 뒤에만 변경이 적용된다).

1. 수용 근거와 결정 기록이 있는지 확인한다. 변경 시간을 공지한다(7절).
2. `docs/runbooks/backup-restore_ko.md`에 따라 백업하고 시각을 적어 둔다.
3. 호스트 로컬 `.env.prod`(git 제외)에서 정확히 한 계열에 `CO_NEWBIZ_GATE_INTEGRITY_<FAMILY>=enforce`를 설정한다. 나머지는 바꾸지 않는다.
4. 적용: 저장소 디렉터리에서 `docker compose up -d --force-recreate`. 이를 위해 7748의 개발 서버를 멈추거나 건드리지 않는다.
5. 상태 확인: `curl -s http://127.0.0.1:7749/api/health`가 `{"status":"ok"}`를 반환.

## 5. 전환 뒤 검증

- 설정 또는 상태 화면(또는 시작 로그)이 해당 계열을 `enforce`로, 다른 계열은 값이 그대로임을 보고하는지 확인한다.
- 이제 거부되어야 하는 **부정 시험** 1건을 연습용 또는 데모 프로젝트에서 수행하고(예: `rationale`은 자리표시자 사유, `maker_checker`는 자기 연서) 기대한 코드(422/409/403)를 확인한다. 이어서 성공해야 하는 **긍정 시험** 1건을 수행한다.
- 이후 영업일 5일 동안 compliance-officer가 KPI G1, G4, G6, G7을 검토한다. 정당한 행위가 설명 없이 거부되면 롤백 사유다.

## 6. 롤백

`.env.prod`에서 해당 계열을 `shadow`(검사 자체가 오작동하면 `off`)로 되돌리고 `docker compose up -d --force-recreate`를 실행한 뒤 상태를 확인하고 사유를 기록한다. 스키마는 추가형이라 동작 때문에 마이그레이션을 되돌릴 필요가 없다. 기존 행은 전환이나 롤백으로 고쳐 쓰지 않는다. 롤백 뒤 계열은 카운터를 초기화하고 2절 수용 기준으로 돌아간다.

## 7. 사용자 안내

전환 전(영업일 2일 이상 전): 계열, 새로 거부될 대상, 사용자가 보게 될 정확한 오류와 대신 할 일, 재시작 날짜와 시각(앱이 잠시 중단됨), 문의처를 담은 짧은 공지. 전환 후: 확인 공지와, `maker_checker`의 경우 각 역할을 맡은 사람 목록. 시스템이 여전히 결정을 내리지 않는다는 점을 분명히 밝힌다. 시스템은 불완전한 기록을 거부하고 확인을 요구할 뿐이며, 모든 GO는 사람의 결정으로 남는다.

## 8. 데모 데이터

데모 프로젝트는 `bun scripts/co-newbiz/seed-s1-s12-demo.ts --db-path <path>`로 관문 계약(스냅샷, 확인, 연서)을 거쳐 다시 채운다. 개발 DB 전용이며, 백업(`docs/runbooks/backup-restore_ko.md`)과 소유자 승인 없이 운영에는 절대 실행하지 않는다. 5절의 부정 및 긍정 시험에 다시 채운 데모 프로젝트를 쓴다.
