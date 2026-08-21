# ADR-0048: Amend ADR-0037 — no-waiver scope becomes "applicable validators", with an auditable `not_applicable` result

**Status**: Proposed
**Date**: 2026-08-22
**Deciders**: compliance-officer, process-governance-manager, risk-officer

> **Supersedes [ADR-0037](0037-gate-blocking-rule-for-missing-mandatory-deliverables-or-che.md).** Proposed, not Accepted — takes effect when PR-4 (`compliance_check.result` enum extension) and PR-5c (completeness check) land. Until then ADR-0037 stands unamended and all six validators are required unconditionally.

## Context

ADR-0037 established that a gate blocks automatically when a required deliverable is missing or a mandatory checklist item is incomplete, unless an active non-expired waiver covers the specific gap. Six validators are designated no-waiver: no waiver can excuse them, at all, ever.

That rule was written before case classification existed. It reads "all six, always," which was correct when every project was implicitly an external Brown Field acquisition. ADR-0047 introduces a classification model under which some validators are genuinely inapplicable — antitrust screening against a project with no external counterparty, or quality-of-earnings normalization against an entity that does not yet exist. Applied literally, ADR-0037 forces those projects to either fabricate a deliverable or block permanently.

The dangerous repair is the obvious one. If a classification-derived skip is recorded as `compliance_check.result = 'pass'`, the audit record contains a **false statement** — "this validator was satisfied" — about a validator that was never run. That is strictly worse than the blocking it replaces, because it is indistinguishable after the fact from a validator that genuinely passed. And since the six validators are no-waiver precisely so that skipping them leaves an unmistakable trace, a silent `pass` would make classification a cheaper bypass than the waiver route ADR-0036 deliberately made expensive.

The governing principle: **a not-applicable determination must be at least as auditable as a waiver.** A waiver names an approver, an expiry, a scope, and a reason. A not-applicable determination must be no easier to obtain and no harder to find.

## Decision

### 1. The no-waiver scope narrows from "all six" to "all applicable ones"

ADR-0037's rule is amended to: a gate blocks automatically if a required deliverable is missing or a mandatory checklist item is incomplete, unless an active non-expired waiver covers the gap. The six designated validators remain **no-waiver** — no waiver may excuse any of them — but the set that must be satisfied at a given gate is the set **applicable to that project's classification**, determined by the `applies_when` predicate on each validator.

Everything else in ADR-0037 is carried forward unchanged, including its reverse-case obligation: a gate must not block on a missing *recommended* item, but must require a stated reason.

### 2. `compliance_check.result` gains `not_applicable`

```sql
-- compliance_check redefinition (additive or rebuild after confirming row count)
result TEXT NOT NULL CHECK (result IN
  ('pass','blocked','reason_required','waived','not_applicable'))
```

Never `pass`. A skipped validator is recorded as what it is.

### 3. Every skipped validator writes a row, and the row carries its own justification

One `compliance_check` row per skipped validator — not one summary row per project, and never an absence of rows. Each row's `detail` carries:

- the rendered Korean sentence of the `applies_when` predicate that excluded it (`renderKo`, per ADR-0046), so the reason is legible to a human reviewer without reading JSON;
- the `project_case_classification.id` of the live classification row it was derived from;
- that row's `classified_by`, and its `approved_by` where the classification was a narrowing write.

This is the three-part correspondence to a waiver: a stated reason, a traceable authority, and a specific scope. The classification row's own approval controls (ADR-0047 §1) supply the approver; the append-only classification history supplies the equivalent of a waiver's history and withdrawal path.

### 4. Completeness is three numbers, not a boolean

Six-validator completeness is recorded as **"6 declared / N applicable / M landed"**. A boolean cannot distinguish "all six ran" from "two ran and four were classified away," which is exactly the distinction an auditor needs. This extends to the six validators the principle already applied to kill-criteria, where declared-versus-executable counts are tracked rather than asserted.

The three numbers are exposed in the gate record and in `scripts/audit.ts` output, so a drift in N across the portfolio is visible without a bespoke query.

### 5. `not_applicable` rows are invalidated on reclassification

Because a `not_applicable` row derives its justification from a specific classification row, superseding that classification invalidates every `not_applicable` row that cited it. The affected validators return to unevaluated and must be re-assessed under the new classification. A stale `not_applicable` surviving a reclassification would be a skip with no live justification behind it.

## Consequences

- **ADR-0037 is superseded by this ADR.** Future references to the gate-blocking rule should cite ADR-0048; ADR-0037 remains in the record as the prior state, not as current policy.
- Depends on ADR-0047 (the classification model that supplies applicability) and ADR-0046 (the predicate language `applies_when` is written in and the `renderKo` that makes the recorded reason human-legible).
- The `compliance_check` change must land in the same release as the code that writes `not_applicable` rows. An enum value with no writer is a latent inconsistency; a writer with no enum value fails at runtime.
- Test obligation: a skipped validator is recorded as `not_applicable` and **not** as `pass`; the row contains the rendered predicate sentence and the classification id; reclassification invalidates prior `not_applicable` rows; and under every classification-corruption scenario (no classification row, NULL, unknown enum value) a typical external Brown Field acquisition still requires all six.
- This narrowing is only as sound as the classification underneath it. ADR-0047's write asymmetry and append-only history are load-bearing for this ADR: if a narrowing classification could be written by one party without approval, this amendment would have reopened the bypass it was written to close.
