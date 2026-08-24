# ADR-0067: Kill-criteria extension round 4 — screening longlist and partner DD finding surfaces

**Status**: Accepted (2026-08-25)
**Deciders**: data-architect (schema), market-intelligence-agent + partnership-agent (workstream ownership); thresholds by criterion wording per ADR-0060 rows 12/15/16

## Context

The evidence-source disposition left three entries whose "machine-readable red/viable form" was itself the blocker: #12 (no viable target in the Screening longlist), #15 (partner financial-distress red), #16 (partner IP-chain red). All three needed a data surface, not a threshold decision — viability is the knock-out verdict already recorded at Screening, and partner-DD severities are recorded findings once a home exists.

## Decision

Migration 0031 adds two tables and three computed vars; snapshot-filler Family I fills them; entries #12/#15/#16 arm under `gd-0024-class-c-decisions`. Baseline executable count rises 18→21.

| Entry | Var | Source | Semantics |
|---|---|---|---|
| #12 halt | `screening.viable_targets` count | `screening_longlist.knock_out_passed=1` | rows present but zero viable = determinate halt; EMPTY list = not yet screened → missing/UNASSESSED |
| #15 halt | `partner.financial_distress_red_count` count | `partner_dd_finding` workstream='financial_distress', severity='red' | present-always count |
| #16 halt | `partner.dd_ip_chain_red_count` count | same table, workstream='ip_chain', severity='red' | present-always count |

Partner-DD findings reference `partner_candidate(id)` — the red form is a structured row (`severity='red'` on a named workstream), replacing the narrative "red finding" with machine-readable evidence. General-workstream findings use severity only, no kill tripwire.

## Consequences

- Baseline 18→21 lands with the predicates it counts.
- The evaluator, ledger, and reader are untouched; prospective policy-pin semantics as with every activation.
- Remaining non-executable registry entries after this round: 8 (#11 QoE materiality [user-gated], #17 armed? NO — #17 was armed in round 2... corrected: remaining are #20 analysis_task migration, #21 meta/procedural by design, #22 valuation-engine dependency, #23/#26 site-infrastructure schema round, #24 user-gated decile basis, #27 procedural) — see the disposition doc.

## Cross-references

ADR-0063/0064/0065 (rounds 1–3) · migration 0031 · docs/decisions/2026-08-24-evidence-source-backlog-disposition.md
