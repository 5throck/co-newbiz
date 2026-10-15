---
lang: ko
lang_reason: proper-noun
---

# ADR-0177 - Investment account sub-categories (`세부 과목`) and quantity x unit-price helper

- Status: Accepted (2026-10-15)
- Date: 2026-10-15
- Decider: Human decider. Acceptance in chat 2026-10-15: "ADR-0177(계정 과목 확장). OD-2(특허 유지·연차료를 운영비로 이동) 승인". Earlier input (chat 2026-10-15: keep the five top-level categories, add optional sub-categories as a JSON field, cover certification and patent/IP costs with a quantity x unit-price helper and no system default prices; permit/certification cost columns later under a separate ADR). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-15-investment-account-subcategories-design.md](../designs/2026-10-15-investment-account-subcategories-design.md)
- Related: ADR-0173 (judgement-owned category), ADR-0174 (investment summary, `bc.investment_basis`), ADR-0175 (staffing plan), ADR-0176 (investment simulation)
- Slices: 4 (1 vocabulary + field + UI + summary + defaults, 2 helper, 3 promotion/S8/S10 carry, 4 permit/certification cost columns under a separate ADR). None implemented by this ADR.

## Context

S5 investment lines carry only five top-level categories (`labor`, `opex`, `capex`, `revenue`, `gov_rnd`), which drive S8 `s5_plan` vectors (capex -> investment; labor/opex -> cross-check unless `s5_plan_full`). Analysts cannot distinguish land from software, or certification from marketing, and have no structured way to estimate certification and patent costs. `business_case_line` has no sub-category column; `permit` and `certification` (migration 0011) have no cost columns.

## Decision

1. Keep the five categories and the DB CHECK unchanged. Add an optional `subCategory` key on S5 lines from a fixed two-level vocabulary (22 keys: capex 9, opex 10, labor 3; none under revenue/gov_rnd), parent must match the line category.
2. Sub-categories never change an S8 calculation path. The design states which sub-categories S8 counts as investment under `s5_plan` (capex children) and which are cross-check only (opex children, including certification, permit and patent maintenance costs) and surfaces this in the UI.
3. Add an optional quantity x unit-price helper (`count x countries x unitPriceKrwM`, 0.01 백만원 rounding, KRW only, optional renewal period `everyYears`, required price source). The system ships no default unit prices; any embedded statutory fee table needs k-law verification and an amendment.
4. Defaults: staffing plan -> `직접 인건비` / `채용·교육비`; capability judgements get a suggested sub-category from the resolution, owned by the judgement. AI may propose sub-categories only, never prices or amounts.
5. No S5 or S8 migration: promotion carries the sub-category and helper basis in the `business_case_line.note` tag and expands multi-year renewals into per-occurrence lump-sum lines.
6. Permit/certification cost columns and links are deferred to a separate ADR (schema change trigger).

## Consequences

- Better readability and reporting without touching S8 math; certification costs and patent maintenance/annual fees (`특허 유지·연차료`, moved to opex because they recur yearly, OD-2) stay opex and are excluded from NPV under `s5_plan` unless the reviewer picks `s5_plan_full`; the S8 run record shows the one-off opex total that `s5_plan` leaves out (OD-1).
- Vocabulary changes require an amendment to this ADR.
- Open decisions OD-1..OD-7 are resolved in the design section 11.

## Acceptance record

- Approved by: user (account techcross), human decider, chat 2026-10-15. Record: docs/decisions/DEC-20261015-05.md.
- Resolutions: OD-2 explicitly approved (patent maintenance and annual fees move from capex to opex); OD-1 and OD-3..OD-7 accepted as recommended in the design.
- Basis and limits: decision by chat instruction; no per-item checklist was reviewed beyond OD-2.
- Implementation: none yet; slice 1 starts next, slices 2-4 later; slice 4 needs its own ADR.
