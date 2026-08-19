# Pilot 001 — HD Hyundai / STX Heavy Industries (Brown Field)

**Case type**: Brown Field (M&A)
**Region**: Korea (KR)
**Run mode**: Manual (no system — Stage 3 pilot per ADR-0034)
**Case source**: `docs/pilot-candidate-research.md` — a real, publicly documented, already-completed deal (not a synthetic case; the FTC decision and deal facts are matters of public record)
**Status**: In progress — this record is updated as each gate is walked

## 0. Purpose and Scope of This Pilot

This pilot tests whether the procedures, checklists, and RAG framework built in Stage 2/3 can be executed **as written**, using a real case's public facts as input. It is **not** a re-underwriting of the actual HD Hyundai / STX Heavy Industries deal — this team has no access to the parties' internal financials, DD materials, or IC deliberations, and does not attempt to reconstruct them. Every step below is explicit about which inputs are real public facts and which would require internal data this exercise does not have.

**What a pass looks like**: every gate can be walked through using the documented procedure/checklist without a step being un-executable, ambiguous to the point of blocking, or silently skipped. Gaps found feed §6 (Findings), not a verdict on the deal itself.

## 1. Screening

Procedure: `procedures/_shared/brownfield-screening/schema.yaml`

| Step | Output | Result |
|---|---|---|
| 1. `brownfield-agent` — target longlist (`brownfield-feasibility`) | `target_longlist` | **Real input, not a longlisting exercise**: STX Heavy Industries is the actual target in the real deal. For pilot purposes this step is marked satisfied by the real-world fact pattern rather than executed as a fresh longlist — a genuine future case would run this step for real. |
| 2. `antitrust-agent` — preliminary HHI screen (`antitrust-screening`) | `preliminary_hhi_screen` | **Real public data available**: combined entity reaches ~80% of the domestic crankshaft/engine-parts market and ~70% of the marine engine market (public FTC decision figures). A preliminary screen using only these two numbers correctly flags this as a high-concentration deal requiring full antitrust review at DD — it does **not** flag a "certain block," which matches the real outcome (conditional approval, not prohibition). |
| 3. `process-governance-manager` — gate pass record (`stage-gate-governance`) | `gate_pass_record` | Screening deliverables present (steps 1-2 above); gate opens to Pre-FS. |

**Kill Criteria check** (`kill_criteria` in the schema): `no_viable_target_in_longlist` — not triggered (target identified). `preliminary_hhi_flags_certain_block` — not triggered; correctly routes to `escalate_to_risk_officer` territory rather than halt, consistent with the real deal proceeding to a conditional (not blocked) outcome.

## 2. Pre-FS

Deliverable per `docs/process-map.md`: deal structure hypothesis; WACC/hurdle IRR confirmed `kind=user`.

- **Deal structure hypothesis**: real public fact — 35.05% stake acquisition, KRW 81.3 billion, structured as a partial-stake purchase rather than a full buyout. This is directly usable as the hypothesis input.
- **WACC/hurdle IRR**: **not available from public sources** — this is an internal, deal-sponsor-supplied input by design (`assumption.kind='user'`, design §4-1). This exercise cannot supply a real number here without fabricating one, so this pilot **stops short of a live financial model** and does not attempt to invent a WACC. This is flagged as a gap in scope, not a process defect (§6).
- **Certification transferability**: not applicable — this deal is an equity-stake acquisition, not a business/asset transfer that would typically trigger certification re-assessment on change of control. Noted and passed through rather than fabricated.

## 3. FS

Deliverable: full valuation, six-way M&A cross-check *started*.

- **Full valuation**: **out of scope for this pilot** (requires the WACC/hurdle gap above plus non-public financials). Not attempted.
- **Six-way M&A cross-check, started**: the antitrust workstream can genuinely start here using real facts (§4 below). The other five (customer-retention, incentive, hr-integration, certification-transferability, region-lead/labor) have no public information available for this specific deal and are marked not-started for this pilot, not failed.

## 4. DD — M&A Special Topics Checklist Walkthrough

Checklist: `checklists/ma-special-topics-checklist.yaml`. Only the antitrust items (ma-01 through ma-03) have real public data to check against; the remainder are marked "insufficient public data" rather than fabricated.

| Item | Real-world check | Result |
|---|---|---|
| ma-01: relevant market defined, HHI/HHI-delta calculated | Product market: marine engine parts (crankshafts) and marine low-speed engines. Geographic market: domestic (Korea) — this is exactly how the FTC scoped it. HHI-delta not separately published, but the FTC's own concentration finding (~80%/~70% post-merger share) is the functional equivalent output this checklist item requires. | **Satisfiable** — checklist item is executable against real data. |
| ma-02: merger-control filing requirements confirmed for every applicable jurisdiction | Real filing: Korea FTC, single jurisdiction (both parties are Korean domestic entities with no material foreign-market presence disclosed). | **Satisfiable.** |
| ma-03: gun-jumping prohibition acknowledged | No public evidence of pre-clearance integration; deal proceeded through FTC review to conditional approval on the normal timeline (public record: MOU → review → 2024-07-15 conditional approval). | **Satisfiable — no violation found in the public record.** |
| ma-04 through ma-12 (executive comp, employee comp, customer retention, incentive clawback, contingent liabilities, covenant breach, certification) | No public disclosure at the granularity this checklist requires (these are internal DD outputs, not typically disclosed in regulatory-approval press coverage). | **Not executable from public data — correctly identified as requiring internal DD access, not a checklist defect.** |

**This is itself a useful finding**: the checklist correctly discriminates between "regulatory-review items with public analogues" (antitrust) and "internal-DD-only items" (everything else) — a pilot run entirely on public data should show exactly this split, and it does.

## 5. Entity IC / Group IC

Not run — both require a completed valuation (§3, out of scope) and the six-way cross-check to actually complete (§4, only 3 of 9 items executable). This is the expected stopping point for a public-data-only pilot, not a process failure — see §6.

**Illustrative RAG assessment** (per `docs/rag-framework.md`), for the one dimension with enough real data to grade:

| Dimension | Grade (illustrative) | Rationale |
|---|---|---|
| Regulatory/Permit | Amber | Conditional approval obtained, but with binding 3-year behavioral remedies (no supply refusal, minimum volume, price cap, delivery timeliness) — not a clean pass. This is exactly the kind of finding the framework's non-averaging rule exists to surface: a "deal closed" headline would read as good news, but the Regulatory/Permit dimension correctly shows Amber, not Green, because of the ongoing remedy obligations. |
| Other five dimensions | Not gradable | Financial/Market/Data-Confidence/Technical-Execution/Risk all require inputs this pilot doesn't have (WACC, DD findings, proxy-chain data). |

Since not all six dimensions are gradable, no overall grade is produced — correctly, per the framework's own rule (Green requires all six; an incomplete assessment cannot default to any color).

## 6. Findings

| # | Finding | Type | Action |
|---|---|---|---|
| F-1 | The antitrust-screening path (steps 1-2 of Screening, ma-01/02/03 of the DD checklist) is fully executable end-to-end against real public data, with results consistent with the real-world outcome. | Positive — process validated | None needed |
| F-2 | Pre-FS's WACC/hurdle requirement and DD's remaining six checklist items correctly cannot be completed from public information alone — this pilot cannot validate them, and no synthetic number was substituted to force completion. | Scope limitation, not a defect | Confirms the design's own rule (`assumption.kind='user'`, no fabrication) is being followed correctly by this exercise itself |
| F-3 | No procedure schema exists yet for Pre-FS/FS/DD/Entity-IC stages specifically (only Screening and Group-level procedures are formalized as `schema.yaml` — see `procedures/_shared/`) — this pilot had to fall back to `docs/process-map.md`'s narrative deliverable table for those gates. | Gap | Track as a Stage 4 SRS input — these gates need formal procedure schemas before the system can enforce them, though the *content* (what's required at each gate) is already correct per this walkthrough |
| F-4 | The RAG framework's "no overall grade without all six dimensions" rule held correctly under a genuinely incomplete input set — it did not default to Amber or attempt a partial score. | Positive — framework validated | None needed |

## 7. Verdict

**Process executable, with the expected and correctly-flagged scope boundary at internal-data-only items.** This does not count as a pilot failure under ADR-0034's two-consecutive-failure rule — the process ran correctly to the edge of what public data can support, and every stopping point was a data-availability boundary the design itself anticipates (`assumption.kind='user'`, no-waiver completeness check at DD), not a process defect.

**Recommendation**: treat this as **pilot 1 of 2 needed for a full pass** — a genuine completion (through Entity IC) requires either an internal deal (still open, O-3) or a second real case with more public financial disclosure. F-3 (missing Pre-FS/FS/DD/Entity-IC procedure schemas) should be addressed before Stage 4 regardless of how the pilot concludes.
