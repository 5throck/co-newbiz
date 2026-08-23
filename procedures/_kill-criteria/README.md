# Kill-Criteria Registry

Single inventory of every `kill_criteria` condition declared across
`procedures/**/schema.yaml`, per the RAG formalization design of record
(2026-08-22, Decision 8). The YAML declarations stay authoritative and
immutable; this registry records, per criterion, whether it is
**executable** (has a predicate) or **declared-but-inert**.

## Entry shape

One JSON file per declared criterion, named
`<procedure>__<criterion_id>.json` (the `criterion_id` is the YAML
`condition` string; conditions reused across procedures — e.g.
`wacc_hurdle_still_assumed` in both pre-FS procedures — get one entry per
procedure, so the file prefix disambiguates):

```json
{
  "procedure": "brownfield-dd",
  "criterion_id": "any_of_six_ma_validators_missing_at_dd_exit",
  "title": "Any of the six M&A validators missing at DD exit",
  "action": "halt",
  "predicate": null,
  "enabled": false,
  "policy_id": null,
  "thresholds_source": null,
  "notes": "declared in YAML, not yet executable — predicate null by design until thresholds are set (design Decision 8)"
}
```

- `predicate` — the executable form, using the same predicate AST type as
  `rag_rule.condition_expr` (`db/lib/predicate.ts`, PR-1). `null` means
  declared-but-inert: the criterion exists in governance prose but cannot
  be evaluated by machine yet. Predicates are added only when their
  evidence variables actually exist (do not invent predicates); the two
  risk entries activated by ADR-0057 are the current non-null exceptions.
- `action` — the action declared in the YAML (`halt` /
  `escalate_to_risk_officer` / `mark_conditional`), carried here for
  traceability; the YAML remains authoritative.
- `enabled` / `policy_id` / `thresholds_source` — the anti-tamper gate,
  mirroring `rag_rule`'s CHECK (migration 0012, design §5.2): enabling a
  criterion requires BOTH a governance anchor (`policy_id`) and a
  thresholds source. JSON has no CHECK constraints, so
  `procedures/_validate.ts` enforces it: an entry with `enabled: true` but
  a missing `policy_id` or `thresholds_source` is a validation **error** —
  and the runtime loader (below) rejects the same shape at evaluation time.

## What `_validate.ts` checks

- every YAML-declared criterion must have a registry entry (missing →
  error — this registry is the single inventory);
- every `predicate: null` entry → warn "declared-but-inert" (counted in
  the summary line);
- `enabled: true` without `policy_id` + `thresholds_source` → error
  (anti-tamper, meeting 2026-08-22 classification-practice #6c);
- a registry entry referencing a procedure/criterion that no YAML
  declares → error (orphan);
- `--strict`: executable count (non-null predicates / total) compared
  against `_baseline.json` — a drop below baseline **fails the gate**
  (risk-officer F7: ratio regressions must break the gate, not hide in a
  string); a rise passes with a reminder to bump the baseline. The
  baseline never auto-lowers; re-baseline consciously by editing
  `_baseline.json` in the same change that made the count drop.

## Runtime evaluation + activation convention (ADR-0057)

`db/lib/kill-criteria.ts` (`evaluateKillCriteria`) is the runtime consumer:
per run it loads the procedure's entries, validates every one (the same
anti-tamper gate as check (c) above, plus action-vocabulary and
predicate-parse guards — violations **throw**, never silently skip), and
evaluates the **enabled, predicate-carrying** entries against the run's
`project_variable_snapshot` through the ADR-0046 predicate engine — the
same engine and var coercion `rule-assessment.ts` uses, with
fill-once composition (supported order: assess first, then evaluate).
TRUE ⇒ `triggered` carrying the action; UNASSESSED ⇒ the criterion_id is
listed in `unassessed` and the caller decides — never a silent pass, never
a defaulted halt; FALSE ⇒ determinately not triggered. The evaluator itself
is read-only; the durable record lives one layer up —
`db/repositories/kill-criteria.repository.ts` (`recordKillCriteriaEvaluation`,
ADR-0058 §1) evaluates and persists the **complete ledger** to
`kill_criteria_evaluation` (migration 0023): one row per evaluated criterion
in all three outcomes — `triggered`/`false`/`unassessed` — each row
snapshotting its predicate, action, and both governance anchors
(ADR-0005); a second record for the same run+procedure throws. Row
absence means never-evaluated, the only silent state. The gate-flow
**reader** is `getRecordedEvaluation` in the same repository (1.1.0): a
member/MNPI-guarded, read-logged lookup that groups the ledger into the
gate-impact summary (`halt` / `mark_conditional` / `escalate_to_risk_officer`
/ `unassessed` / `evaluated_false`) with an explicit `never_evaluated`
status when the asked scope has zero rows — never an empty-looking pass.
Facts only: whether a triggered criterion blocks the gate stays the human
gate's call (non-negotiable boundary #2), and each recorded `unassessed` is
surfaced for the caller to decide.

**Activation convention**: an entry flips to `enabled: true` only when
(a) its predicate's evidence vars exist (the "do not invent predicates"
rule above) and (b) an ADR records why the criterion is now
machine-evaluable. ADR-0057 set the precedent, activating the two
ADR-0055 entries with `policy_id: gd-0022-risk-thresholds` — registry
state: 29 declared / 2 executable / 2 enabled (the three ADR-0052 §A.4
deal-shape-chain entries — partner_dd_red_ip_chain, partner_dd_red_financial_distress,
no_viable_deal_shape — and the three §B.4 pmi-integration-execution entries —
synergy_run_rate_uncertified_at_bau_handover, key_talent_attrition_above_threshold_at_90d,
clean_team_protocol_breach — joined 2026-08-23 as declared-but-inert; `no_viable_deal_shape`
carries recycle semantics in its notes under action `mark_conditional`, the
closest member of the action vocabulary).

## Related

- `procedures/_validate.ts` — enforcement
- `db/lib/kill-criteria.ts` — the runtime evaluator (ADR-0057)
- `db/repositories/kill-criteria.repository.ts` — the evaluation recorder (`recordKillCriteriaEvaluation`) + gate-flow reader (`getRecordedEvaluation`), `kill_criteria_evaluation` (ADR-0058 §1)
- `scripts/co-newbiz/proc-resolve.ts` — merged `kill_criteria` in resolved
  procedures (union semantics: shared list first, layer additions appended,
  deduped by condition — a layer can add criteria, never drop or weaken a
  shared one)
- `db/lib/predicate.ts` — the predicate AST an executable entry must use
- design of record:
  `docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md`
  (Decision 8, §5.2)
