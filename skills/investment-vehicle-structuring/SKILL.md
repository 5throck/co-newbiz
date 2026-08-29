---
name: investment-vehicle-structuring
scope: co-newbiz
description: >
  Reviews the four mandatory investment-vehicle axes (ADR-0045) as part of
  the Pre-FS deal structure hypothesis: tax structure, liability isolation,
  financing leverage, exit structure — what legal entity actually holds
  the deal (direct balance sheet vs. a newly formed SPV vs. routing
  through a holding-company subsidiary), distinct from
  `investment-feasibility-modeling`'s NPV/IRR numbers once a structure is
  chosen, and distinct from `jv-structuring`'s partnership governance
  where a JV vehicle is one of the options under review.

  Use when: "investment vehicle structure", "SPV structuring", "direct
  investment vs SPV", "holding company routing", "deal structure hypothesis
  vehicle axis".
version: 1.2.0
last_reviewed: 2026-08-23
status: active
owner: brownfield-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - investment vehicle structure
    - SPV structuring
    - direct investment vs SPV
    - holding company routing
    - deal structure hypothesis vehicle axis

  procedure_keys:
    - brownfield-fs
    - deal-shape-chain
relates_to:
  - skill: antitrust-screening
    type: follows
  - skill: project-review
    type: follows

---

## Context

ADR-0045's finding: the design covered deal valuation and acquisition
mechanics (stake percentage, spin-off vs. license for R&BD) in detail, but
never the question of what legal entity holds the deal. The same deal
produces materially different outcomes depending on vehicle choice — a
deal structure that is sound on valuation and DD alone can still not be
the optimal structure if this question was never examined. Applies to
both Brown Field (acquisition vehicle) and Green Field (new-establishment
vehicle — direct parent incorporation vs. a local holding subsidiary) — a
new-establishment decision faces the same tax/liability-isolation
questions, not just an acquisition.

## When to Use

- Every Pre-FS deal structure hypothesis, Brown Field or Green Field
- Reviewing whether an existing deal structure hypothesis actually examined vehicle choice, or only acquisition mechanics

## Execution Steps

1. **Tax structure**: tax-treaty eligibility between the investing entity's
   jurisdiction and the target/site jurisdiction, withholding-tax
   differential by vehicle location, transfer-pricing risk if the vehicle
   introduces intercompany transactions that didn't exist under direct
   ownership — via `legal-counsel` for the treaty/regulatory read,
   `valuation-agent` for the quantified impact
2. **Liability isolation**: does a proposed SPV/holding-subsidiary
   structure actually cut off parent-company exposure to the target's
   contingent liabilities, or is the isolation more apparent than real
   (piercing-the-corporate-veil risk under the relevant jurisdiction's
   law)? Direct ownership offers no isolation at all — state this
   explicitly as the baseline, not an implicit assumption
3. **Financing leverage**: SPV-level non-recourse or limited-recourse debt
   vs. drawing on parent credit — model both in
   `debt-and-contingent-liability-simulation`'s covenant-breach stress test;
   a financing structure that fails the standard +200bp shock at the SPV
   level but would pass on parent credit (or vice versa) is itself a
   finding, not a detail to skip
4. **Exit structure**: share sale vs. asset sale vs. selling the vehicle
   itself — work backward from the intended exit path to the vehicle
   choice, not forward from vehicle choice to "figure out exit later"
5. **Record all four findings as part of the deal structure hypothesis
   deliverable** — this is an extension of that existing Pre-FS output,
   not a separate document. Satisfies `checklists/brownfield-feasibility-checklist.yaml`
   bf-12 / `checklists/greenfield-feasibility-checklist.yaml` gf-11 (both
   mandatory) — the gate check reads this record directly, so an
   unrecorded review is indistinguishable from one that never happened
6. **Flag where the analysis suggests a different vehicle than the deal
   team's initial assumption** — a Pre-FS structure hypothesis that never
   changes after this review either had the right initial instinct or
   didn't get a real review; both are possible, but the review should
   visibly have happened

## Output Format

- Vehicle-structure review: tax structure, liability-isolation
  effectiveness, financing-leverage comparison (SPV vs. parent-credit,
  each stress-tested), exit-structure rationale — appended to the deal
  structure hypothesis, not a standalone document

## Related Skills

- `investment-feasibility-modeling` — the NPV/IRR numbers once a vehicle structure is chosen
- `jv-structuring` — partnership governance where a JV vehicle is one of the options under review
- `debt-and-contingent-liability-simulation` — the covenant-breach stress test for each financing option
- `legal-risk-register` — where a liability-isolation weakness gets tracked
