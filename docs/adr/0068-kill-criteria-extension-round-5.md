---
lang: ko
lang_reason: source-material
---

# ADR-0068: Kill-criteria extension round 5 — site infrastructure and analysis_task review plane

**Status**: Accepted (2026-08-25)
**Deciders**: data-architect (schema), greenfield-agent + process-governance-manager (workstream ownership); thresholds by criterion wording per ADR-0060 rows 20/23/26

## Context

The disposition doc routed three entries to a schema round: #20 (analysis_task reviewed_by null — the Entity-IC blocking condition), #23 (wastewater capacity insufficient with no mitigation), #26 (zero sites clearing infrastructure minimums). Unlike rounds 3–4, this round needed DDL — but only additive ALTERs on the existing site_candidate surface plus one var-only seed set, since analysis_task already migrated in 0011.

## Decision

Migration 0032 adds five NULLable capacity-sufficiency flags to `site_candidate` plus three computed vars; snapshot-filler Family J fills them; entries #20/#23/#26 arm under `gd-0024-class-c-decisions`. Baseline rises 21→24.

| Entry | Var | Missing when |
|---|---|---|
| #23 halt | `infra.wastewater_insufficient_no_mitigation` count | no site has wastewater assessment populated |
| #26 halt | `infra.sites_clearing_minimums` count | no site carries all four sufficiency flags |
| #20 halt | `deliverables.required_unreviewed` count | present-always (analysis_task exists since 0011) |

Honesty rules:
- Wastewater: missing until ≥1 site assessed; insufficient AND mitigation undocumented = the determinate finding.
- Sites clearing minimums: requires ALL FOUR flags non-null on at least one site — partial assessments cannot manufacture clearance.
- analysis_task review count is present-always (the table exists since 0011; zero unreviewed = determinate pass).

## Consequences

- Baseline 21→24 lands with the predicates it counts. Remaining non-executable: 5 of 29 (#11/#24 user-gated, #21/#27 procedural by design, #22 valuation-engine dependency).
- The five new columns are nullable — existing rows are unaffected; the UI should render them as "미평가" until populated.
- No procedure YAML changed; prospective policy-pin semantics as with every activation.

## Cross-references

ADR-0063–0067 (rounds 1–4) · migration 0032 · docs/decisions/2026-08-24-evidence-source-backlog-disposition.md
