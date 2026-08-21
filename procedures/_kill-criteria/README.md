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
  be evaluated by machine yet. All entries ship with `null` because
  `evidence_var` has no seeded rows — predicates are added only when their
  evidence variables actually exist (do not invent predicates).
- `action` — the action declared in the YAML (`halt` /
  `escalate_to_risk_officer` / `mark_conditional`), carried here for
  traceability; the YAML remains authoritative.
- `enabled` / `policy_id` / `thresholds_source` — the anti-tamper gate,
  mirroring `rag_rule`'s CHECK (migration 0012, design §5.2): enabling a
  criterion requires BOTH a governance anchor (`policy_id`) and a
  thresholds source. JSON has no CHECK constraints, so
  `procedures/_validate.ts` enforces it: an entry with `enabled: true` but
  a missing `policy_id` or `thresholds_source` is a validation **error**.

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

## Related

- `procedures/_validate.ts` — enforcement
- `scripts/co-newbiz/proc-resolve.ts` — merged `kill_criteria` in resolved
  procedures (union semantics: shared list first, layer additions appended,
  deduped by condition — a layer can add criteria, never drop or weaken a
  shared one)
- `db/lib/predicate.ts` — the predicate AST an executable entry must use
- design of record:
  `docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md`
  (Decision 8, §5.2)
