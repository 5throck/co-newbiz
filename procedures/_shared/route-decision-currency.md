# Shared Note: Route Decision Currency (S4)

**Layer**: Shared note (not a procedure — it declares no steps and blocks no gate on its own). Applies to every procedure that reads the S4 진출방식 decision, Green Field and Brown Field alike (`greenfield-screening`, `greenfield-pre-fs`, `brownfield-screening`, `brownfield-pre-fs`, and every downstream stage that keys off the track).

**Authority**: ADR-0135, migration `db/migrations/0101_route_decision_current.sql`.

## The rule

**When a route decision is revised, the previous decision is superseded, not deleted, and only the row with `is_current = 1` is authoritative for gate/stage logic.**

Concretely:

- A route may be re-decided at any point before the track's own gates close — a Greenfield→Brownfield reclassification, a sub-track change (e.g. `m_and_a` → `jv`), or any other change to the recorded entry route.
- The prior decision row stays in `route_decision` with `is_current = 0` and its `superseded_by` set to the id of the decision that replaced it. It remains visible in the 결정 이력 tab and remains in the audit record. **No route decision is ever deleted to make room for a new one.**
- Exactly one row per opportunity may carry `is_current = 1`. This is enforced by the database (`idx_route_decision_current`, a partial unique index), not by review discipline.
- Drafts (`status = 'draft'`) are never current. A draft is a work-in-progress save, not a decision; it only becomes authoritative when it is finalized.

## What this means for a reviewer

- Cite the **current** decision when recording a gate verdict. If the track in your evidence pack does not match `is_current = 1`, your pack predates a reclassification — refresh it before the gate, do not reconcile it by hand.
- A superseded decision is evidence of *what was decided then*, and is legitimate to cite as history (e.g. "the Greenfield route was assessed and superseded on <date> for these reasons"). It is never evidence of the route in force.
- Re-deciding the route does not retroactively validate or invalidate work already completed under the prior track. Whether prior-track artifacts still stand is a human judgement recorded at the gate, not something the schema decides.

## What this means for an implementer

- Read the authoritative decision through `getCurrentRouteDecision()` (`db/repositories/route-decision.repository.ts`), not through a fresh `ORDER BY decided_at DESC LIMIT 1`.
- Any write path that finalizes a decision must call `finalizeRouteDecisionCurrency(opportunityId, newDecisionId, db)` in the same write path as the insert/update. Skipping it leaves the opportunity with no current decision; doing it out of order trips the unique index.
