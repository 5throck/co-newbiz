---
lang: ko
lang_reason: source-material
counterpart: governance-operations.md
---

# 거버넌스 운영 (Governance Operations)

**Owner**: compliance-officer
**Design of record**: [design v1.0 §6.6](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md)

> 정책을 작성하는 것은 거버넌스의 절반이다. 이 문서는 나머지 절반을 다룬다: 팀이 작성한 규칙을 상시적으로 운영하는 일 — 컴플라이언스 모니터링, 워이버, 해석 레지스트리, 거버넌스 KPI. 이것이 없으면 규제집은 아무도 집행하지 않는 문서에 불과하다.

## 1. 컴플라이언스 모니터링

모든 스테이지 게이트에서 `compliance-officer`는 다음을 점검한다:

- 해당 게이트의 필수 산출물이 모두 존재하는지 (`procedures/*/schema.yaml`의 `steps[].output_type` 기준).
- 모든 필수(mandatory) 체크리스트 항목이 완료되었는지 (체크리스트는 Stage 2.4 — `checklists/` 참조).
- 두 점검 중 하나라도 실패하고 **해당 격차를 커버하는 활성 워이버가 없으면** 게이트는 **차단(blocked)**된다.

이는 재량적 검토가 아니라 시스템이 강제하는 점검이다 — `procedures/_validate.ts`와 향후 `compliance_check` 스키마(design §6.6, Stage 4) 참조.

## 2. 워이버 (Waivers)

워이버는 명시적이고 기록되는 예외 경로다 — 워이버가 없으면 비컴플라이언스가 지하로 숨어들게 된다.

| 규칙 | 상세 |
|---|---|
| **만료 필수** | 모든 워이버에는 만료일이 있다. 무기한 워이버는 사실상의 정책 폐지이며 허용되지 않는다. |
| **승인 권한** | 규제 레이어 워이버 → Group IC. 프로시저 레이어 워이버 → `process-governance-manager`. 체크리스트 항목 워이버 → 해당 도메인 리드. |
| **완전성 검사에는 워이버 없음** | 6밸리데이터 Brown Field 교차검증(design §8.9-1(f))에는 워이버 경로가 없다 — 판단 사안이 아니라 완전성 검사이기 때문이다. |
| **집중 모니터링** | 동일 조항에 워이버가 반복 누적되면, 그것은 반복적인 비컴플라이언스의 증거가 아니라 규제 자체가 현실과 맞지 않는다는 신호다. 이는 처벌 지표가 아니라 개정 우선순위(아래 §4)의 1차 입력이다. |

## 3. 해석 레지스트리 (Interpretation Registry)

질문이 생겼을 때 — "이 조항이 우리 케이스에 적용되는가?" — 그 답은 기록되며, 다음 번에 처음부터 다시 도출되지 않고, 명시적인 대체(supersession) 노트 없이 이후 답변과 모순되지 않는다.

- 요청자: 모든 에이전트 또는 인간 리뷰어.
- 응답자: 해당 거버넌스 문서의 `owner_agent` (예: 정책의 법률 질문은 `legal-counsel`, 프로시저 질문은 `process-governance-manager`).
- 게시된 해석은 질문이 정의된 용어에 관한 경우 용어집의 MCP `lookup_term` 연동을 통해 검색 가능하다.

## 4. 거버넌스 KPI

| 지표 | 드러내는 것 |
|---|---|
| 게이트 사이클 타임(중앙값, 게이트별) | 프로시저가 병목인지 여부 |
| 게이트 반려율 | 업스트림 품질이 낮은지, 또는 기준이 잘못 보정되었는지 |
| 체크리스트 완료율 | 게이트가 실질이 아닌 형식으로 통과되는지 |
| **조항별 워이버 건수와 집중도** | 어떤 규제 조항이 현실과 맞지 않는지 — 개정 우선순위를 결정 |
| 재작업률 | 어떤 스테이지가 가장 자주 작업을 되돌려 보내는지 |
| 해석 질의 건수와 주제 | 어떤 조항이 모호한지 |

**워이버 집중도와 해석 질의 주제가 다음 규제 개정 사이클의 1차 입력이다** — 개정 우선순위는 직관이 아니라 이 데이터에서 도출된다(design §6.6).

## 5. 정책 변경 → 시스템 반영 파이프라인

1. 개정 제안 (ADR 트리거 목록에 따라 ADR 필요 — `docs/adr/README.md` 참조).
2. 영향 분석: 영향받는 `procedure`, `rag_rule`, `assumption`, 체크리스트, 용어집 참조를 식별.
3. `process-governance-manager`가 변경 계획을 작성하고 PM이 승인.
4. 시스템 반영: 프로시저 스키마, `rag_rule`, 체크리스트, 용어집 갱신. 문서 표면에는 별도의 재생성 단계가 필요 없다 — `/library`(ADR-0108)는 이 원본들을 라이브로 읽으므로, 커밋되는 즉시 변경이 반영된다.
5. **소급 여부 결정**: 진행 중인 프로젝트는 변경이 명시적 재평가를 강제할 만큼 중대하지 않는 한 자신의 `project_policy_pin` 버전에 머문다 — 중대한 경우 `policy_change` 결정으로 기록하며, 절대 조용히 적용하지 않는다.
6. 영향받는 프로젝트 오너에게 통지.

## 6. 캐던스

이 운영이 수행하는 일간/주간/월간/분기 리듬은 `docs/governance/ops-cadence.md` *(Stage 2 후속)* 참조. 월간 거버넌스 KPI 리뷰와 분기 워이버/해석 기반 개정 리뷰는 `compliance-officer`가 소유한다.

## 7. 거버넌스 문서 레이어 (리마인더)

| 레이어 | 구속력 | 예시 |
|---|---|---|
| Policy | 필수 | `policies/group/neb-policy.md` |
| Procedure | 필수 | `procedures/_shared/brownfield-screening/` |
| Guideline | 권장 | `guidelines/*` |
| Checklist | 항목별 (`mandatory: true\|false`) | `checklists/*` |
| Template | 권장 | `templates/deliverables/*` |

이 문서가 운영화하는 레이어 표는 design §6.1 참조.
