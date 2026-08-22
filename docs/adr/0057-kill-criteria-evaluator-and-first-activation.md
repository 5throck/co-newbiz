# ADR-0057: Kill-criteria evaluator and the first registry activation

**Status**: Accepted
**Date**: 2026-08-23
**Deciders**: process-governance-manager (chair), risk-officer (AI-1 owner), platform-lead, PM

## Context

ADR-0055 landed the two risk-thresholds AI-1 criteria in the kill-criteria registry as **staged but inert**: predicates seeded verbatim from migration 0019, `enabled: false`, and notes stating the flip condition explicitly — *"enabled=false until a kill-criteria evaluator exists; the anti-tamper gate (registry check c) demands policy_id + thresholds_source before any flip to enabled=true."* The registry README says the same. Until now nothing in the codebase could evaluate a registry predicate at all: the registry was 23 declared / 2 executable / **0 enabled**, and "executable" meant only that the JSON carried a well-formed predicate.

The missing piece is the same one `rag_rule` waited on before PR-9: a runtime evaluation path. Rule assessment got its consumer (`db/lib/rule-assessment.ts`, migration 0022 activation); kill criteria did not. This ADR records the evaluator and, with the anti-tamper condition now satisfiable, the first activation.

## Decision

### 1. The evaluator is `db/lib/kill-criteria.ts`, read-only by construction

`evaluateKillCriteria(db, { runId, projectId, procedure, industryIds?, now? })` loads the procedure's registry entries (`procedures/_kill-criteria/<procedure>__*.json`), evaluates every **enabled, predicate-carrying** entry against the run's `project_variable_snapshot` through the **same ADR-0046 predicate engine** `rule-assessment.ts` uses (`parsePredicate` / `evaluatePredicate`, Kleene semantics, identical var coercion — `value_num` wins over `value_text`, `low_confidence` maps to missing for evaluation), and returns:

```ts
{ runId, projectId, procedure, evaluated, triggered: [{ criterion_id, title, action, predicate }], unassessed: string[], inert: number }
```

- **TRUE ⇒ triggered**, carrying the entry's action (`halt` / `mark_conditional` / `escalate_to_risk_officer`) — the caller routes on it.
- **UNASSESSED ⇒ listed, never resolved silently.** The criterion_id lands in `unassessed` and the caller decides. No defaulted halt, no defaulted pass — ADR-0049's honesty rule ("missing evidence is not a grade") applied to kill criteria: absence of evidence is not a clean bill.
- **FALSE ⇒ determinately not triggered.** Nothing reported — the var was present and the condition measured false (e.g. `risk.covenants_breached = 0`).
- **Inert entries are counted, not hidden** — `inert` reports the declared-but-not-machine-evaluable remainder, mirroring registry check (b)'s warn.

Nothing is persisted. The evaluator is the evaluation path only; the gate-flow consumer that would record a triggered criterion (compliance_check / gate_pass_record wiring — and the choice between them) is deliberately out of scope. This is the same landing posture `rule-assessment.ts` took: lib + tests, consumer wiring after, so the evaluation semantics are testable and reviewable before anything acts on them.

### 2. Fill-once composition with rule assessment (ADR-0005)

Both evaluators read the same run snapshot. `assessRulesForRun` fills unconditionally and the snapshot's composite PK makes a second fill throw (ADR-0005 immutability). The kill-criteria evaluator therefore fills **only when the run has zero snapshot rows** and never otherwise: the supported composition order is **assess-first, then evaluate** — and re-running the evaluator on the same run is idempotent. D-M-RISK-3's "both, non-competing" boundary is now executable end-to-end: the graded Amber/Red rule and the kill action read the same snapshot rows, and neither can weaken or substitute for the other.

### 3. The two ADR-0055 entries activate

Both flip to `enabled: true` with the anchors registry check (c) demands:

| criterion | action | policy_id | thresholds_source |
|---|---|---|---|
| `covenant_breach_with_coc_acceleration_under_downside` | halt | `gd-0022-risk-thresholds` | risk-thresholds.md — D-M-RISK-2 + AI-1; activated by ADR-0057 |
| `partner_dependency_unconfirmed_and_no_alternative` | mark_conditional | `gd-0022-risk-thresholds` | risk-thresholds.md — D-M-RISK-3 + AI-1; activated by ADR-0057 |

Predicates are unchanged from ADR-0055 (verbatim from migration 0019, over the 0018-seeded vars only — the AI-1 constraint). The `_baseline.json` executable count stays **2**: activation adds no new predicates, it turns existing ones on. Registry state after this change: 23 declared / 2 executable / **2 enabled** — the first time any kill criterion is machine-evaluable end-to-end.

### 4. Runtime anti-tamper mirrors the registry gate

The loader validates every entry before any evaluation: an enabled entry without BOTH `policy_id` and `thresholds_source` **throws**; an action outside the vocabulary **throws** (a typo'd `halt` would silently misroute a triggered criterion); a predicate that fails `parsePredicate` **throws**. Registry check (c) runs at validate-time on every commit — these guards run at load-time on every evaluation, so a hand-edited registry file cannot become a silently-skipped or silently-misrouted criterion between commits.

### 5. No schema change, no new evidence vars

No migration. Predicates read only the 0018-seeded risk vars (`risk.covenants_breached`, `risk.partner_candidates_active`, `risk.partner_dependency_risk`); future criteria need their vars to exist first, per the registry README's "do not invent predicates" rule.

## Policy-Impact Analysis (procedures/** modified — registry JSONs)

- **YAML untouched.** The two procedure `schema.yaml` files' `kill_criteria` declarations are unchanged; the registry JSONs are the executable layer of record and the flip is what ADR-0055's own notes prescribed as the activation path.
- **Additive only, in the safe direction.** One new halt path (deliberately over-inclusive per D-M-RISK-2's evidence limits) and one mark_conditional path; nothing is weakened, narrowed, or removed. Graded rules (`risk-dd-covenant-*`, `risk-dd-partner-sourcing`) are untouched — the kill paths run alongside them per D-M-RISK-3.
- **`project_policy_pin`:** pins pin policy versions at project start; this activation applies **prospectively** — a project evaluates kill criteria under the registry state at evaluation time. No in-flight project is affected today: the evaluator has no production consumer yet (Decision 1), so activation changes what *can* be evaluated, not what *is*.
- **Baseline:** unchanged at 2 — no re-baseline, no executable-count change.

## Consequences

- `bun test` 790 pass (13 new in `tests/unit/kill-criteria.test.ts`): covenant halt fires on a breached test of the latest simulation and is determinately false at present-0; partner mark_conditional fires on the D-M-RISK-3 conjunction, is false with two active candidates or a determinate non-high dependency, and UNASSESSED when no deal-structure hypothesis is recorded; fill-once idempotence; assess-first composition; load-time anchor/action/predicate guards.
- The remaining 21 registry entries stay inert with their existing warn — they activate the same way as these two: a predicate over existing evidence vars, both anchors, and (per this ADR's precedent) an ADR recording why the criterion is now machine-evaluable.
- The next consumer decision — where a triggered criterion is durably recorded and who routes on `halt` vs `mark_conditional` vs `escalate_to_risk_officer` in gate flow — is open and needs its own decision record when gate-flow wiring lands.
- ADR status hygiene in the same change: 0046 (PR-1/PR-2 landed), 0048 (PR-4/PR-5c), 0049 (PR-4/PR-9 = #89), and 0051 (PR-10 = #77) flip Proposed → Accepted; 0050 (errata) and 0052 (track coverage, PR-12+) correctly remain Proposed.
