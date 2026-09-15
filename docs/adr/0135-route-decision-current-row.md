---
lang: ko
lang_reason: source-material
---

# ADR-0135 — The authoritative route decision is a schema fact (`is_current`), not a query convention

- Date: 2026-09-15
- Status: accepted (implemented same day)

## Context

`route_decision` (migration 0043, extended by 0058 scoring and 0088 draft/final split) records the S4 진출방식 decision for an opportunity. Its only lifecycle column is `status IN ('draft','final')`, with a partial unique index guaranteeing **at most one open draft** per opportunity (ADR-0124). Nothing constrains the number of `final` rows.

That is intentional — a route can legitimately be re-decided (Greenfield → Brownfield reclassification, or any other change to the entry route after new S1–S3 evidence lands), and the prior decision must stay on the record for the 결정 이력 tab and for audit. But the schema never said **which** of the accumulated `final` rows is the one gate and stage logic must obey.

Enforcement was therefore accidental, spread across call sites as a repeated SQL convention:

- `app/web-next/lib/project-charter.ts`, `db/repositories/project.repository.ts` (track snapshot at promotion), `lib/gate-brief.ts`, the greenfield/brownfield list routes, and the S5 recommendation route all write `ORDER BY decided_at DESC, id DESC LIMIT 1` — correct, but only because each author remembered to.
- `db/repositories/route-decision.repository.ts` `listRouteDecisionsWithScores()` filters `status = 'final'` and sorts DESC with no limit — right for a history list, but it carries no marker telling a caller which row is live, so a consumer taking `decisions[0]` inherits the convention implicitly rather than reading a fact.
- Nothing anywhere records **that** an old decision was superseded, or **by what** — the supersession is inferred from timestamps alone.

The project already has an established pattern for exactly this problem: `project_industry`, `project_policy_pin`, and `dimension_input` (migrations 0021 / 0033) use a self-referencing `superseded_by` column plus a partial unique index on the live rows. `route_decision` predates that convergence and never adopted it.

## Decision

1. **Migration 0101 (additive)** adds two columns to `route_decision`:
   - `is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1))` — the explicit "this is the decision in force" flag.
   - `superseded_by TEXT REFERENCES route_decision(id)` — nullable self-FK naming the decision that replaced this one (SQLite only permits `ADD COLUMN ... REFERENCES` with a NULL default, which matches the semantics: a current row has no successor).
2. **`CREATE UNIQUE INDEX idx_route_decision_current ON route_decision(opportunity_id) WHERE is_current = 1`** — at most one authoritative decision per opportunity, enforced by the database rather than by reviewer discipline. Drafts carry `is_current = 0` and so never collide with 0088's draft index.
3. **Backfill** sets `is_current = 1` on the latest `final` row per opportunity under the exact ordering the call sites already used (`decided_at DESC, id DESC`; ULID PKs make the tiebreak deterministic), and chains each older `final` row's `superseded_by` to the *next newer* final — the supersession chain is preserved, not flattened onto the newest row.
4. **Supersede, never delete.** Finalizing a new decision flips the previous current row to `is_current = 0` and stamps its `superseded_by`, in the same write path that persists the new decision (`finalizeRouteDecisionCurrency()` in `db/repositories/route-decision.repository.ts`, called from the S4 POST handler). The prior row and its scores stay readable in the 결정 이력 tab.
5. **Reads**: `getCurrentRouteDecision()` is the single authoritative accessor (`WHERE is_current = 1`); `listRouteDecisionsWithScores()` keeps returning the full `final` history — which is what a history tab is for — but now carries `is_current` / `superseded_by` on every row and orders the current row first, so no caller has to re-derive authority from timestamps. Call sites that consume the authoritative decision (`project-charter.ts`) read the flag instead of re-implementing the ORDER BY.

Scope boundary: the remaining `ORDER BY decided_at DESC, id DESC LIMIT 1` call sites (gate-brief, greenfield/brownfield lists, project promotion, S5 recommendation) are left unchanged in this ADR's implementation. They now agree with the flag by construction — the backfill used their own ordering — and rewriting them all is a mechanical sweep with its own regression surface, deliberately not bundled into a correctness fix. They are recorded here as the follow-up.

## Consequences

- A Greenfield→Brownfield reclassification (or any other route change) is now unambiguous at the schema level: exactly one row answers "what route are we on", and the database rejects a second.
- Track reclassification history remains fully auditable — `superseded_by` makes the chain explicit instead of implied by `decided_at`.
- A future write path that forgets to supersede the prior decision fails loudly on the unique index instead of silently accumulating a second authoritative row.
- Deferred: migrating the five remaining `ORDER BY decided_at DESC, id DESC LIMIT 1` call sites to `is_current = 1`, and deciding whether `route_decision_score` rows of superseded decisions should be surfaced differently in the history tab.
- `procedures/_shared/route-decision-currency.md` records the operating rule for reviewers (supersede, never delete; only `is_current = 1` is authoritative for gate/stage logic).

## Related

ADR-0124 (S4 draft/final split — `status`, the draft unique index, migration 0088), ADR-0104 (route decision scoring and the project charter that consumes the authoritative track), ADR-0014 (additive-only migration convention), migrations 0021 / 0033 (the `superseded_by` + partial-unique-live pattern this ADR follows).
