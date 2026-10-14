---
lang: ko
lang_reason: proper-noun
---

# ADR-0173 - Capability closing cost and milestone linkage (`투자비에 반영`, post-management milestones)

- Status: Proposed
- Date: 2026-10-15
- Decider: Human decider (chat 2026-10-15, decisions D1-D3). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-15-capability-cost-and-milestone-linkage-design.md](../designs/2026-10-15-capability-cost-and-milestone-linkage-design.md)
- Related: ADR-0168 (decision 5 partly amended), ADR-0170 (stale basis), ADR-0171 (S5/S7 judgement fields), ADR-0172 (field order), ADR-0101 (S11/S12 post-management), ADR-0137/0138 (S5 lines copied at promotion)
- Slices: 6 (1 S5 cost lines + milestone candidates, 2 S8 re-import, 3 S11 baseline milestones, 4 S12 variance, 5 Brown Field PMI milestones, 6 capability-adjusted timing). None implemented by this ADR.

## Context

S5 judgements carry a closing cost (`closingCostKrwM`, 백만원) and period (`monthsToAttain`) that never reach the investment lines or the post-approval schedule. S8 receives S5 `투자비 검토 요건` lines only through a one-time copy at project promotion (`db/repositories/project.repository.ts`); it does not read them at run time.

## Decision

1. **Derived cost lines.** S5 shows read-only `역량 해소 비용 (S5 판정에서 연동)` lines above the manual lines, each with a `투자비에 반영` checkbox. Reflecting is a human per-line choice saved with the S5 form.
2. **Defaults.** Only confirmed, non-stale judgements with cost > 0 are pre-checked; drafts and stale rows show `참고(미반영)`.
3. **Units and category.** 백만원 -> 억 for display, KRW lump sum; S8 receives exact 백만원. Category suggested from `해소 방식` (build capex, hire labor, partner opex, invest capex), editable.
4. **Amount follows.** Stored capability entries in `business_case_lines_json` carry `source: "capability"`, `capabilityKey`, `reflected`, `basisHash`; the server recomputes the amount from the live judgement. Stale reflected lines stay reflected with a flag.
5. **Double count.** Warning only (name containment / token overlap / note mention), dismissible.
6. **S8.** Promotion copies reflected capability lines into the `greenfield_cost` model; a later human re-import action handles post-promotion changes.
7. **Milestones.** S5 shows `기간` and stores milestone candidates on the attainability object. Later slices import them into the S11 execution baseline (`capability_milestones`, target date = human-set start reference + months), track status and variance at S12, and feed Brown Field PMI. A committed milestone is never moved silently; a changed judgement flags it for human re-baseline.
8. **ADR-0168 amendment.** "Closing cost and months are never added to the case automatically" becomes: reflection is allowed only as a human per-line choice. Cash-flow timing stays with the capability-adjusted scenario slice.

## Consequences

- No schema change and no migration in slices 1-5 (JSON keys; baseline entries are JSON).
- Promotion copy and the greenfield route change; `parseBaselineEntries` gains one allowed key in slice 3.
- Decision support only: no gate block, no grade cap.

## Honest limits

Proposed; open decisions OD-1..OD-8 in the design. Not verified: MCP greenfield handler body, exact `해소 방식` keys, timeline and scorecard internals, the ADR-0171 Brown Field table. Outputs are decision support, not investment advice.
