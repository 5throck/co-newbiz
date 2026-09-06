---
governance_doc_id: tpl-gate-pass-record
layer: template
title: "게이트 통과 기록 템플릿"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: gate_pass_record
lang: ko
lang_reason: source-material
counterpart: gate-pass-record-template.md
---

<!--
  output_type: gate_pass_record (procedures/_output-types.yaml) — "Stage-gate
  pass/fail record incl. the applicable Kill Criteria results". Produced at
  every gate transition under the stage-gate-governance skill (13 procedures
  reference it). TEMPLATE stays English (CLAUDE.md §4); deliverables
  produced from it are Korean per the language policy. [Bracketed] fields
  populate from the run record — never hand-type a result that isn't backed
  by a kill_criteria_evaluation row, a compliance_check row, or a recorded
  waiver. Evidence discipline (GAO-20-48G): credibility, objectivity,
  reliability, usefulness — every field below exists to make one of the
  four visible at the gate.
-->

# [프로젝트명] — 게이트 통과 기록

**Run ID**: [run_id] · **절차**: [procedure_key] v[procedure.version] · **게이트**: [gate] · **기준 시점**: [as_of] · **정책 버전**: [project_policy_pin]

## 1. 게이트 결정

**결정**: [ ] Go · [ ] Kill · [ ] Hold · [ ] Recycle  *(폐쇄형 어휘 — Hold/Recycle은 증거가 미성숙한 기술 베팅에서 예상되는 결과이지 예외가 아님)*

**근거**: [결정을 재진술하지 말고 결정적 증거를 인용한 2-3문장]

## 2. Kill Criteria 결과 (3개 숫자 기록)

**선언 [N_declared] / 적용 [N_applicable] / 완료 [N_completed]** — `getRecordedEvaluation`(ADR-0058) 기준; `never_evaluated` 범위는 통과(clerance)가 아니며 반드시 아래에 표기해야 함.

| 기준 | 적용 여부 | 결과 | 증거 (ADR-0058 ref) |
|---|---|---|---|
| [criterion_key] | applicable / not_applicable (사유) | pass / fail / never_evaluated | [doc:/src:/https: ref] |

**미평가 기준의 해결**: 각 `never_evaluated` 행에는 이를 해결한 명시적 인간 결정을 수반함(침묵은 결코 해결이 아님).

## 3. 재정(Override) 기록 (Kill Criteria 판정이 재정된 경우에만)

| 기준 | 판정을 유발한 조사 결과 | 재정 결정 | 그룹 IC 기록 |
|---|---|---|---|
| [criterion_key] | [finding + evidence ref] | [명시적 결정 문구] | [record ref — 무대응에 의한 기본/묵시적 재정은 무효] |

## 4. 산출물 및 체크리스트 완성도

**필수 체크리스트 항목**: [M_completed] / [M_required] 완료 · **활성 면제(waiver)**: [waiver refs 또는 "none"]
*(compliance-monitoring의 게이트 점검 결과; 항목은 완료 또는 면제로 충족되며, 누락으로 충족되는 경우는 없음)*

## 5. 증거 품질 (GAO-20-48G)

- **신뢰성(Credibility)**: [출처가 명명되어 있고 해당 주장에 대해 적격한가?]
- **객관성(Objectivity)**: [해당 시 검토자가 작성자와 독립적 — 기술 증거에 대해 non-champion 검토자]
- **안정성(Reliability)**: [검증 가능한 참조; 런 기록 하에서 재현되었거나 재현 가능]
- **유용성(Usefulness)**: [이 기록이 검토자가 실제로 던질 게이트 질문에 답하는가?]

## 6. 서명

| 역할 | 이름/키 | 결정 입력 확인 |
|---|---|---|
| [기록자 — agent key] | [key] | [점검 범위] |
| [인간 권한자 — 이 게이트가 인간 권한인 경우 registry key] | [key] | [서명 면: verified / could not verify / needs judgment] |
