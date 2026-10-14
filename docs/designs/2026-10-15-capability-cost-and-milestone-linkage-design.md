---
title: Capability closing cost and milestone linkage (S5 investment lines, post-management milestones)
status: proposed
date: 2026-10-15
owner: platform-lead
lang: ko
lang_reason: source-material
---

# Capability closing cost and milestone linkage

Korean appears only as UI labels in backticks. All prose is English. Paths are relative to `app/web-next/` unless stated.

- Decider: human decider, chat 2026-10-15 (binding decisions D1-D3 below). Drafted by platform-lead.
- ADR: [ADR-0173](../adr/0173-capability-cost-and-milestone-linkage.md) (Proposed).
- Partly amends: [ADR-0168](../adr/0168-s8-capability-attainability.md) decision 5 ("closing cost and months are never added to the case automatically").
- Builds on: [ADR-0171](../adr/0171-capability-check-at-s5-s7.md), [ADR-0172](../adr/0172-holding-assessment-unification.md), [ADR-0170](../adr/0170-s3-s8-capability-linkage.md), [ADR-0101](../adr/0101-s11-post-management.md).
- Related designs: [capability check at S5/S7](2026-10-14-capability-check-at-s5-s7-design.md), [holding assessment unification](2026-10-14-holding-assessment-unification-design.md), [S8 capability attainability](2026-10-14-s8-capability-attainability-design.md).

## 1. Problem statement

S5 records, per required capability, a `해소 방식`, a closing cost (`closingCostKrwM`, unit 백만원) and a closing period (`monthsToAttain`). Neither reaches the money or the schedule:

- The S5 `3️⃣ 투자비 검토 요건 (S8 사업성 분석 입력)` section is a separate hand-entered list. A capability that costs 30억 to close is invisible to S8 unless someone retypes it.
- The closing period is a number on a judgement row; nobody tracks whether the capability was actually secured on time after approval.

## 2. Binding decisions (decider, chat 2026-10-15)

- **D1 (Option A, cost).** Show derived read-only lines `역량 해소 비용 (S5 판정에서 연동)` above the manual investment lines, each with a `투자비에 반영` checkbox. Reflecting is a human per-line choice. Reflected lines flow into the S8 input as investment items. Default: only confirmed, non-stale judgements are pre-checked; drafts and stale rows show as `참고(미반영)`. Amount 백만원 -> 억 (KRW, lump sum). Category is suggested by `해소 방식` and editable. Double-count warning against manual lines of the same item. Totals shown. When the judgement changes, the reflected amount follows.
- **D2 (period).** `monthsToAttain` is managed at milestone level and linked to post-management. First step: S5 shows the period and stores milestone *candidates*; milestone creation and tracking at S10-S12 is a later slice. A committed milestone is never moved silently.
- **D3 (amendment).** ADR-0168's "no auto-reflect" is amended: reflection is allowed only as a human-controlled per-line choice. The timing effect on cash flow stays with the later capability-adjusted scenario slice.

## 3. Verified current state

| Item | Fact (verified by reading code) |
|---|---|
| S5 investment lines | `components/stages/GreenfieldStage.tsx` holds `bcLines` `{line, category labor/opex/capex/revenue/gov_rnd, amount (억), currency, period monthly/quarterly/yearly/lumpsum, note}`; saved by `POST /api/greenfield/[oppId]` into `greenfield_assessment.business_case_lines_json` (migration 0056, JSON TEXT). The route's TypeScript body type still says `{line, kind: cost/revenue, amount}` (stale type, the JSON is stored as sent). |
| How S8 gets them | **S8 does not read `business_case_lines_json` at run time.** `db/repositories/project.repository.ts` (promotion, ADR-0137/0138) copies the latest assessment's lines **once**, when the opportunity is promoted to a project, into one `business_case_model` (`kind = greenfield_cost`, name `S5 투자비 검토 요건 (자동 이관)`) with one `business_case_line` per entry: `annual_amount_krw_m = amount x period multiplier x 100`; `lumpsum` gets multiplier 1 plus a note flag `일시불 총액 — 연반복 아님`; non-KRW currency is not converted and is flagged. Invalid categories are dropped. Edits to S5 lines after promotion do not reach S8. `lib/business-case-generator.ts` has no reference to these lines. |
| Capability cost/period | `lib/capability-attainability.ts` exposes `closing_cost_krw_m`, `months_to_attain`, `confirmed_at` (cleared when stale), `stale`, from the `attainability` object on the S3 register row (`opportunity.capability_gap_json`). |
| Post-management milestone homes | S11 `greenfield-execution-baseline` (`lib/greenfield-execution.ts`): versioned baseline with JSON `BaselineEntries` = `permit_milestones`, `certification_milestones` (`Milestone {name, issuer, target_date, gates_ref, source_id}`), `hiring_plan`, `kpi_targets`, `incentive_obligations`; unknown keys are rejected; human confirmation. S10/S11 `capex_tranche` (migration 0136, `lib/capex-tranches.ts`) with release conditions. S12 `portfolio-venture-monitoring` reads the S11 baseline "with variance against the baseline"; measure keys include `permit_milestones_met`, `certification_milestones_met`. Brown Field S12 uses `pmi-integration-execution` (step 6 integration monitoring, `app/api/projects/[id]/pmi/*`). |

## 4. Cost linkage (slice 1)

### 4.1 Derived lines

For each S3 register row with an S5 judgement whose `closingCostKrwM > 0`:

| Field | Value |
|---|---|
| `line` | capability name (read-only), suffix ` 역량 해소` |
| `amount` | `closingCostKrwM / 100` 억, rounded to 2 decimals for display, exact value kept |
| `currency` / `period` | `KRW` / `lumpsum` (fixed) |
| `category` | suggestion from 4.3, editable per line |
| state chip | `확정` / `초안` / `재판정 필요` |

### 4.2 Storage (no schema change)

Wrapping `business_case_lines_json` in an object is rejected because the promotion parser expects an array. Chosen: keep it a plain array and add entries with a marker:

```
{ line, category, amount, currency: "KRW", period: "lumpsum", note,
  source: "capability", capabilityKey: <S3 row id>, reflected: true|false,
  basisHash: <row hash v2 at reflect time>, reflectedBy, reflectedAt }
```

- Unreflected derived lines are **not stored**; they are recomputed on read. Only a human toggle writes an entry (`reflected: true`, or `false` to remember an explicit opt-out of a default-checked row).
- `amount` is **not authoritative** for `source: "capability"` entries: on read and at promotion it is recomputed from the live judgement (D1 "amount follows"). The stored amount is the last-seen value, used only to show "변경됨" when it differs.
- The existing promotion copy already ignores unknown keys; it must skip `reflected: false` entries and recompute capability amounts (slice 1 code change, no migration).

### 4.3 Category suggestion (editable)

| `해소 방식` | Suggested category | Note |
|---|---|---|
| build (자체 구축) | `capex` | `labor` offered as the alternative when the cost is mostly people |
| hire (채용) | `labor` | |
| partner (제휴) | `opex` | |
| invest (지분 투자) | `capex` | treated as an investment outflow |
| acquire / 인수 통합 (BF) | not applicable at S5 | BF cost lives in deal value |
| unset | `capex` | with a "확인 필요" hint |

### 4.4 Default reflection rule

Pre-checked only when the judgement is confirmed (`confirmed_at` set), not stale, and cost > 0. Drafts (AI or human unconfirmed) and stale rows render as `참고(미반영)` with the checkbox disabled until confirmed (recommendation; OD-1). A default-checked row is still only saved when the person saves the S5 form; nothing is reflected without a human save.

### 4.5 Stale and re-judgement (ADR-0170 interplay)

- Judgement becomes stale: a reflected line stays reflected, shows `재판정 필요`, and the total shows "포함(재판정 필요) N건". Promotion copies it with a note flag `역량 판정 재판정 필요 — 금액 검증 필요`. It is never silently dropped.
- Re-confirmed with a different cost: the amount follows (D1); the line shows the old and new amount once, and an audit event is written on the next save.
- S3 row deleted: the entry becomes orphaned; shown as `삭제된 역량` with a remove button; promotion skips orphans with a note in the promotion audit.

### 4.6 Double-count guard

Warning only, never a block. Heuristic (OD-6): a manual line is a likely duplicate of a reflected capability line when, after normalising (lowercase, whitespace and punctuation removed), either name contains the other, or token overlap >= 60%, or the manual note references the capability name. The warning names both lines and offers `수동 항목 유지` (dismiss, stored as `dupDismissed: [capabilityKey]` on the manual entry).

### 4.7 Totals

Three numbers above the manual list: `역량 해소 비용 반영 합계`, `수동 입력 합계` (KRW lump-sum and annualised shown separately, since periods differ), `투자비 검토 합계`. Non-KRW manual lines are excluded from totals with a count.

### 4.8 S8 consumption

- At promotion: reflected capability entries become `business_case_line` rows in the same `greenfield_cost` model, `annual_amount_krw_m = closingCostKrwM` (no x100 round trip; source is already 백만원), `start_year = 1`, note `S5 역량 해소 비용 연동 (판정 <id>) — 일시불 총액`, plus a stable `capabilityKey` in the note for traceability.
- After promotion (gap today for all S5 lines): proposed slice 2 adds a human `S5 투자비 다시 가져오기` action in S8 parameters that diffs S5 lines against the model and applies selected changes. No background sync, consistent with human-controlled reflection.
- The lump-sum-in-year-1 treatment is the existing behaviour; the timing effect (spreading over `monthsToAttain`) belongs to the capability-adjusted scenario slice (D3).

### 4.9 API

- `GET /api/greenfield/[oppId]`: add `capability_cost_lines` (derived view: key, name, cost 백만원, 억, method, suggested category, state, reflected, stale, dup warnings).
- `POST /api/greenfield/[oppId]`: accepts `source: "capability"` entries; server validates that `capabilityKey` exists on the register, recomputes amount, ignores client amount, stamps `reflectedBy/At` from the session user (the agent inherits the calling user). Fix the stale body type.
- No new route.

## 5. Milestone linkage

### 5.1 Candidate (slice 1, S5)

S5 shows `기간` per capability and a read-only list `사후관리 마일스톤 후보` derived from confirmed judgements with `monthsToAttain > 0`:

```
{ capabilityKey, name: "<capability> 역량 확보", method, monthsToAttain,
  ownerRole: suggested from method (hire -> HR, partner -> 사업개발, build -> 기술, invest -> 전략), 
  basisHash, judgementConfirmedAt, state: candidate }
```

Returned as `milestone_candidates` (recomputed on read). The stored candidate lives on the S3 register row as `attainability.milestoneCandidate` (written by the S5 judgement save, through the existing single-writer path), so no new column and no schema change.

### 5.2 Home (slice 3)

Recommendation (OD-4): **S11 Green Field execution baseline** is the home, as a new `capability_milestones` list in `BaselineEntries` (same `Milestone` shape plus `capability_key`, `owner_role`, `months_from_start`, `basis_hash`). Reasons: it is already the versioned, human-confirmed plan; S12 already computes variance against it; capex tranche release conditions can reference a milestone via `gates_ref`. S10 is a design stage (structure, financing) and has no schedule object; PMI is Brown Field only.

- `target_date = project start reference + monthsToAttain`. Start reference (OD-3): the S11 `실행 착수일` entered by the person confirming the baseline (default: IC approval date), stored once per baseline version.
- Import is a human action `역량 마일스톤 후보 가져오기` in the baseline editor; each candidate is selectable and editable before confirmation.
- Code change only (`parseBaselineEntries` allowed keys); no migration because entries are JSON.

### 5.3 Tracking and variance (slice 4, S12)

- Status per milestone: `planned` / `achieved (actual date, evidence)` / `delayed` / `dropped (reason)`, recorded by people in the S12 review cycle.
- New measure key `capability_milestones_met` beside `permit_milestones_met`; variance = actual - target in days; shown in the portfolio scorecard and the timeline.
- Reference evidence only: no gate block, no automatic transition term.

### 5.4 Change after commitment

When the S5/S7 judgement changes after a milestone is in a confirmed baseline (basis hash or months differ): the milestone gets a flag `역량 판정 변경 — 재기준선 검토 필요` with old and new months. The target date is never changed automatically; only a new baseline version confirmed by a person moves it. Candidates (unconfirmed) simply follow the judgement.

### 5.5 Brown Field

- Cost: S7 per-target judgements use `인수 통합`; closing cost is part of deal value and integration budget, so no S5 investment line is derived (BF has no S5 investment section). Integration cost that a person wants in the case is entered in S8/S9 as today.
- Period: per selected target, candidates become PMI integration milestones (`pmi-integration-execution`, 100-day plan / step 6 monitoring) in slice 5. Depends on the ADR-0171 `brownfield_target_capability_judgement` storage; its existence in migrations was not verified.

## 6. Audit

On a human save: `capability_cost.reflect` / `.unreflect` (capabilityKey, amount 백만원, category, basisHash), `capability_cost.amount_followed` (old, new), `capability_cost.dup_dismissed`. Promotion audit lists copied, flagged and skipped capability lines. Later slices: `capability_milestone.import`, `.rebaseline_flagged`, `.status`. All under the calling user.

## 7. Human-only boundaries

- Reflecting is a human per-line decision; defaults are proposals that only take effect on a human save.
- AI drafts of cost/months (ADR-0172 slice 3 and the AI-draft work in progress) are unaffected; an AI draft is never pre-checked.
- No grade cap, no gate block. Milestone dates move only by human re-baseline.

## 8. Existing-data impact

No migration. Existing `business_case_lines_json` has no `source` key and is treated as manual. Already-promoted projects are untouched; their S8 models change only through the slice 2 re-import action.

## 9. Tests

Unit: conversion (백만원 -> 억, exact 백만원 at promotion), default rule (confirmed/draft/stale/zero), category mapping, dup heuristic cases (Korean names, substrings, below threshold), amount-follows, stale flag, orphan skip, promotion copy with `reflected: false` skipped. Route: client amount ignored, unknown `capabilityKey` rejected (400), user stamping. Later: baseline `capability_milestones` parse, re-baseline flag, variance computation.

## 10. Wiki and glossary

Glossary entries: `역량 해소 비용`, `투자비에 반영`, `마일스톤 후보`, `재기준선`. Wiki: S5 page section on reflection and the double-count warning; S11/S12 pages once slices 3-4 land.

## 11. Risks

- Double counting despite the warning (manual line named differently). Mitigated by totals shown side by side.
- Lump sum in year 1 overstates early outflow; acknowledged until the scenario slice.
- Post-promotion drift (S5 changed, S8 not) already exists for manual lines; slice 2 addresses it.
- Other agents are changing the S5 judgement UI now; slice 1 must land after that work.

## 12. Slices

1. S5 derived cost lines, checkbox, defaults, category suggestion, dup warning, totals, server recompute, promotion copy; S5 `기간` display and milestone candidates on the attainability object.
2. S8 `S5 투자비 다시 가져오기` diff-and-apply (all S5 lines).
3. S11 baseline `capability_milestones` import with start reference.
4. S12 status, variance, scorecard measure, re-baseline flag, timeline.
5. Brown Field PMI integration milestones per selected target.
6. Capability-adjusted scenario: timing of reflected costs over `monthsToAttain` (ADR-0168 slice 4).

A dedicated `capability_milestone` table is not needed for slices 1-5; if S12 status history outgrows the baseline JSON, propose it then with an ADR (schema-change trigger).

## 13. Open decisions (resolved 2026-10-15)

Resolved: the human decider approved ADR-0173 in chat on 2026-10-15 ("ADR-0173 승인"), adopting the recommendation in every row below (DEC-20261015-01). No per-item checklist was reviewed.

| ID | Question | Resolution (as recommended) |
|---|---|---|
| OD-1 | Default reflection rule | Confirmed + non-stale + cost > 0 pre-checked; drafts/stale shown `참고(미반영)` and not checkable until confirmed. |
| OD-2 | Category mapping | Table 4.3; editable per line; `build` defaults to `capex`. |
| OD-3 | Start date owner | Person confirming the S11 baseline sets `실행 착수일`; default IC approval date. |
| OD-4 | Milestone home | S11 execution baseline (GF), S12 tracks variance; PMI for BF; not S10. |
| OD-5 | FX/unit | Closing cost is KRW 백만원 only; display 억 with 2 decimals; S8 receives exact 백만원; no FX in this feature. |
| OD-6 | Double-count heuristic | Normalised containment or >= 60% token overlap or note mention; warning with dismiss. |
| OD-7 | Stale reflected line | Stays reflected with flag; not dropped. |
| OD-8 | Post-promotion sync | Human re-import action (slice 2), no background sync. |

## 14. Not verified

- Whether any S8 path other than promotion reads `greenfield_assessment` (only `project.repository.ts` and the greenfield route reference the column; MCP `record_greenfield_assessment` handler body not read).
- The exact `해소 방식` key values in code (mapping uses design names).
- Timeline route and scorecard internals beyond the procedure text; `capex_tranche` column details.
- Whether the ADR-0171 Brown Field judgement table is implemented.
- Outputs are decision support, not investment advice.
