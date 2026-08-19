# Operating Rhythm and Concurrent-Deal Capacity

**Owner**: process-governance-manager (with platform-lead for the system-dependent rows)
**Design of record**: design v1.0 §1-10 / meeting M7-3 / meeting M8
**Status**: Stage 3 draft — the cadence table is executable manually today (Stage 2/3); the automated rows (`job_run`, scheduled alerts) activate once Stage 5 ships.

## 1. Cadence Table

| Cadence | Task | Owner |
|---|---|---|
| Daily | Health check, backup confirmation, collection-batch results/failures, error-log triage, notification queue | sre *(Stage 5)* |
| Weekly | Dependency vulnerability scan, audit log review, capacity trend, staleness report, false-positive alert review, undefined-term report, compliance report + waivers nearing expiry | security-engineer, dba *(Stage 5)*; glossary-curator, compliance-officer *(active now)* |
| Monthly | Recovery drill, access-permission review, query performance review, **RAG threshold calibration**, governance KPI aggregation, interpretation review/publication, ADR backlog cleanup | dba, security-engineer *(Stage 5)*; process-governance-manager, compliance-officer *(active now)* |
| Quarterly | Threat model refresh, DR drill, master-data consistency audit, **proxy-chain recalibration**, regulation/procedure periodic review (waiver-concentration clauses and interpretation-query topics set amendment priority), region profile refresh, onboarding material refresh | security-engineer, platform-lead *(Stage 5)*; process-governance-manager, compliance-officer, region-lead *(active now)* |
| Annual | Full governance-document periodic review (`governance_doc.review_cycle_months`-driven forced re-approval of expired documents), full regulation-system retrospective | process-governance-manager, compliance-officer |

Rows marked *(Stage 5)* require the scheduler and monitoring system and are not executable manually — they are listed here so the cadence contract is fixed before the system exists (design's document-first principle, ADR-0032). Rows marked *(active now)* run manually starting Stage 3.

## 2. Concurrent-Deal Capacity — Computed Per Cycle, Not Fixed (O-16 resolution)

Meeting M7-3 fixed the formula:

```
concurrent_deal_cap = min(reviewer_capacity / 0.3, wall_group_compatible_assignments)
```

**O-16 was escalated to the user at Stage 1 close as "confirm reviewer allocation."** The user's resolution (2026-08-20, see `docs/transition-plan.md` §5.5): reviewer composition varies review-to-review, so a single fixed FTE number would go stale the moment staffing changes. This is not deferred — it is resolved as a **standing operational rule**:

- `reviewer_capacity` is read fresh **at the start of every review cycle**, from whoever is actually assigned as an active reviewer for that cycle (sum of each reviewer's committed days/week ÷ 5, expressed as FTE).
- The cap is **recomputed every cycle**, not looked up from a fixed table. A cycle with 0.5 FTE of confirmed reviewer time gets `cap = min(0.5/0.3, wall_group_compatible) ≈ 1`; a cycle with 1.5 FTE gets `cap ≈ 5` before the wall-group ceiling applies.
- **Conservative floor**: when no reviewer-capacity figure is available yet for a cycle (e.g. the very first cycle, before any assignment is confirmed), the cap defaults to **1** — the conservative value fixed at meeting M7-3 — rather than the design's original "starts at 3," which assumed a stronger reviewer baseline than has ever been confirmed.
- This computation is manual (a `process-governance-manager` calculation against the confirmed reviewer roster for the cycle) until Stage 5 automates it against real `project_member`/`reviewer` assignment records.

**Why this is the right resolution, not a deferral**: a fixed number decided today would be wrong the first time staffing changes, and nobody would notice until a reviewer was silently overloaded. Recomputing per cycle is the design's own formula working as intended — the earlier "decide O-16 now" framing was based on a premise (a single stable allocation number) that doesn't hold in practice.

## 3. Role and Authority Matrix (RACI) — See `docs/raci.md`

The per-gate RACI table lives in its own document since it is referenced from `docs/process-map.md`, `docs/manuals/business-manual.md`, and the entity onboarding walkthrough (`docs/transition-plan.md` §4) — keeping it separate avoids three copies drifting apart.

## 4. Related

- `docs/governance-operations.md` §6 — the higher-level cadence pointer this document fulfills.
- `docs/transition-plan.md` §5.5 — the O-3/O-16 resolution record.
- `memory/meeting-2026-08-20-m7-3-deal-execution-model.md` — the formula's origin and the "starts at 1" correction.
