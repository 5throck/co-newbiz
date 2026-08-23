# ADR-0058: Kill-criteria evaluation record and the evidence_ref citation vocabulary

**Status**: Accepted
**Date**: 2026-08-23
**Deciders**: risk-officer (AI-1 owner), process-governance-manager, platform-lead, PM

## Context

ADR-0057 landed the kill-criteria evaluator (`db/lib/kill-criteria.ts`) and the first two activations, but deliberately left one decision open: the evaluator is **read-only**, and nothing records what a run's evaluation found. The §1 human-gate routing rule ("overall = RED if a Kill Criteria condition is triggered") cannot be audited until an evaluation leaves a durable trace — a triggered halt with no record is indistinguishable from an evaluation that never ran.

Separately, the 2026-08-22 design's Decision 2 carried a flagged debt: `requires_evidence_ref` was decoration while `evidence_ref` columns were format-free TEXT. A flagged, evidenced variable could be asserted with `"cim.pdf#p12"` — a citation only its author can find again. ADR-0046 records this exact failure mode for the flag itself; the same reasoning applies to the citation format.

## Decision

### 1. The evaluation record is a NEW run-scoped table — `kill_criteria_evaluation` (migration 0023)

ADR-0057 named two candidates and this ADR chooses **neither**:

- **Not `compliance_check`** — project-scoped with no run provenance, and its `rule_key` namespace feeds the six-validator newest-row-wins machinery (ADR-0048). Kill-criteria rows there would both misstate scope and collide with a reader that never asked for them.
- **Not `gate_pass_record`** — no such table exists; it is brownfield-dd step 15's procedure `output_type`. Gate-flow code will one day *read* the evaluation record when deciding a gate; conflating the decision record with its input would couple a future table to this one's shape before either has a consumer.

The new table is append-only and **complete-ledger**: one row per evaluated criterion in **all three outcomes** — `triggered` / `false` / `unassessed`. A recorded `false` is the auditable proof a criterion was evaluated and measured false; **absence of a row means never-evaluated, the only silent state, and it is unambiguous**. Inert entries (predicate null or `enabled=false`) get no rows — the ledger claims nothing about them; the `inert` count lives in the audit-log target string. Each row snapshots `predicate_json`, `action`, `policy_id`, and `thresholds_source` at evaluation time (ADR-0005 — a later registry edit cannot rewrite what a run was evaluated under). `UNIQUE (run_id, procedure_key, criterion_id)`; a second record for the same run+procedure throws, mirroring `fillSnapshot`.

The writer is `db/repositories/kill-criteria.repository.ts` (`recordKillCriteriaEvaluation`), guards before the transaction: run exists → run belongs to the project → no prior record (ADR-0005) → `evaluated_by` non-empty → FR-SEC-08 membership + FR-SEC-06 insider status. The write logs one `data_access_log` row and one `audit_log` row (`kill_criteria_evaluated`, target carrying the four counts, `:HALT-PATH` appended when anything triggered). An empty procedure (no enabled entries) records zero rows **and still writes the audit trail** — an evaluation that found nothing to evaluate is itself an audited act. Same landing posture as the evaluator: no production consumer yet; the future gate-flow step reads this table.

### 2. `evidence_ref` gets a citation vocabulary (v1.1 hardening) — `doc:` / `src:` / `https:`

`db/lib/evidence-ref.ts` exports the vocabulary and `isValidEvidenceRef`:

```
doc:<document-id>    — pointer at a `document`-table artifact
src:<md_source.code> — pointer at a registered source (e.g. src:KIS-2025)
https://<url>        — external citation (canonical scheme only; plain http rejected)
```

No whitespace anywhere; a citation is one token, not a sentence. **Not chosen**: a hard FK to `document` — that table is a content-addressed stub with no readers or seeds; an FK to an unused table would itself be decoration, the ADR-0046 failure mode. The `doc:` shape keeps the pointer honest today and makes a future FK tightening a data migration, not a convention break.

**Enforcement surface**: `dimension_input.assert()` for `requires_evidence_ref = 1` vars (presence was already enforced; format now too, after the registry/kind checks and before run scoping). Deliberately **out of scope**: the snapshot filler's computed `evidence_ref`s (machine provenance, not a human citation) and tables with no governed write path yet (`value_chain_link.evidence_ref` — its future repository adopts this validator). Existing test fixtures using free-text refs on flagged vars were updated to vocabulary shapes in the same change; flag=0 vars keep format-free refs.

## Policy-Impact Analysis (procedures/** NOT modified this time)

- **No procedure YAML, no registry JSON touched.** This ADR lands a schema table, a repository, and a write-path validation — the registry stays 23 declared / 2 executable / 2 enabled, baseline unchanged.
- **Recording is prospective.** A run's evaluation is recorded under the registry state at evaluation time (each row snapshots its anchors); `project_policy_pin` semantics are unaffected — no in-flight project has a recorded evaluation today (the recorder has no production consumer yet).
- **The v1.1 gate tightens a write path, not a policy.** No previously-accepted assertion is invalidated: the gate applies at assert time going forward; historical rows keep their free-text refs as-is (an audit of them is possible via the vocabulary check but was not demanded by any record).

## Consequences

- `bun test` 818 pass (28 new): `migration-0023.test.ts` (shape, outcome/action CHECK matrices, UNIQUE triple, FKs, recency index, idempotence), `kill-criteria.test.ts` recorder describes (complete ledger with anchors + predicate_json + both log rows; determinate-false recorded as `'false'`; second-record throw; read-only re-evaluate after record; empty procedure → zero rows + audit; non-member / MNPI non-insider / unknown run / cross-project / empty-actor guards), `evidence-ref.test.ts` (pure matrix), and `dimension-input-write.test.ts` vocabulary describes (three shapes accepted; free-text, bare-prefix, whitespace, plain-http rejected; flag=0 vars keep format-free refs).
- ADR-0057's named open decision (where a triggered criterion is durably recorded) is **resolved** by Decision 1 — and the gate-flow *reader* landed in the same repository's 1.1.0: `getRecordedEvaluation` groups the ledger into the gate-impact summary (`halt` / `mark_conditional` / `escalate_to_risk_officer` / `unassessed` / `evaluated_false`) with an explicit `never_evaluated` status (zero rows in the asked scope is never an empty-looking pass — ADR-0049 at read time). Facts only: the reader never blocks, grades, or resolves an unassessed criterion — gate approval stays human (non-negotiable boundary #2), and `skills/stage-gate-governance` documents the consumption step. No further decision record needed.
- The complete-ledger design means analytics can distinguish "evaluated and false" from "never evaluated" by row presence alone — no interpretation of timestamps needed.
- Future repositories with `evidence_ref` columns (value_chain_link first) should import `isValidEvidenceRef` rather than grow per-table formats; a v1.2 that adds shapes extends the vocabulary in one file.

