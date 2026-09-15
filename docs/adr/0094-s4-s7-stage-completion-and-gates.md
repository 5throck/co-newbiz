---
lang: ko
lang_reason: source-material
---

# ADR-0094: S4 re-review, S5–S7 stage completion, opportunity-keyed gates, and S3 role separation

- Status: Accepted
- Date: 2026-09-03
- Deciders: New Business Review Lead (PM), per user direction
- Related: ADR-0074 (flow.spec v2.0.0, 11-stage model), ADR-0090 (synergy alignment), ADR-0093 (company-profile S1-level expansion), ADR-0014 (additive migrations), ADR-0084 (route decision)

## Context

flow.spec v2.0.0 defines S4 (route decision), S5 (capability assessment,
greenfield only), S6 (target universe/long list, brownfield only) and S7
(target screening, brownfield only) with completion criteria and gates — but
the implementation stopped at the artifacts: no gate could ever be RECORDED
(the only gate-decision REST lived in the deleted `/api/projects/**` tree), stage
completion was derived for S1–S3 only, the S7 kill criterion (zero knock-out
passing candidates) was never surfaced, and S6's Target Universe artifact had no
home. Separately, ADR-0093 made the affiliate profile report S1-level, leaving
/synergy's finance and strengths/weaknesses tabs as duplicated, weaker copies.

## Decision

### 1. Opportunity is the S1–S7 lifecycle carrier

Spec `meta.entity_lifecycles` splits opportunity=[S1..S4] / project=[S5..S11],
but every live S5–S7 route and screen is keyed by opportunityId and no project
entity exists in the live tree. Until project promotion returns (S8+ work),
gates and stage evaluation address `/api/opportunities/:id/...`. The
`gate_decision.entity_type` column already supports the future split without
schema change; the project entity is deferred, not deleted.

### 2. Gate recording is a first-class human surface

New `GET/POST /api/opportunities/[id]/gate-decisions` (analyst+ write, audited
`gate_decision.record`). POST enforces the spec's discipline: HOLD requires a
non-empty `missing_artifacts` list — a HOLD without stated gaps reads as a soft
pass and is rejected. A `GateDecisionPanel` component (per-gate state chips +
record form + append-only history) mounts on /route-decision (screening, pre_fs),
/greenfield (pre_fs) and /brownfield (target_screening). Boundary #2 is thereby
mechanical: the record button belongs to a human.

### 3. Migration 0062

(a) `gate_decision` CHECK widened via row-preserving table rebuild to accept the
S7 gate `target_screening` (the 0042 enum predates flow.spec v2.0.0's gates
list). (b) `opportunity.target_universe_json` — the S6 Target Universe artifact
(definition, selection criteria, minimum long-list coverage) as an additive
column, no new table.

### 4. Stage completion derived for S4–S7

`evaluateProcess` extends to S4–S7 and derives the track/sub-track from the
latest `route_decision`. Completion per flow.spec: S4 = route_decision with
track (brownfield additionally requires sub_track + all five criteria scores);
S5 = capability gaps + entry strategy + recorded alternatives; S6 = universe
defined + long list meets the universe's minimum coverage (default 3); S7 =
every candidate shortlisted or excluded-with-reason AND at least one
knock-out-passing shortlist entry. Track-inapplicable stages report `skipped`
(greenfield's S6/S7, brownfield's S5) so they neither block nor misread as
pending. The S7 kill criterion is surfaced: zero knock-out-passing candidates
raises a visible "KILL 검토 필요" hint on both the process evaluation and the
gate panel.

### 5. S3 role separation (profile owns company detail, synergy owns synergy)

/synergy drops its finance and strengths/weaknesses tabs — ADR-0093 made them
weaker duplicates of /our-company. The synergy report is now: 개요 (profile
summary card with a deep link to the affiliate's /our-company detail, business
assessment, linked-opportunity context and the synergy-score recommendation) /
연계 시너지 / Short List (S4 handoff unchanged) / 출처·노트. The payload gains
`profileRef` for the deep link; existing fields stay (old versions remain
readable). /our-company gains a "시너지 분석 →" action that deep-links to the
member's existing synergy analysis or /synergy. Synergy rerun is fixed: a new
`POST /api/synergy/analyses/[id]/rerun` reuses the row (legacy target_type rows
refused) instead of always creating a new analysis.

### 6. Dead-surface cleanup

`lib/api.ts` client functions and types pointing at the deleted
`/api/projects/**` tree are removed (no importers; PmiEvidenceTab and
SimulationDistChart were orphaned with them and are deleted). MCP
`get_process_evaluation` / `get_gate_decisions` / `record_gate_decision` /
`create_route_decision` now call the live opportunity-keyed routes;
`run_stage_agents` registration is removed until its REST route exists — the
server must never advertise a dead endpoint.

## Consequences

- **Positive**: S1–S7 now has a closed loop — artifacts, derived completion,
  and human gate decisions in one addressing scheme; S7's kill criterion is
  enforced by visibility; synergy and profile screens have non-overlapping
  roles with explicit hand-offs in both directions.
- **Risk accepted**: gate decisions recorded before S8+ will keep
  `entity_type='opportunity'` even when the opportunity is later promoted;
  migration of historical gate rows to project addressing is an S8+ concern.
- **Risk accepted**: synergy rerun failures leave the row `in_progress` (the
  table's status CHECK has no `failed`; the S1 0061 precedent can be applied
  later if needed).
- **Migration**: one (0062). No flow.spec change — this ADR implements the
  spec, so `docs/process-flow.md` is untouched beyond its prior regeneration.
