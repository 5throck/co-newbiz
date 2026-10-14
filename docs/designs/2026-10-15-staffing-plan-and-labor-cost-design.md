---
title: Staffing plan (인력 운영 계획) at S5 and derived labor cost
status: proposed
date: 2026-10-15
owner: platform-lead
lang: ko
lang_reason: source-material
---

# Staffing plan (인력 운영 계획) at S5 and derived labor cost

Korean appears only as UI labels in backticks. All prose is English. Paths are relative to `app/web-next/` unless stated.

- Decider feedback: chat 2026-10-15 — labor cost over the investment/plan period must be reflected in the total investment; a proper labor-cost estimate needs a staffing (인력 운영) plan (headcount by grade/job family, average salary). Today S5 has only free manual lines such as `팀 운영비 90000 월`.
- ADR: [ADR-0175](../adr/0175-staffing-plan-and-labor-cost.md) (Proposed).
- Companion to: [ADR-0174](../adr/0174-total-investment-and-s8-handoff.md) (Accepted 2026-10-15) and its [design](2026-10-15-total-investment-and-s8-handoff-design.md) — designed to build on its horizon, per-line timing and summary panel; slice 1 of this design also stands alone on the current S5 totals if sequencing requires.

## 1. Problem statement

- The total investment defined by ADR-0174 sums the labor category from whatever manual lines exist. Without a staffing plan, the labor number is a guess typed into a free text field (e.g. `팀 운영비 90000 월` — no headcount, no grade, no salary basis, no growth).
- Downstream stages already consume an aggregate hiring plan (S10 execution baseline `hiring_plan` rows `role_family / quarter / headcount`, the S9 `인력/조직 계획` tab, the S12 `headcount_vs_plan` KPI), but nothing upstream produces one. S10 analysts re-derive it by hand.

## 2. Verified current state

- **S5 lines.** `BcLine` (`components/stages/GreenfieldStage.tsx`): `line`, `category` (`labor|opex|capex|revenue|gov_rnd`), `amount`, `note?`, `period` (`monthly|quarterly|yearly|lumpsum`), `currency`, `amountUnit?: "krw_m"`, `dupDismissed?`. Capability entries (`lib/capability-cost-lines.ts`) live in the same array with `source: "capability"`. All amounts are 백만원 (`AMOUNT_UNIT_KRW_M`); legacy 억 lines are converted on load. `investmentTotals` treats each line as `amount × {12,4,1,1}`; ADR-0174 adds per-line `startYear`/`endYear` and one `{source:"plan_meta", horizonYears}` entry in the same array.
- **Storage.** `greenfield_assessment` (`db/migrations/0056_greenfield_assessment.sql`) columns: `id`, `opportunity_id`, `capability_gaps_json`, `entry_strategy`, `alternatives_considered`, `business_case_lines_json`, `rationale`, audit columns. **Every content column is in use; there is no free column for a staffing plan.** A new column would be a schema change and hits the ADR trigger list.
- **S10 execution baseline.** `lib/greenfield-execution.ts`: `HiringRow { role_family: string; quarter: "YYYY-Qn"; headcount: number }`; `parseBaselineEntries` rejects unknown keys on a hiring row with the message naming the aggregate-only rule (`개인 단위 행 금지`); `ENTRY_LIMITS.list = 100`. The S11 confirmation requires a non-empty `hiring_plan` (R3). `lib/execution-baseline-view.ts` renders it as `인력/조직 계획 — 채용 계획` with the note that only role-family × quarter sums are recorded.
- **S9.** The greenfield DD hr tab is labelled `인력/조직 계획` (`lib/greenfield-dd-view.ts`, `tab_labels_note` in `lib/library.generated.ts` records it as the user-fixed final name). `hdd-01` (`chk-hr-dd`, key-people map) of the hr checklist is read by `planReadinessRows` step 6 in `lib/greenfield-subtrack.ts`. In greenfield scope the hr tab is a reference tab (no gate effect unless the project is in workspace scope).
- **Compensation privacy.** `comp_benchmark` stores only job-family/grade aggregates with a minimum cohort of 5 (ADR-0039 aggregate-first principle); the decider confirmed the 5-person cohort (chat 2026-10-15), matching `policies/group/neb-policy` boundary 6, and all texts now align at `k≥5`. Note: the schema CHECK in `db/migrations/0008_accounts_and_pii.sql` still enforces `headcount >= 3`; aligning it to 5 is a schema change (new migration, ADR trigger) and remains open. ADR-0027 sets an upward-bias default for compensation harmonization (Brown Field). MNPI projects require insider registration before any access (`neb-policy` boundary 6). Personal identifiers are never stored; `comp_benchmark` and the S10 hiring plan both reject individual-level rows by construction.
- **Salary reference data in the repo: none found.** The only master data located is `lib/ksic-master.json` (industry classification). There is no wage/salary benchmark table, no market compensation dataset, and no seed data. Any salary figure in the system must therefore come from analyst input or an analyst-cited external source; the AI can never supply one from its own knowledge.
- **S12.** `headcount_vs_plan` is a strategic KPI in `procedures/_shared/portfolio-venture-monitoring/schema.yaml` and the S12 KPI list in `lib/greenfield-execution.ts` (line ~722).
- **Talent skill.** `skills/talent-pipeline-planning` assesses labor-market supply (headcount by skill category, wage benchmarks, ramp-up) for a candidate site — an external supply check that composes with, but does not replace, this internal staffing plan.

## 3. Staffing plan model (deliverable a)

One staffing plan per greenfield assessment, stored inside `business_case_lines_json` as a single meta entry (§6):

```
{
  source: "staffing_plan",
  rows: [{
    roleFamily: string,            // 직무군 (free text, e.g. 생산, 품질, 영업)
    grade: string,                 // 직급 (free text, e.g. 팀장, 과장, 신입)
    headcountByYear: number[],     // index 0 = Y1 ... length = horizon N (명)
    avgAnnualBaseSalaryKrwM: number|null,   // 평균 연간 기본급, 백만원, aggregate average
    salaryIncreaseRatePct: number, // 연평균 인상률 % (default 0)
    onCostRatePct: number|null,    // 가산율 % (복리후생·4대보험·퇴직급여 등) — assumption
    hireStartQuarter: "YYYY-Qn"|null,  // optional; only affects the S10 import ramp
    recruitingOneOffKrwM: number,  // 채용·온보딩 일회 비용, 백만원, spent in startYear
    salarySource: string|null,     // provenance: "analyst", URL, or dataset name
  }],
  startYear: number, endYear: number,   // inside the horizon, default 1..N
  attritionBackfillPct: number,    // optional, default 0 (see OD-6)
  updatedAt, updatedBy
}
```

**Derived outputs (computed, never stored):**

- **Annual labor cost** for row r and year y (1-based): `headcountByYear[y-1] × avgAnnualBaseSalaryKrwM × (1 + salaryIncreaseRatePct/100)^(y-1) × (1 + onCostRatePct/100)`, active only for `startYear ≤ y ≤ endYear`. Rows with no salary or no on-cost rate are excluded from cost with a flag (`급여 미입력`), never costed at zero silently.
- **Recruiting one-off**: `recruitingOneOffKrwM` spent once in `startYear` (in the derived line's schedule, flagged `일시불`).
- **Total labor cost over the horizon** = Σ over rows and active years (+ recruiting one-offs).
- **Headcount by year** = Σ `headcountByYear` across rows; **연평균 인원** = mean of the yearly totals.

**Invariants:**

- `headcountByYear` entries are non-negative integers; the array length is trimmed or zero-padded to the horizon on save.
- Salary values are **aggregate averages per role-family × grade**, never individual figures, never per-person rows, never names — same principle as `comp_benchmark` and the S10 hiring plan. The save validator rejects any row whose text fields contain a person-name-shaped value only insofar as the aggregate rule is structural: the schema simply has no name field.
- On-cost rate (`가산율`) has **no statutory default from memory**. The field ships empty with helper text `HR·법무 확인 필요 (복리후생·4대보험·퇴직급여 등 가산율 — 가정값으로만 사용)`; the plan total is computed without it until a person enters a rate, and any entered rate is stored as an editable assumption carrying `salarySource`-style provenance. The system asserts no rate as fact.
- The staffing horizon is the same `검토 기간` as ADR-0174's `plan_meta` (§5 of that design). If ADR-0174 is not yet shipped, the horizon defaults to 5 the same way S8's `bc.horizon_years` does.

## 4. How the plan feeds the investment lines (deliverable b)

- **Derived labor lines.** One read-only derived line per role-family × grade row with `source: "staffing"`, `category: "labor"`, `period: "yearly"`, `currency: "KRW"`, `amountUnit: "krw_m"`, rendered in the unified investment list under 인건비 with a `⛓ 인력 계획 연동` chip (mirroring the capability chip) and a link `계획 보기` to the staffing section.
- **Amounts.** The line's displayed annual amount is the row's Y1 labor cost (or the row's `startYear` cost if `startYear > 1`); the full Y1..YN vector lives in the plan entry, and the `투자비 요약` panel (ADR-0174 §4) reads the **per-year staffing vector** for the labor category so salary growth and headcount ramp are not flattened into one run-rate. If ADR-0174 is absent, the current `investmentTotals` still works: the yearly line shows the Y1 amount with a note `연도별 인원 변동은 인력 운영 계획 참조`.
- **Per-line timing.** `startYear`/`endYear` on the derived line follow the plan's `startYear`/`endYear` (ADR-0174 §5 field set), not editable on the line — edited in the plan only, so the line and the plan cannot disagree.
- **Duplicate guard.** A warning-only, dismissible check (same mechanism as `findDuplicateWarnings` for capability lines): a manual `labor` line whose text token-overlaps a staffing role family (e.g. `팀 운영비` vs 직무군 `팀 운영`) warns `인력 운영 계획에 해당 직무군이 있습니다 — 이중 계상 확인`, dismissible per manual line via `dupDismissed`.
- **Totals.** Labor subtotal, lump-sum subtotal (recruiting one-offs), and 총 투자비 labor figure all come from the staffing vector when a plan exists; manual labor lines that are not flagged duplicates are added on top.
- **S8 hand-off (ADR-0174 §6).** Promotion copies the staffing-derived labor lines like any other line (`annual_amount_krw_m` = displayed annual amount, `start_year`, `end_year`, `unit = 'KRW_M'`). In S8, labor from the S5 plan stays a **cross-check against `opex_ratio × revenue`** (variance display) unless a person selects `s5_plan_full`, at which point the explicit labor replaces the opex ratio for covered years — exactly ADR-0174's mechanism; this design adds no new basis switch. The per-year staffing vector itself can additionally be copied as plan provenance in the model meta (recommend; see OD-4).

## 5. Downstream reuse (deliverable c)

- **S10 hiring baseline.** On the S11 execution-baseline hiring section, an import action `S5 인력 운영 계획에서 가져오기` proposes `HiringRow` entries: for each staffing row, headcount distributed across quarters — uniformly across `hireStartQuarter` (or Y1 Q1) to the horizon end when only yearly headcount is given, or exactly as entered when quarterly ramp data exists later. A person reviews and saves; the import is a proposal that fills the same `hiring_plan` list, and the existing aggregate-only validation (`parseBaselineEntries`, extra keys rejected) is unchanged. Salary fields are **never** imported to S10 — salary stays at S5.
- **S9 `인력/조직 계획` tab and hdd-01.** The DD hr tab's key-people map (hdd-01) and the plan-readiness view can cite the staffing plan's role families as the reference org structure (read-only reference block; hdd-01 judgement remains a human checklist act). For greenfield scope the tab stays a reference tab per `dd-checklist-tailor`.
- **S12.** `headcount_vs_plan` compares actual headcount against the S11 baseline it already reads; importing S10 from S5 closes the chain S5 → S10 → S12 without a new KPI or store.

## 6. Storage (deliverable g)

- **Recommendation: no schema change.** Store the whole plan as one entry `{ source: "staffing_plan", ... }` in the existing `greenfield_assessment.business_case_lines_json` array, exactly the pattern ADR-0174 chose for `plan_meta`. Consumers that must not render it as a line: `normalizeBusinessCaseLines` (validate and keep exactly one; strip unknown keys on manual lines as today), `splitForPromotion` (exclude, return the plan for promotion provenance), `investmentTotals`, the S5 page loader, `unifiedInvestmentRows`. The promotion filter must drop it explicitly (it already drops entries without a valid line shape).
- Alternative rejected: a new `staffing_plan_json` column on `greenfield_assessment` — cleaner typing but a DB schema change, which is the project's ADR trigger, for data that fits the existing JSON array's established meta-entry pattern.
- `business_case_lines_json` is TEXT; the plan adds one object of bounded size (row count capped at `ENTRY_LIMITS.list` = 100 like the S10 lists; see tests).
- Legacy data: no plan entry → behaviour identical to today; no backfill.

## 7. Privacy, permissions and audit (deliverable d)

- **Aggregate-only by construction**: the schema has no name, no individual salary, no person field. This is the same structural guarantee as `comp_benchmark` (ADR-0039) and the S10 hiring plan. MNPI boundary: a project under insider registration follows the existing access rules; nothing here widens them.
- **Role gating**: editing the plan uses `canWriteBusiness` like all S5 writes. **Restricted visibility flag (recommend, minimal)**: salary and on-cost columns render only for users who pass `canWriteBusiness` (analyst+); read-only roles see headcount and the computed cost totals but the salary column shows `비공개 (가정)`. A full per-field ACL would need a permission-model change — out of scope (OD-5).
- **Audit**: reuse the existing S5 save audit (the plan saves with the assessment POST) plus dedicated audit events `staffing_plan.updated`, `staffing_plan.imported_to_s10`, each recording actor and a hash of the plan body, so post-hoc change detection matches the re-import provenance pattern of ADR-0174 §6.3.
- **Human-only**: creating/editing/confirming the plan is a person's act; the AI may only propose drafts (§8). No gate or grade is affected — outputs remain decision support.

## 8. AI assist (deliverable e)

Proposal-only, fill-empty-only, unsaved drafts with an AI chip — the same pattern as `draft_capability_judgement` (ADR-0171 amendment) and `draft_entry_strategy`:

- **Draft source**: S3 capability rows resolved by `hire`/`build` (a hire implies role families; build may too), the S5 entry strategy modes and rationale, and headcount hints appearing in judgement notes (e.g. `현장 인력 20명 규모` parsed as a hint with the note cited as basis). A person fills the rest.
- **Salary references: repo data or analyst-provided sources only.** The repo contains no salary/wage master data (§2), so the AI must never fabricate a salary number: salary fields stay empty unless the analyst attaches a source (URL, dataset, company HR input) in `salarySource`, or the analyst types the value themselves. The AI may propose structure (role families, grades, headcount order-of-magnitude as a stated assumption from note hints), rate fields as clearly-marked assumptions pending HR/counsel confirmation, and recruiting cost placeholders — never a sourced-looking salary.
- Headcount from notes is proposed only when a number is actually present in stored text; otherwise the field stays empty. Every proposed value carries a basis string naming its origin.
- The draft never saves itself; the save is the person's POST, and confirmation of assumptions (on-cost rate, salary provenance) is human.

## 9. UI sketch — words only (deliverable f)

Inside section 3️⃣ `투자비 검토 요건`, a collapsible subsection `인력 운영 계획` placed **above** the investment list (Onyx 3.0 tokens, existing table/stat components, `sizing-new-input-sm` density):

1. Header row: section title, collapse toggle, count chip `N개 직무·직급`, and (when a draft exists) `인력 운영 계획 제안 (AI)` chip.
2. Compact grid, one row per 직무군×직급:
   - `직무군·직급` (two inputs, flex), `인원` per year — Y1..YN narrow number inputs with the year as the column header, `평균 연봉 (백만원)`, `연 인상률 (%)`, `가산율 (%)` with the HR-confirmation helper text, `채용 시작 분기 (선택, YYYY-Qn)`, `채용 일회비 (백만원)`, `출처 (선택)`, delete button. For horizons over 4 years the year columns collapse into `Y1..YN` behind a per-row expandable to keep the grid compact.
   - Salary and 가산율 columns masked for read-only roles per §7.
3. Result strip (read-only stat tiles, unit label on each): `연도별 인건비 (백만원/년)` as a Y1..YN mini-schedule, `총 인건비 (검토 기간 N년, 백만원)`, `연평균 인원 (명)`, `채용 일회비 합계 (백만원)`. Caption `단위: 백만원(KRW)` matching `invest-unit-note`.
4. Sanity warnings (inline, non-blocking): rows costing with `가산율` empty (`가산율 미입력 — 급여만 계상됨`); rows with headcount but no salary (`급여 미입력 — 인건비 미계상`); headcount dropping to 0 mid-horizon then rising (`감원 후 재증가 — 의도 확인`); any manual labor line triggering the duplicate guard (§4).
5. AI draft banner (when present): per-row origin note (`S3 hire 역량 'XX' · 비고 인용`) and `초안 폐기` / apply-per-row; nothing saved until the person saves the form.

## 10. Compatibility, tests, risks

**Compatibility.** No plan entry → unchanged behaviour everywhere. ADR-0174 interplay: if both ship, `plan_meta` and `staffing_plan` coexist as distinct `source` values with separate consumers; if 0174 ships later, staffing's horizon default (5) matches and the summary upgrade is additive.

**Tests.**

- Unit: cost formula (growth, on-cost, start/end window, salary-less rows excluded and flagged); headcount pad/trim to horizon; plan entry validation (row cap 100, integer headcount, negative rejection); exactly-one plan entry; no consumer renders the meta entry as a line; totals read the staffing vector for labor.
- Duplicate guard: overlap detection and dismissal round-trip on `dupDismissed`.
- Promotion: staffing lines copied with timing and unit; plan excluded from lines but returned as provenance (with ADR-0174).
- S10 import: quarter distribution from yearly headcount and from `hireStartQuarter`; salary never appears; `parseBaselineEntries` still rejects extra keys.
- AI draft: fill-empty-only (no overwrite of entered values); no salary proposed without `salarySource`; audit events recorded.

**Risks.**

- Salary guesses entering the investment total — mitigated by empty-until-sourced salary, flagged rows excluded from cost, provenance column, and the AI never proposing salaries.
- On-cost rate asserted as statutory fact — mitigated by no default, helper text marking it an assumption for HR/counsel.
- Double counting with manual labor lines — dismissible warning, consistent with ADR-0173's approach.
- `business_case_lines_json` growing — capped rows; plan is one bounded object.
- S5→S8→S10 drift after re-import — same answer as ADR-0174: explicit re-import with diff, human-selected.

## 11. Slices

1. **Staffing model + S5 grid + derived labor lines** (plan entry, validation, computed outputs, collapsible grid, result strip, warnings, duplicate guard, totals integration, audit). No S8 change; works with or without ADR-0174.
2. **S8 hand-off with ADR-0174** (promotion copy with timing/unit, staffing vector into the `투자비 요약` per-year schedule, `s5_plan_full` labor treatment per ADR-0174 §6.2, provenance).
3. **S10/S9/S12 reuse** (S10 import action into `hiring_plan`, S9 hr-tab reference block, S12 chain verification through the existing baseline).
4. **AI proposal** (`인력 운영 계획 제안 (AI)` route + draft UI, fill-empty-only, no-salary-without-source).

## 12. Open decisions (recommendations)

- **OD-1 Headcount granularity at S5**: recommend by-year (`headcountByYear`) with optional `hireStartQuarter`; quarterly ramp entered at S10 import. Alternative: quarter-by-quarter at S5 (heavier grid, duplicates S10's job).
- **OD-2 On-cost default**: recommend no numeric default at all (empty, flagged, excluded from cost until entered). A remembered statutory rate must not be hard-coded; HR/counsel confirm any rate. Alternative: an editable region-profile default — rejected until a sourced dataset exists.
- **OD-3 Storage**: recommend the `staffing_plan` meta entry in `business_case_lines_json` (no schema change). A dedicated column is the fallback if the entry proves to strain validation, and would then require its own ADR.
- **OD-4 Promotion provenance**: recommend the staffing vector is copied into the S8 model meta (not as lines) so S8 variance display can show the plan, alongside ADR-0174's line copies.
- **OD-5 Salary visibility**: recommend the minimal `canWriteBusiness`-gated masking of salary/가산율 columns now; a per-field ACL is out of scope. Alternative: show all to all authenticated users (rejected — compensation assumptions are the sensitive class here).
- **OD-6 Attrition/backfill**: recommend `attritionBackfillPct` accepted but defaulting 0 and excluded from slice 1's UI (stored, computed when non-zero, documented); full attrition modelling later.
- **OD-7 Duplicate-guard severity**: recommend warning-only, dismissible (ADR-0173 consistency). Alternative: block — rejected, manual labor lines are legitimate when the plan intentionally excludes a population.

## 13. Not verified

- The exact minimum cohort for `comp_benchmark` aggregates: RESOLVED (decider, chat 2026-10-15) — the minimum cohort is 5, per `policies/group/neb-policy` boundary 6. The compensation-harmonization skill now states `k≥5`. The enforcing check was located after this section was written: `CHECK (headcount >= 3)` in `db/migrations/0008_accounts_and_pii.sql` (rebuilt in `0033_pk_not_null_rebuild.sql`); a new migration is required to raise it to 5, which is a schema change hitting the ADR trigger list.
- Nothing in this design is exercised in a browser or against the live database; all storage claims come from the migration file and current lib code.
- Whether `business_case_lines_json` consumers outside S5/S8 (MCP greenfield handlers) would surface the plan entry was not exhaustively traced.
- No salary/wage reference dataset exists in the repo as far as this search reached (source files, `data/`, master data, `workspace/`); a dataset elsewhere in the organisation was not verifiable from here.
- The S10 quarter-distribution rule for the import (§5) is proposed, not derived from an existing convention; no prior import path exists.
