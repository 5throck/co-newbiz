---
lang: ko
lang_reason: proper-noun
---

# ADR-0173 - Capability closing cost and milestone linkage (`투자비에 반영`, post-management milestones)

- Status: Accepted (2026-10-15)
- Date: 2026-10-15
- Decider: Human decider (chat 2026-10-15, decisions D1-D3; acceptance: "ADR-0173 승인"). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-15-capability-cost-and-milestone-linkage-design.md](../designs/2026-10-15-capability-cost-and-milestone-linkage-design.md)
- Related: ADR-0168 (decision 5 partly amended), ADR-0170 (stale basis), ADR-0171 (S5/S7 judgement fields), ADR-0172 (field order), ADR-0101 (S11/S12 post-management), ADR-0137/0138 (S5 lines copied at promotion)
- Slices: 6 (1 S5 cost lines + milestone candidates, 2 S8 re-import, 3 S11 baseline milestones, 4 S12 variance, 5 Brown Field PMI milestones, 6 capability-adjusted timing). None implemented by this ADR.
  - Implementation note: slice 1 implemented 2026-10-15 (derived S5 cost lines with per-line reflection, server amount recompute, promotion copy of reflected lines in exact 백만원, milestone candidates on `attainability.milestoneCandidate`). Status unchanged by this note; slices 2-6 are not implemented. Not exercised in a browser.

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

### Amendment 2026-10-15 (decider): display unit changed from 억 to 백만원 (OD-5)

OD-5 display unit changed from 억 to 백만원 per the decider. The S5 investment section now shows and stores amounts in 백만원 (KRW million) with an explicit `백만원` suffix and thousands separators, manual line inputs are `금액(백만원)` (`금액(백만 <통화>)` for foreign currencies), and the section carries the note `단위: 백만원(KRW)`. No migration: every line written from now on carries `amountUnit: "krw_m"`; a stored line without it is legacy and holds 억, is converted value-preserving (x100, integer-safe rounding to 0.01 백만원, e.g. 0.35억 = 35백만원) for display and rewritten in 백만원 on the next save. Capability entries store the exact judgement cost in 백만원 and the `amount_mismatch` check compares in 백만원 (a client sending no unit is read as 억). The promotion copy uses `amount` x period multiplier for `krw_m` lines and keeps the x100 conversion for legacy lines. The explicit action `선택한 비용을 투자비에 반영` saves only `business_case_lines` and shows each line's saved state.

## Acceptance record

- Approver: the human decider (user, account techcross), chat 2026-10-15: "ADR-0173 승인". Recorded in DEC-20261015-01.
- Basis: chat approval of the ADR as written, including the design's recommended resolutions of OD-1..OD-8. Acceptance is by chat instruction; the decider did not review a per-item checklist, and this record does not claim the approver read specific items.
- Scope: acceptance covers the decision. Slice 1 implementation is in progress (just started); slices 2-6 are not implemented.
- Effect on ADR-0168: decision 5 (no auto-reflect) is now partly amended; human per-line reflection of capability cost into the investment lines is allowed.
- Not verified by the AI: nothing of this ADR is browser-verified.

## Honest limits

Accepted 2026-10-15; open decisions OD-1..OD-8 resolved per the design's recommendations (see Acceptance record). Not verified: MCP greenfield handler body, exact `해소 방식` keys, timeline and scorecard internals, the ADR-0171 Brown Field table. Outputs are decision support, not investment advice.
