# Evidence-Source Backlog Decisions — the 13 Non-Executable Kill Criteria

**Date**: 2026-08-24
**Chair**: process-governance-manager · **Design**: data-architect · **Status**: disposition of record (per-item authority marked)
**Baseline (updated)**: 18 of 29 registry entries executable after round 3 landed (ADR-0063/0064 rounds); this document disposes of every remaining entry so no row floats without an owner and a path.

---

## Disposition table

| # | criterion | Disposition | Evidence source (proposed) | Authority |
|---|---|---|---|---|
| 11 | bf-fs__qoe_material_earnings_quality_gap | **USER-GATED** | QoE finding recorded as `dd_finding` (`category='qoe'`, unexplained-gap flag) once a QoE normalization capability exists; "material" needs a numeric floor (e.g. ≥X% normalized EBITDA) | User sets the materiality floor |
| 12 | bf-screening__no_viable_target_in_longlist | **DESIGN-READY** | New `screening_longlist` table (candidate, knock-out pass flags, viable flag written at the Screening gate); viable = passes all knock-outs per `strategic-fit-screening` | Agent (schema ADR) |
| 15 | deal-shape__partner_dd_red_financial_distress | **DESIGN-READY** | Partner-scoped DD findings: extend `dd_finding` with `category='partner_dd'` + `partner_id` link; distress = red finding under the financing workstream | Agent (schema ADR) |
| 16 | deal-shape__partner_dd_red_ip_chain | **DESIGN-READY** | Same partner-DD surface; IP-chain workstream red finding → boolean | Agent (same ADR as 15) |
| 18 | ee-execution__ip_assignment_chain_incomplete | **ARMED — round 3 executed** | Asserted fact via dimension_input (`legal.ip_assignment_chain_complete`, values determined/not_determined), the #17 pattern verbatim — no DDL | Agent |
| 20 | entity-ic__analysis_task_reviewed_by_null | **DESIGN-READY (larger)** | Migrate the `analysis_task` table first (the gap `agent-output-provenance` has flagged since Wave 5.8I), then a computed count var over required-unreviewed deliverables | Agent (schema + provenance wiring) |
| 21 | entity-ic__kill_criteria_condition_triggered | **BY DESIGN — no action** | Meta-criterion; evidence is the 0023 ledger itself, read procedurally by the gate (`getRecordedEvaluation`). Never predicate-expressible without self-reference | Closed by design |
| 22 | gf-dd__dd_value_impact_not_in_valuation_bridge | **DEFERRED** | Bridge linkage cannot exist until a valuation model engine lands (the same dependency as deferred MCP `run_model`✱); reopen with the engine wave | Blocked-on-dependency |
| 23 | gf-dd__wastewater_capacity_insufficient | **DESIGN-READY** | Site-infrastructure facts: add wastewater/power/logistics capacity columns (or a child table) to the site surface; insufficient = below `site-selection-checklist` minimums with no mitigation flag | Agent (schema ADR) |
| 24 | gf-fs__growth_projection_outside_top_decile | **USER-GATED** | Two halves: (a) `fin.growth_projection_decile` needs the ADR-0018 anchoring basis decided (which reference class defines the top decile) — user decision; (b) `fin.growth_signoff` risk-officer sign-off is an asserted fact (dimension_input) — agent | User decides (a); agent implements |
| 25 | gf-screening__infrastructure_plan_not_finalized | **ARMED — round 3 executed** | Asserted fact (`infra.plan_finalized`), the #17 pattern — pilot-005 F-1 origin; asserted at the Screening gate by greenfield-agent, reviewed cross-domain | Agent |
| 26 | gf-screening__zero_sites_clear_minimums | **DESIGN-READY (after 23)** | Count over site-infrastructure facts clearing the checklist minimums — shares #23's schema round | Agent (with 23) |
| 27 | pmi__clean_team_protocol_breach | **BY DESIGN — procedural** | A breach is an auditable EVENT, not a snapshot state (ADR-0060 row 27 note); a breach register could feed a count-in-window var later, but the halt semantics belong to the PMI procedure's own escalation step. Revisit only if PMI execution tooling lands | Closed as procedural (revisit trigger recorded) |

---

## Round plan

- **Round 3 (agent-executable, no user input)**: #18 + #25 asserted-fact vars (migration seeds only; the #17 filler pattern), then the schema round for #12 + #15/#16 + #23/#26 (+ #20's analysis_task migration as its own change).
- **User decisions owed**: #11 materiality floor; #24 decile basis. Both are single-question asks appended to the next decision pack.
- **Closed**: #21, #27 (by-design dispositions — removed from the actionable backlog, kept in the registry as procedural).

After round 3 + the schema round, projected coverage: 16 → 18 (round 3) → 24–25 (schema round) of 29, with #11/#24/#22 the only externally-gated stragglers.
