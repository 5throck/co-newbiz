---
lang: ko
lang_reason: source-material
---

# S8 생성기의 대상별 WACC 소비 (ADR-0156 소비층 완결)

- Date: 2026-10-10
- Status: Implemented (사용자 승인, 2026-10-10 대화)
- ADR: `docs/adr/0156-per-target-wacc-financial-company-axis.md` (수정본 2)
- Related: ADR-0143 (S8 대상 축), ADR-0156 (대상별 WACC 저장·조회·UI),
  ADR-0157 (S9 선택적 대상별 실사 — 같은 회사 축), design 2026-09-18-s8-business-case-evaluation

## 문제

ADR-0156이 대상별 WACC 세션의 저장(`run.subject_company_id`)과 조회
(`resolveProjectWacc(db, projectId, { subjectCompanyId })`), WACC/재무분석
페이지 UI까지 출시했지만 S8 생성기는 소비하지 않는다.
`caseInputsBaseForProject`이 프로젝트 스코프 WACC을 한 번 조회하고
`caseInputsForTarget`이 `...base`를 펼쳐 **모든 단기입찰 대상이 같은
프로젝트 수준 할인율로 평가**된다. "밸류에이션 재계산 (재생성)"을 눌러도
대상별로 확정한 WACC이 반영되지 않으며, 대상 비교표와 권고
(`flagRecommendedTarget`)의 왜곡으로 이어진다. ADR-0156 Context가 지적한
"S8 비교가 한 대상의 자본비용으로 돌아가는" 상태가 저장층만 고치고
계산층에선 그대로인 것이다.

## 결정 (스코프 규칙)

생성기는 WACC 페이지가 대상별로 보여주는 스코프와 **동일한 규칙**으로
WACC을 소비한다 (수정본 1의 칩 규칙과 일치):

| 대상 | 스코프 | 근거 |
|---|---|---|
| 그린필드(프로젝트 레벨 케이스) | 프로젝트 | 현행 유지 — 대상 축이 없음 |
| 브라운필드 바운드 대상 (`md_project.company_id`) | 프로젝트 | 게이트 기준 수치. WACC 페이지의 '게이트 기준' 칩 = 프로젝트 스코프와 동일 규칙 |
| 브라운필드 비바운드 대상, 자기 회사 세션 있음 | `{ subjectCompanyId }` | 그 대상의 자본비용으로 자기 케이스를 할인 |
| 브라운필드 비바운드 대상, 세션 없음/회사 미특정 | 프로젝트 (폴백) | 자동 생성이 수동 WACC 확정 여부에 블록되지 않게 한다. 스코프는 근거 라벨로 구분 |

`resolveProjectWacc`의 스코프 조회가 세션을 못 찾으면 `source: "default"`를
반환하는 점을 폴백 판정에 쓴다 (`"default"`면 프로젝트 스코프 해상으로
되돌린다). `wacc_subject`(REQ-W4 적용 주체)는 게이트 소관이므로 프로젝트
수준을 유지한다.

## 근거 계약 (additive)

- `CaseInputs.waccScope?: { scope: "project" } | { scope: "target"; companyId: string }` —
  없으면 프로젝트로 해석(수제 컨텍스트 하위호환).
- 시뮬레이션 note: 기존 `wacc=` / `wacc_source=` / `wacc_run=` 옆에
  `wacc_scope=project|target` 추가. `report-composer`의 key=value
  파서는 추가 키를 그대로 통과시키며, 산출 근거 줄에 스코프를 표시한다.
- job-spec(`inputs_json` 스냅샷)의 `discount_rate`에 `scope` 추가,
  target 스코프일 때 `subject_company_id`도 함께 영속화 — 스냅샷만으로
  어느 회사 세션으로 할인했는지 식별 가능 (REQ-W5-1 재현 계약).
- 시드 정책(`projectId:targetId`)은 변하지 않는다 — WACC은 시드 밖이다.

## 경계 (바꾸지 않는 것)

- FS 게이트, 킬크라이테리아, 스냅샷 채우기, S10/S11의 프로젝트 수준 WACC
  조회는 ADR-0156 결정 2대로 그대로 (대상별 세션이 게이트 수치를 가로채지
  않는다).
- 타겟코스팅 연동(`resolveDownsideOpexUplift`)은 프로젝트 키 스키마라
  프로젝트 수준 유지 (대상 축 컬럼이 없으므로 별도 결정 사항).
- S9(ADR-0157)와의 정합성: S9 실사의 대상 축(`brownfield_target`,
  회사 해석 dart_corp_code 우선·name_ko 폴백)과 동일한 축을 쓴다. S9 완료
  판정과 게이트는 선택 대상 기준 — S8 대 비선정 대상의 대상별 WACC 밸류에이션은
  비교 근거일 뿐 게이트 의미론을 바꾸지 않는다.

## 테스트

`tests/unit/business-case-wacc-scope.test.ts` — 실제 라우트 핸들러 + 스크래치 SQLite:

1. 비바운드 대상의 자기 세션이 밸류에이션·스냅샷에 반영(note `wacc=`,
   `wacc_scope=target`, `discount_rate.scope/subject_company_id`).
2. 세션 없는 대상은 프로젝트 폴백 + `wacc_scope=project`.
3. 바운드 대상은 그 회사에 자체 세션이 있어도 프로젝트(게이트 기준) 스코프.
4. 게이트 격리 — 대상별 세션 존재 하에서도 무스코프 `resolveProjectWacc`는
   프로젝트 수치를 반환.
