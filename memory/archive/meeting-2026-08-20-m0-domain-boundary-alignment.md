# Meeting M0: Domain Boundary Alignment

**Date**: 2026-08-20
**Facilitator**: pm
**Participants**: pm, process-governance-manager, platform-lead, industry-lead, region-lead
**Objective**: Fix functional/technical/industry/region responsibility boundaries, interface contracts, and confirm the cross-validation matrix before any other Stage 1 meeting runs.
**Related**: [Design v1.0](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 5

---

## Agenda
1. Confirm each domain lead's scope against the design's section 5.2-5.5 tables
2. Fix the handoff contract between domains (who blocks whom)
3. Ratify the cross-validation matrix (design section 5.7) with the actual roster now in place

## Discussion

**pm**: This is the first real meeting with the actual 34-agent roster instead of inline role-play. Before we touch methodology, I want each lead to state their domain's boundary in one sentence, then flag anything ambiguous.

**process-governance-manager**: Functional owns *what the review process requires* and *who reviews real deals*. My boundary with platform-lead: I define the procedure, platform-lead builds the system that enforces it. If a procedure requires a check the system can't yet do, that's a blocking dependency I have to raise before Stage 2, not discover in Stage 4.

**platform-lead**: Technical owns *how the system is built and stays running*. My boundary with functional: I do not decide what a procedure requires, I decide how to implement it. One ambiguity — `certification-agent` and `data-architect` both touch the `certification` table (agent produces judgments, data-architect owns the schema). That's fine as long as certification-agent never writes SQL directly.

**industry-lead**: Industry is profile data, not judgment. My boundary with `market-intelligence-agent` (functional/analysis) matters here: I own the industry-profiles/*.yaml content (cycle position, regulatory landscape, tech transition), market-intelligence-agent owns runtime value-chain analysis. If I put analysis logic into a profile field, we've duplicated the boundary that already broke once (procedures vs. skills, S6.8).

**region-lead**: Same pattern for region — I own region-profiles/*.yaml, `legal-counsel` owns case-specific legal opinions. A region profile says "EU requires works council consultation"; legal-counsel says "in this specific deal, here's how that plays out." Profile is the rule, legal-counsel is the application.

**pm**: Good — that's actually the same procedure/skill split (S6.8) generalized to profile/opinion. I want that stated explicitly since it'll get asked again.

## Decisions

| # | Decision |
|---|---|
| D-M0-1 | Domain boundary confirmed: functional=process+review, technical=system, industry/region=profile data, never judgment |
| D-M0-2 | Generalized rule: profile data (industry-profiles, region-profiles) states the general rule; the responsible functional agent (legal-counsel, market-intelligence-agent) applies it to a specific case. Mirrors the procedure/skill split. |
| D-M0-3 | Cross-validation matrix (design S5.7) ratified as-is with the real roster — no changes needed, all named agents exist |
| D-M0-4 | `certification-agent` never writes SQL directly against the `certification` schema; all writes go through `data-architect`-owned repository code |

## Action Items

| # | Action | Owner | Landing | Status |
|---|---|---|---|---|
| A-1 | Add the profile/opinion boundary rule to procedures/ style guide when Stage 2 begins | process-governance-manager | Stage 2 procedures/_shared/README | Pending |
| A-2 | Note the certification-agent/data-architect write boundary in db-schema.md | data-architect | Stage 4 db-schema.md | Pending |

## Open Issues
None carried from this meeting.
