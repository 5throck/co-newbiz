# ADR-0045: Investment vehicle structuring as a mandatory deal-structure-hypothesis axis

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: brownfield-agent, valuation-agent, legal-counsel

## Context

The design covers deal valuation and acquisition mechanics (stake percentage, spin-off vs. license for R&BD — ADR's own §18.2 addendum) in detail, but never addressed the investment vehicle question: what legal entity actually holds a deal — direct corporate balance sheet, a newly formed SPV, or routing through a holding-company subsidiary. This surfaced as a real gap during Stage 5's system pilot re-run (`docs/pilots/pilot-001-system-rerun.md`), user-flagged and recorded first in the design of record (`ai-workspace-standards` PR #573, design §19) before this ADR.

The same deal produces materially different outcomes depending on vehicle choice: tax structure (withholding, tax-treaty eligibility, transfer pricing), liability isolation (whether parent-company exposure to the target's contingent liabilities is actually cut off), financing leverage (SPV-level non-recourse/limited-recourse debt vs. drawing on parent credit), and exit structure (share sale vs. asset sale vs. selling the SPV itself). A deal structure that never examined these four axes can be sound on valuation and DD alone and still not be the optimal structure.

## Decision

The Pre-FS "deal structure hypothesis" deliverable (`procedures/_shared/brownfield-pre-fs/schema.yaml`, `procedures/_shared/greenfield-pre-fs/schema.yaml`) gains four mandatory review axes: tax structure, liability isolation, financing leverage, and exit structure. This applies to both Brown Field and Green Field — a new-establishment decision (direct parent incorporation vs. a local holding subsidiary) faces the same tax/liability-isolation questions, not just an acquisition.

No new procedure schema or new gate is introduced — this extends the existing deal-structure-hypothesis deliverable definition, the same way the R&BD case-subtype extension (ADR referenced in design §18.2) extended `brownfield-pre-fs` rather than adding a parallel procedure.

Ownership: `brownfield-agent` (deal-structure ownership generally) coordinates; `valuation-agent` models the tax/financing/exit-structure quantitative impact; `legal-counsel` advises on liability-isolation effectiveness (including piercing-the-corporate-veil risk) and tax-treaty eligibility; `risk-officer` reviews liability-isolation and financing-leverage findings for Kill-Criteria-adjacent risk (e.g. a financing structure that would fail the standard +200bp covenant-breach stress test — `debt-and-contingent-liability-simulation`).

## Consequences

- A new skill, `investment-vehicle-structuring`, is added (financial/simulation group extension) to operationalize the four-axis review — distinct from `investment-feasibility-modeling` (the NPV/IRR numbers once a structure is chosen) and `jv-structuring` (partnership governance once a JV vehicle is one of the chosen structures).
- `checklists/brownfield-feasibility-checklist.yaml` (bf-12, mandatory) and `checklists/greenfield-feasibility-checklist.yaml` (gf-11, mandatory) now carry the item confirming the four-axis review was actually conducted before Pre-FS closes — landed as a same-session follow-up rather than left as an open item.
- No procedure schema migration is required — this is a deliverable-content extension, not a new step or gate.
