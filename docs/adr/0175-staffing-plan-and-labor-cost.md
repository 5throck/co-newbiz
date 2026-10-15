---
lang: ko
lang_reason: proper-noun
---

# ADR-0175 - Staffing plan (`인력 운영 계획`) at S5 and derived labor cost

- Status: Accepted (2026-10-15)
- Date: 2026-10-15
- Decider: Human decider (chat 2026-10-15 feedback: labor cost over the investment/plan period must be reflected in the total investment, and a proper labor-cost estimate needs a staffing plan — headcount by grade/job family, average salary; today S5 has only free manual lines such as `팀 운영비 90000 월`). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-15-staffing-plan-and-labor-cost-design.md](../designs/2026-10-15-staffing-plan-and-labor-cost-design.md)
- Related: ADR-0174 (Accepted 2026-10-15: total investment, horizon, per-line timing — this is a companion designed to build on it), ADR-0173 (derived lines, double-count warning pattern), ADR-0039 (aggregate-first compensation principle), ADR-0027 (compensation upward-bias, Brown Field), ADR-0101 (S11/S12)
- Accepted by: the human decider in chat 2026-10-15: "ADR-0175 / ADR-0176 승인" (see Acceptance record).
- Slices: 4 (1 staffing model + S5 grid + derived labor lines, 2 S8 hand-off with ADR-0174, 3 S10/S9/S12 reuse, 4 AI proposal). None implemented by this ADR.

## Context (verified in code)

S5 investment labor lines are free manual entries with no headcount, grade or salary basis. The S10 execution baseline already requires an aggregate-only hiring plan (`HiringRow { role_family, quarter, headcount }`, extra keys rejected with `개인 단위 행 금지`), the S9 hr tab `인력/조직 계획` judges `hdd-01` (핵심 인력 지도), and S12 tracks `headcount_vs_plan` — but nothing upstream produces that plan. No salary or wage reference dataset exists in the repository; every salary figure must be analyst-sourced. `greenfield_assessment` has no free column for a new plan.

## Decision

1. **Staffing plan model.** S5 gains an `인력 운영 계획`: rows by 직무군 × 직급 with headcount per year (`headcountByYear`), 평균 연봉 (백만원, aggregate average — never an individual figure), 연 인상률, 가산율 (복리후생·4대보험·퇴직급여 — editable assumption with helper text for HR/counsel confirmation; the system asserts no statutory rate), optional 채용 시작 분기, recruiting/onboarding one-off cost, optional attrition-backfill rate (default 0), start/end year inside the ADR-0174 horizon. Derived outputs: annual labor cost Y1..YN, total labor cost over the horizon, headcount by year and 연평균 인원. Rows without salary or on-cost are excluded from cost with a flag, never silently costed at zero.
2. **Derived labor lines.** Read-only lines with `source: "staffing"`, category 인건비, in the unified S5 investment list; the `투자비 요약` (ADR-0174) reads the per-year staffing vector for labor so headcount ramp and salary growth are not flattened. Manual-labor-line overlap raises a dismissible duplicate warning (ADR-0173 pattern).
3. **Storage — no schema change.** One `{ source: "staffing_plan", ... }` entry in the existing `greenfield_assessment.business_case_lines_json` array, the same pattern as ADR-0174's `plan_meta`; line consumers must not render it (explicit tests). Row count capped at the S10 list limit (100). A dedicated column is the fallback and would itself be the ADR trigger.
4. **S8 hand-off via ADR-0174.** Promotion copies staffing lines with timing and `unit = 'KRW_M'`; labor stays a cross-check against the opex ratio unless a person selects `s5_plan_full`; the vector also copies into model meta as plan provenance. No new basis switch is introduced.
5. **Downstream reuse.** A human import action proposes S10 `hiring_plan` rows (직무군, 분기, 인원 — aggregate rule unchanged; salary never leaves S5); the S9 hr tab may cite the plan's role families as reference for `hdd-01`; S12 `headcount_vs_plan` closes the chain through the existing baseline.
6. **Privacy and roles.** Aggregate planning assumptions only — the schema has no name or individual field, matching `comp_benchmark` (ADR-0039) and the S10 hiring plan; salary and 가산율 columns render only for `canWriteBusiness` roles (minimal restricted visibility; a per-field ACL is out of scope); audit events `staffing_plan.updated` / `staffing_plan.imported_to_s10`; creating, editing and confirming the plan are human acts.
7. **AI assist, proposal-only.** An `인력 운영 계획 제안 (AI)` draft fills empty rows from S3 capabilities resolved hire/build, the S5 entry strategy, and headcount hints cited from judgement notes — with a basis per value. Salary fields stay empty unless the analyst provides a source; the AI never proposes a salary number (no wage data exists in the repo to cite). Nothing saves without the person.

## Consequences

- The 총 투자비 labor figure becomes traceable to headcount, grade and salary assumptions instead of a free-text guess, and the S10 hiring baseline can be imported rather than re-derived.
- No migration; legacy assessments without a plan entry behave as today.
- Decision support only: no gate block, no grade cap; the sensitive content is aggregate assumptions, gated as above.

## Acceptance record

- Approver: the human decider (user, account techcross), chat 2026-10-15: "ADR-0175 / ADR-0176 승인". Recorded in DEC-20261015-03.
- Basis: chat approval of the decision as written, including the design's recommended resolutions of OD-1..OD-7 (by-year headcount at S5 with quarterly at S10 import; no on-cost default until HR/counsel confirm; `staffing_plan` meta entry in `business_case_lines_json`; promotion provenance copied into S8 model meta; salary masking by `canWriteBusiness` now; attrition stored with default 0; warning-only dismissible duplicate guard). Acceptance is by chat instruction; the decider did not review a per-item checklist, and this record does not claim the approver read specific items.
- Implementation status: slice 1 in progress; slices 2-4 not implemented.
- Not verified by the AI: nothing of this ADR is browser-verified.

## Honest limits

Not exercised in a browser; the `comp_benchmark` minimum cohort was reconciled at 5 (decider, chat 2026-10-15; `neb-policy` boundary 6), though the schema CHECK in `db/migrations/0008_accounts_and_pii.sql` still enforces `headcount >= 3` pending a new migration (schema change, ADR trigger); no salary reference data was found in the repo; the S10 import quarter-distribution rule is proposed, not derived from precedent. See design §13.
