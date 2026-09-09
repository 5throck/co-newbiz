# Industry Profiles — Authoring Guide

How to add or update an industry profile (`<CODE>.yaml`) under `industry-profiles/`.
The schema contract is `industry-profiles/_schema.yaml`; the validator is
`industry-profiles/_validate.ts` (run by `procedures:lint` — a failing profile
blocks CI). Exemplar: `KSIC261.yaml` (Wave E pilot).

## Procedure

1. **Anchor the code.** `code` is the KSIC anchor matching `md_industry.ksic_code`
   (the value a project binds via its industry). Confirm the KSIC segment name.
2. **Research the four axes** (see the section field reference in `_schema.yaml`):
   - `value_chain_structure` — upstream tiers (materials/equipment/IP), midstream
     (fabs/OSAT), downstream demand; typical proxy-chain depth; unit of output.
   - `cycle_position_indicators` — the demand driver, typical cycle length, the
     CURRENT phase (with access-dated sources), and the peak-earnings caveat.
   - `regulatory_landscape` — primary regimes, licensing/certification bodies,
     cross-border notes (export controls first for semiconductors-class industries).
   - `technology_transitions` — known transitions, their driver, expected
     timeline, and how demand structure shifts.
3. **Cite, then assert.** Every section's `source` field carries the citation
   (statistical agency, trade association, primary regulation, or named advisory
   source). Put the full link list + access dates in a companion research doc
   under `docs/research/` (Research Standards: `## References` required) and
   reference it from the sections.
4. **Fill `verified_on`** with the date a human confirmed the section against its
   source (ISO-8601, never future). `maintainer` is the agent_key that keeps the
   section current (industry-lead for market axes, legal-counsel for regulatory).
5. **Validate**: `bun industry-profiles/_validate.ts` — zero errors/warnings.
   An empty `data` object is rejected by design: an unsourced placeholder is
   worse than a missing file, because it looks authoritative.
6. **Register** via `/sync` (SCRIPTS/CHANGELOG if tooling changed; the profile
   itself needs only the file + research doc).

## Honesty rules

- Disagreeing sources: record the spread (see KSIC264's cycle note and its
  research doc's honesty notes) — never average away a disagreement.
- Forecasts are labeled as forecasts with access dates; forum-sourced figures
  are marked indicative.
- Statutory anchors cite the statute; confirm in-force text via k-law at deal
  time rather than trusting the profile's snapshot.

## Refresh cadence

`cycle_position_indicators.current_phase_note` is the most perishable field —
review at every S1 market analysis that binds this industry. Other sections:
review when a named source publishes a material revision; bump `verified_on`
only after a human confirms against the source.
