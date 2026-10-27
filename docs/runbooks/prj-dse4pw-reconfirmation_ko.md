---
lang: ko
lang_reason: source-material
counterpart: prj-dse4pw-reconfirmation.md
---

# 절차: 새로 쓰기 전 PRJ-DSE4PW 재확인 (ADR-0186 소유자 결정 O-6)

담당: `process-governance-manager`(절차), `quant-methodologist`(WACC 세션 지원). 모든 결정 단계는 사람이 한다. 범위: 프로젝트 PRJ-DSE4PW(그린필드). 기록된 이력(`fs`, `dd`, `entity_ic`, `group_ic`를 한 명이 GO 처리, 필수 `na` 17행, WACC 가정 없음)은 **옛 기록으로 남기며 고쳐 쓰지 않는다**. 이 절차는 *새로 쓰는* 경우만 다룬다.

## 새로 쓰기에 해당하는 경우

다음 중 하나: 프로젝트의 새 관문 결정(재결정 포함), 새 관문 브리프 생성, 사례 제안 또는 채택, 현행으로 제시되는 새 IC 패키지 생성, 프로젝트를 S11 설립 단계로 이동.

## 단계 (모두 사람이 한다. 에이전트는 근거 준비만 가능)

1. **WACC 세션.** 분석가 이상 역할의 사람이 WACC 입력 세션(스킬 `wacc-input-session`, quant-methodologist가 입력 준비)을 연다. 결과: `md_project.wacc_subject`에 사유와 결정자가 기록되고, `wacc`와 `hurdle_irr` 가정이 `kind=user`로 저장된다(시스템의 `fin.wacc_source_status`가 `sourced`). 에이전트가 가정한 값은 인정하지 않는다.
2. **옛 `na` 17행 검토.** 처음 입력한 사람이 아닌 사람이 각 행을 확인(실질 사유 포함), 대기 상태로 되돌림, 또는 사유를 적어 옛 기록으로 수용 중 하나로 처리한다. 2인 확인 필드(`na_confirmed_by`, `na_confirmed_at`)가 근거다.
3. **IC 연서.** `entity-ic-reviewer`(그룹 수준은 `group-ic-reviewer`) 권한을 가진 사람 중 원래 IC 결정을 기록한 사람이 **아닌** 사람이 승인 체인으로 연서한다. O-1 권한 부여(권한 보유자 2명 이상)가 필요하다.
4. **요건 해제.** 1~3단계 근거가 갖춰지면 자격 있는 사람이 사유를 적어 표지를 해제하며, 해제는 감사 기록(누가, 언제, 왜)에 남는다. 자격은 아래에 정의한다.

## 요건 열기 (소유자 또는 dba)

먼저 백업한다(ADR-0014, `docs/runbooks/backup-restore_ko.md` 참고). 이어서 모의 실행으로 출력을 검토한 뒤 적용한다.

```
bun scripts/co-newbiz/reconfirm-requirement.ts --project PRJ-DSE4PW --by <admin-user>
bun scripts/co-newbiz/reconfirm-requirement.ts --project PRJ-DSE4PW --by <admin-user> --apply
```

선택 옵션: `--items`, `--reason`, `--db-path`. API로는 `POST /api/projects/PRJ-DSE4PW/reconfirm`(관리자)과 같다. 프로젝트당 열린 요건은 하나뿐이다(두 번째 시도는 409 `reconfirm_exists`). 에이전트는 근거를 준비할 수 있으나 운영 환경에서 `--apply`를 실행하지 않는다.

## 시스템이 표시, 차단, 해제하는 방식 (구현된 동작)

- 세 항목 중 하나라도 미충족이면 프로젝트에 **재확인 필요 표지**가 붙는다. `wacc_confirmed`(WACC 주체 미설정 또는 `kind=user` 아님), `na_review`(확인되지 않은 옛 `na` 행), `ic_countersign`(IC 결정에 유효한 연서 없음).
- "옛 기록: 새로 쓰기 전 재확인 필요"라는 안내가 미충족 항목과 함께 보인다. 항목은 데이터가 충족되면 자동으로 해소되지만, 표지 자체는 저절로 해제되지 않는다.
- **해제**는 아래 조건을 모두 시스템이 강제하는 사람의 행위다.
  - 해제하는 사람이 유효한 `entity-ic-reviewer` 또는 `group-ic-reviewer` 권한을 가진다(아니면 403 `human_role_required`).
  - 쿠키 세션을 쓴다(토큰이나 에이전트 서비스 경로 불가).
  - 사유가 확인 응답 근거 기준을 충족한다(아니면 422 `rationale_insufficient`).
  - 모든 항목이 충족되어 있다(아니면 409 `reconfirm_items_unmet`).
  - 해제하는 사람이 프로젝트의 IC 결정(`entity_ic` 또는 `group_ic`)을 기록한 사람이 아니다(아니면 403 `reconfirm_clearer_is_maker`).

## 결정: 경고 대 차단 (구현됨)

- **차단**(409 `reconfirmation_required`, 미충족 항목 명시): 해당 프로젝트의 **새 GO 결정**과 **사업 사례 채택**. 이유: ADR-0186 O-6은 새로운 용도로 쓰기 전에 확인을 요구하며, 이 행위들은 새 구속 기록을 만들거나 거래 방향을 확정한다.
  - **HOLD와 KILL은 차단하지 않는다**(ADR-0186 원칙 5). 거래를 멈추거나 보류하는 길은 항상 열려 있어야 한다.
  - **예외:** `ic_countersign`이 **유일한** 미충족 항목이면 Entity IC 또는 Group IC GO를 허용한다. 옛 GO는 연서할 수 없으므로 재결정이 연서 가능한 기록에 이르는 유일한 길이며, 새 GO는 **다른 자격자가 연서하기 전까지 유효하지 않다**.
- **경고**(차단 없이 응답에 `reconfirmation` 안내): 조회, 관문 브리프 생성, IC 패키지 생성 같은 읽기와 준비 행위. 이유: 검토자가 재확인을 수행하려면 이 정보가 필요하다. 생성된 브리프에는 옛 기록 및 잠정 할인율 표시가 붙는다.
- 경계 2는 유지된다. 표지는 아무것도 결정하지 않고 거부하거나 표시만 하며, 해제는 사람만 한다.
- 이 프로젝트 표지는 `gate-integrity-enforce-flip_ko.md`의 계열 플래그와 관계없이 적용된다. 계열 규칙이 아니라 프로젝트 고유의 소유자 결정(ADR-0186 O-6)이기 때문이다.
