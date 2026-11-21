# Meeting M7-2: Certification & Regulatory Response Strategy

**Date**: 2026-08-20
**Facilitator**: certification-agent
**Participants**: certification-agent, industry-lead, region-lead, legal-counsel, brownfield-agent, valuation-agent
**Objective**: Confirm target certification schemes for the shipbuilding pilot, decision criteria for the four acquisition options, the change-of-control confirmation procedure, and how blocks_revenue interacts with the financial model.

---

## Agenda
1. Confirm the certification scheme list for the pilot (shipbuilding-adjacent)
2. Decision criteria for the four acquisition options
3. Change-of-control confirmation procedure — make it operational, not just a rule
4. `blocks_revenue` mechanics in the financial model

## Discussion

**certification-agent**: For the shipbuilding-adjacent pilot, the mandatory certification is classification-society type approval (DNV/LR/ABS/KR — the design's own worked example). I want industry-lead to confirm whether there are others specific to crankshaft manufacturing specifically, versus general marine equipment.

**industry-lead**: Crankshaft manufacturing for marine engines typically also needs ISO 9001 as a prerequisite (already in the design's dependency-DAG example) plus, depending on end-customer, IACS common structural rules compliance for the classification approval itself — that's not a separate certification, it's the technical content the classification society tests against.

**certification-agent**: Good, that keeps the pilot's certification set small: ISO 9001 → classification society type approval, a two-node DAG, which is a reasonable first real case to build the roadmap/critical-path logic against without over-scoping Stage 3.

**legal-counsel**: On acquisition-option decision criteria — I want this stated as a decision tree, not four options a human just picks from intuition. Proposed order: (1) does the target's existing certification transfer on change of control? If yes and target is otherwise attractive, acquisition may be fastest. (2) If not transferable or no target exists, compare in-house lead time against OEM-supply lead time — if the gap is under 6 months, in-house is usually preferable since it avoids margin-sharing. (3) Partnership/contract manufacturing is the fallback when neither in-house nor acquisition clears the required timeline.

**certification-agent**: I'll adopt that as the default decision-tree logic, with the explicit caveat that it's a starting heuristic for valuation-agent's cost comparison, not a rule that skips the four-way comparison table itself — the table still gets built every time, the tree just orders which option gets evaluated first.

**brownfield-agent**: On the change-of-control confirmation procedure — operationally, this needs to happen at Screening for any brownfield deal where the target holds a certification factoring into the valuation thesis, not at DD. If it's not confirmed by Pre-FS, the acquisition-premium assumption in the model is provisional and must be flagged as such, not silently assumed favorable.

**certification-agent**: Agreed — procedure: (1) identify all certifications the target holds that are load-bearing to the deal thesis, (2) request the scheme's own regulations from the certification body directly (not from the target, to avoid relying on the seller's characterization), (3) legal-counsel confirms the transferability reading, (4) result recorded before Pre-FS gate closes, with valuation-agent's premium assumption tagged `assumed` with a rationale of "pending confirmation" until then.

**valuation-agent**: I'll enforce that tag — no `derived` valuation premium from an unconfirmed certification, only `assumed` with an explicit expiry/follow-up date, consistent with how the design treats any unconfirmed number.

**region-lead**: For EU-side deals specifically, note that some classification societies operate under both IACS rules and EU-specific market surveillance regulations (e.g., for equipment sold into EU-flagged vessels) — a second regulatory layer independent of the classification society itself. I'll carry that as a region-profile field rather than folding it into certification-agent's scheme list, per the M0 profile/opinion boundary.

## Decisions

| # | Decision |
|---|---|
| D-M7-2-1 | Pilot certification scope: ISO 9001 → classification society type approval (DNV/LR/ABS/KR), two-node DAG for the shipbuilding-adjacent pilot |
| D-M7-2-2 | Acquisition-option decision tree: (1) check transferability first, (2) compare in-house vs. OEM lead time if no transfer, (3) partnership/contract as fallback — tree orders evaluation, doesn't replace the four-way comparison table |
| D-M7-2-3 | Change-of-control transferability must be confirmed by Pre-FS gate close (not DD) for any deal where target certification is load-bearing to the thesis; confirmation sourced from the certification body directly, not the target's own characterization |
| D-M7-2-4 | Any valuation premium resting on unconfirmed transferability is tagged `assumed` with a follow-up date — never `derived` until confirmed |
| D-M7-2-5 | EU market-surveillance regulatory layer (independent of classification society) tracked as a region-profile field, not folded into certification-agent's scheme list |

## Action Items

| # | Action | Owner | Landing | Status |
|---|---|---|---|---|
| A-1 | Build the ISO 9001 → classification approval DAG as the Stage 3 pilot certification roadmap | certification-agent | Stage 3 pilot | Pending |
| A-2 | Encode the acquisition-option decision tree as guidance in the certification-roadmap skill | certification-agent | Stage 2 skills | Pending |
| A-3 | Add EU market-surveillance field to `region-profiles/EU.yaml` | region-lead | Stage 2 (M6 timing) | Pending |
| A-4 | Enforce `assumed`-not-`derived` tagging for unconfirmed certification premiums in valuation logic | valuation-agent | Stage 5.2 | Pending |

## Open Issues
None new.
