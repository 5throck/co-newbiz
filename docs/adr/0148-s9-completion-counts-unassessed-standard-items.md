---
lang: ko
lang_reason: source-material
---

# ADR-0148 — S9 완료 판정이 평가하지 않은 표준 체크리스트 항목을 세도록 한다

- Status: Accepted
- Date: 2026-10-01 (제안)
- Accepted: 2026-10-01 — 사용자(사람 검토자)가 제안된 권장안(옵션 A, 수락 이후 진입 프로젝트만 적용)으로 진행하라고 지시. 사용자의 응답이 "진행해줘"였으므로, 옵션 선택은 제안문에 적힌 권장안을 따른 것으로 기록한다
- Deciders: 사용자(사람 검토자). New Business Review Lead (PM)가 초안 작성 — ADR은 AI 검토만으로 통과할 수 없다
- Design of record: `process/flow.spec.yaml` (S9 완료 기준), ADR-0099 §5 (완료 요약이 개수의 단일 출처)
- Related: ADR-0037 (필수 항목 누락의 게이트 차단), ADR-0099 (S9 맞춤 체크리스트), ADR-0147 (OP-4로 이 건을 분리해 둠)

## Context

S9의 완료 기준은 흐름 명세에 이렇게 적혀 있다(ADR-0099 인용): "적용 체크리스트의 모든 항목이 판정되고 필수 미충족이 0건이다".

현재 구현은 이 문장을 그대로 따르지 않는다. 확인한 사실:

- 체크리스트 상태 행(`project_checklist_item_state`)은 평가할 때(`dd-checklist-tailor.ts`의 상태 upsert), 사용자 지정 항목을 승인할 때, 데모 시드에서만 만들어진다. 표준 항목은 평가 전까지 행이 없다.
- `ddCompletionSummary`는 **존재하는 행**만 센다. `pending`은 `pending` 상태 행의 수, `mandatoryUnmet`은 waiver 없는 `fail` 행의 수다.
- S9 판정(`process-flow.ts`의 `S9`)은 `total === 0`이거나 `pending > 0` 또는 `mandatoryUnmet > 0`이면 막는다.

따라서 행이 하나라도 있고(`total > 0`) 만들어진 행이 모두 `pass`/`na`/`waived`이면, **한 번도 평가하지 않은 표준 항목(필수 포함)이 남아 있어도 S9가 완료된다.** 필수 항목을 건너뛰어도 게이트가 막지 못한다.

## Decision

**옵션 A 채택** — 완료 요약이 `DD_WORKSPACE_CHECKLISTS`의 표준 항목 중 행이 없는 것을 `pending`으로 센다. 필수 항목이 `pending`이면 기존 규칙대로 막는다. 흐름 명세의 문장과 구현이 일치한다.

- 권고 항목(예: `cdd-08`)도 "판정"되어야 하되, 건너뛴 경우 `na` 상태와 사유 메모로 기록한다(이미 ADR-0147 스킬 문구가 요구하는 방식).
- 적용 시점: `md_project.created_at`이 2026-10-01 이후인 프로젝트부터. 진행 중인(그 이전에 만든) 프로젝트는 소급하지 않는다(ADR-0147 OP-1과 같은 원칙). 기준을 S9 진입 시각이 아니라 프로젝트 생성 시각으로 둔 것은 S9 진입 시각이 저장되어 있지 않기 때문이며, 그 이전에 만들어 이후 S9에 들어가는 프로젝트는 적용 대상에서 빠진다.
- 구현: `ddCompletionSummary`가 별도 필드 `unassessed`(행이 없는 표준 항목 수)를 돌려주고, S9 판정은 `pending`·`unassessed`·`mandatoryUnmet` 중 하나라도 0이 아니면 막는다. `pending`의 뜻은 그대로 두어 파이프라인의 `checklist_approval:S9` 일시정지 사유가 바뀌지 않는다.

**옵션 B (미채택)** — 필수 항목의 행 부재만 `pending`으로 센다. 권고 항목은 판정하지 않아도 된다. 변경이 작지만 흐름 명세 문장("모든 항목")을 고쳐야 한다.

**옵션 C (미채택)** — 현행 유지. 흐름 명세 문장을 "만들어진 판정 행"으로 고쳐 구현에 맞춘다. 필수 항목 건너뛰기를 허용하는 것이므로 권하지 않는다.

## Consequences

- 옵션 A/B는 `ddCompletionSummary`와 그 소비처(S9 판정, IC 패키지, 게이트 브리프, 보고서 작성, 파이프라인의 `checklist_approval:S9` 트리거)의 개수를 바꾼다. 관련 테스트(`pipeline`, `ic-package`, `dd-tailor` 등)가 새 개수에 맞게 수정되어야 한다.
- 소급하지 않으면 진행 중 프로젝트의 완료 판정은 그대로다. 소급하면 이미 완료로 보던 프로젝트가 갑자기 막힐 수 있다.
- 사용자 지정 항목과 상태 행의 의미는 바뀌지 않는다.

## Open Points

해결됨 (2026-10-01): 옵션 A 채택, 적용 시점은 프로젝트 생성 시각 기준. 남은 항목 없음. 구현은 이 ADR과 같은 변경 묶음에 포함되어 있다.
