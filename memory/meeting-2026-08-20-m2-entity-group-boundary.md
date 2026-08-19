# Meeting M2: Entity ↔ Group Review Boundary

**Date**: 2026-08-20
**Facilitator**: group-review-agent
**Participants**: group-review-agent, process-governance-manager, legal-counsel, valuation-agent
**Objective**: Fix what belongs at entity-level judgment vs. group-level, define Group IC's distinctive questions, and settle the capital-allocation ranking mechanism.

---

## Agenda
1. Draw the entity/group line precisely
2. Group IC's questions that entity-level literally cannot answer
3. How capital-allocation ranking actually works mechanically

## Discussion

**group-review-agent**: Design already says Group IC is usually a ranking decision, not approve/reject. I want to make that mechanical rather than aspirational.

**process-governance-manager**: From the procedure side: Entity IC judges "is this a good deal for us." Group IC judges "is this a good deal for the group, and is it the best use of this capital vs. other group proposals right now." Those are genuinely different questions — an entity can be 100% correct that a deal clears its own hurdle rate and still be wrong for the group if it duplicates another subsidiary's pipeline.

**legal-counsel**: The portfolio-overlap and intra-group-transaction checks are also literally invisible at entity level — an entity reviewer has no visibility into a sibling company's business. That's the strongest argument for why Group IC isn't redundant with Entity IC, and worth stating plainly since someone will eventually ask "why do we need both."

**valuation-agent**: On ranking mechanics — I propose `group_agenda.priority_rank` is computed from IRR-over-hurdle spread, RAG grade, and capital requested, normalized against the group's available capital budget for the cycle. Ties get broken by risk-officer's Kill-Criteria-adjacent findings — a lower-IRR deal with zero red flags may rank above a higher-IRR deal sitting on an Amber RAG.

**group-review-agent**: Agreed, and I want to record explicitly: Group IC can approve an Entity-IC-approved deal *conditionally* — e.g., approve at reduced capital allocation, or approve contingent on a specific remediation. That's a `decision` value beyond simple approve/reject, and needs to exist in the schema.

**process-governance-manager**: Noted for the `approval_chain.status` enum — `conditional` needs to be a first-class value, not folded into notes.

## Decisions

| # | Decision |
|---|---|
| D-M2-1 | Entity IC = "good deal for us"; Group IC = "good deal for the group, best use of this capital right now" — genuinely different questions, not duplicated review |
| D-M2-2 | Group IC ranking formula v0: IRR-over-hurdle spread + RAG grade + capital requested, normalized to cycle capital budget; ties broken by risk-officer flags |
| D-M2-3 | `approval_chain.status` must support `conditional` as a first-class value (approve-with-conditions), not just approved/rejected |
| D-M2-4 | Reaffirmed: Group IC review under the project's `project_policy_pin` version unless a material policy change forces an explicit re-evaluation decision (design S6.4) |

## Action Items

| # | Action | Owner | Landing | Status |
|---|---|---|---|---|
| A-1 | Add `conditional` to `approval_chain.status` enum in schema design | data-architect | Stage 4 db-schema.md | Pending |
| A-2 | Draft the ranking formula as a concrete `group_agenda` query spec | valuation-agent, group-review-agent | Stage 2 procedures | Pending |
| A-3 | Write the "why both Entity and Group IC exist" rationale into the business manual | process-governance-manager | Stage 2 business manual | Pending |

## Open Issues
None new.
