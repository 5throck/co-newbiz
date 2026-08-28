# ADR-0072: Contract change-of-control clause table for the customer-attrition validator

**Status**: Proposed — implementation landed in the same change (precedent: ADR-0069/0070 landed Proposed, accepted after verification)
**Date**: 2026-08-28
**Deciders**: user (standing directive: proceed without separate approval gates), risk-officer + brownfield-agent (workstream), data-architect (schema)
**Design of record**: `checklists/ma-special-topics-checklist.yaml` ma-07/ma-08 (customer-attrition validator), design §4-9 Brown Field DD

## Context

The customer-attrition-risk validator (ma-07/ma-08) is mandatory for Brown Field DD: it scans change-of-control (CoC) clauses across customer AND supplier contracts, and assesses post-close attrition risk from concentration and churn estimates. The system had no storage for its structured output:

- `dd_finding` carries only free-text description + value_impact — no concentration percentage, no churn estimate, no CoC-presence flag, no direction. The validator's kill-criteria-relevant facts (e.g. a top customer with a CoC clause and high concentration) could only be recorded as prose, which the evidence plane cannot evaluate.
- Adjacent surfaces already cover their slices: `debt_instrument.coc_acceleration` covers lender CoC, `management_package.coc_trigger` covers executive compensation. The customer/supplier contract slice was the gap.

Alternatives considered: (a) extend `dd_finding` with category-specific columns — rejected, it would grow a generic table into every validator's schema and repeat the coupling ADR-0025 avoids; (b) record findings as prose `dd_finding` rows — rejected, narrative-only facts are exactly what the no-narrative-only rule (cdd-06) exists to prevent; (c) a dedicated table — chosen.

## Decision

Migration `0037_contract_coc_clause.sql` adds `contract_coc_clause`:

- `id` TEXT PK (ULID, NOT NULL — the ADR-0071 regime), `project_id` → `md_project`
- `counterparty` TEXT NOT NULL — counterparty entity name (a business counterparty, not a natural person; the PII discipline of FR-MA-06/SEC-05 concerns executive names and does not apply)
- `direction` CHECK (`customer` | `supplier`) — the validator scans both
- `coc_clause_present` CHECK (0|1) — the scan's central fact
- `clause_summary` TEXT — what the clause says (free text)
- `concentration_pct` REAL — the counterparty's revenue (customer) or supply (supplier) share, 0–100
- `est_churn_pct` REAL — estimated post-close churn, 0–100
- `overlap_note` TEXT — competitive-overlap observation (ma-08's third axis)
- `value_impact` INTEGER — KRW millions per ADR-0061
- `evidence_ref` TEXT, `created_at` TEXT NOT NULL

REST: `GET/POST /api/projects/:id/contract-coc-clauses` (membership-filtered, POST analyst+, audited `contract_coc_add`) — the same shape as the other Wave 5.7B deal-review surfaces. UI: an M&A 검토 tab section rendering the table with CoC-presence flagged icon+label, plus a write form (the DdTab pattern) so the validator's input is recorded where it is reviewed.

## Consequences

- ma-07/ma-08 get a structured, evaluable record instead of prose; a future registry entry expressing "top customer CoC + concentration" as a kill-criteria predicate can read this table through the evidence-var machinery without further schema change.
- The table is deliberately narrow (one validator's slice). Cross-validator aggregation (e.g. total CoC exposure across customers + debt + exec comp) remains a read-time composition, not a stored rollup.
- Raw percentages are stored as entered — no invented risk thresholds are applied at the storage or API layer; flagging semantics (what counts as "high concentration") remain a calibration/criteria concern, not a schema concern.

## Cross-references

`checklists/ma-special-topics-checklist.yaml` ma-07/ma-08 · `db/migrations/0037_contract_coc_clause.sql` · `app/web-next/app/api/projects/[id]/contract-coc-clauses/route.ts` · ADR-0061 (money units) · ADR-0071 (PK NOT NULL regime)
