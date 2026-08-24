# ADR-0065: Kill-criteria extension round 3 — two asserted completeness facts

**Status**: Accepted (2026-08-24)
**Deciders**: data-architect (design), process-governance-manager (governance); thresholds by criterion wording (ADR-0060 rows 18/25)

## Context

The disposition of record (`docs/decisions/2026-08-24-evidence-source-backlog-disposition.md`) classified rows #18 and #25 as READY NOW: both are human-judged COMPLETENESS FACTS whose evidence plane needs no DDL and no computed logic — only the asserted-fact pattern round 2 established (#17's `legal.employment_transfer_consent_regime_determined`).

## Decision

Migration 0029 seeds two ASSERTED vars (source_kind='asserted', requires_evidence_ref=0); snapshot-filler's Family C reads them from LIVE + REVIEWED dimension_input rows; both entries arm under `gd-0024-class-c-decisions`. Baseline executable count rises 16→18.

| Entry | Var | Values | Trigger |
|---|---|---|---|
| #18 halt | `legal.ip_assignment_chain_complete` | 'complete' \| 'incomplete' | 'incomplete' at establishment — title integrity has NO waiver path (ef-07 precedent); arming the tripwire creates none |
| #25 escalate | `infra.plan_finalized` | 'yes' \| 'no' | 'no' at site announcement (pilot-005 F-1) |

Both fill only from reviewed assertions: an unreviewed or missing assertion leaves the var `missing` → the criterion evaluates UNASSESSED and lands in the caller-decides group (ADR-0049), never a silent pass.

## Consequences

- Baseline `_baseline.json` 16→18 lands with the predicates it counts.
- The operational loop is now explicit for both facts: a reviewer asserts via the dimension-input path (reviewed cross-domain per Family C's contract); until that happens the gate sees UNASSESSED and asks.
- No procedure YAML changed; prospective policy-pin semantics as with every activation.

## Cross-references

ADR-0063/0064 (round mechanics) · disposition doc (round plan) · migration 0029
