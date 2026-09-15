---
lang: ko
lang_reason: source-material
---

# ADR-0081: S7 target-screening checklist (chk-target-screening)

**Status**: Accepted — implemented in the same change (checklist + procedure wiring)
**Date**: 2026-09-01
**Deciders**: user (standing directive), process-governance-manager (procedure gate), brownfield-agent (draft)
**Design of record**: `checklists/target-screening-checklist.yaml`, `procedures/_shared/brownfield-target-screening/schema.yaml` step 1, meeting record `memory/meeting-2026-08-31-structural-weakness-remediation.md` (W2)

## Context

flow.spec v2.0.0 (ADR-0076) introduced S7 대상 스크리닝 with its own `target_screening` gate,
but the screening procedure (`brownfield-target-screening`) reused the strategic-fit checklist
for evidence. The spec's screening axes — ownership/availability, regulatory (foreign-investment
limits, licensing transfer, concentration pre-screen), geographic fit, and capability relevance
vs the S1/S3 required-capability list — had no checklist home, leaving S7's evidence narrative-
only. The remediation meeting (W2) recommended a dedicated checklist with knock-out axes plus a
rated scorecard.

## Decision

1. **New checklist** `checklists/target-screening-checklist.yaml` (`governance_doc_id:
   chk-target-screening`, gate: Target Screening, owner brownfield-agent):
   - Part 1 — must-meet knock-outs: **t-01** ownership/availability (mandatory,
     waiver_eligible=false — availability is a completeness fact), **t-02** regulatory screen
     (mandatory, non-waivable), **t-03** geographic fit (waivable with recorded exception),
     **t-04** structural market contraction+commoditization (the standing kill axis, waivable),
     **t-05** capability relevance vs S1/S3 required capabilities (waivable).
   - Part 2 — should-meet rated criteria (0–10, weighted, visible scorecard): **t-06** strategic
     value, **t-07** capability complementarity, **t-08** financial attractiveness, **t-09**
     integration/partnership complexity.
   - Thresholds are ILLUSTRATIVE until a dated decision record activates them (the same rule as
     ADR-0051 open (b) / the anti-tamper gate).
2. **Wiring**: `brownfield-target-screening` step 1 now cites chk-target-screening (ADR-0081) in
   both its description and legal_basis; the strategic-fit checklist remains referenced for the
   rated-scorecard convention only. No flow.spec change needed — procedures are gate-keyed.
3. **Outputs** (unchanged contract): Target Company Short List + Target Ranking/Score + Screening
   Evidence + Exclusion Reasons; every Long List candidate must carry a ranking or an exclusion
   reason (the gate's decision criteria).

## Consequences

- **Positive**: S7 evidence is checklist-structured (the DD-era checklist engine can run it);
  ownership/availability and regulatory axes are first-class, not prose; Exclusion Reasons have a
  defined home.
- **Neutral**: checklist validation (`checklists/_validate.ts`) passes; the item count moved
  203 → 212.
- **Follow-up (W3/W4 of the meeting)**: S5 dedicated procedure and the S4+ rebuild remain open
  per the recorded action plan (this ADR covers W2 only).
