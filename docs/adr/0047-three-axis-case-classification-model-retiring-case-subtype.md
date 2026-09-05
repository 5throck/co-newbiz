# ADR-0047: Three-axis case classification model (case_type × origin × technology_track), retiring `case_subtype`

**Status**: Accepted
**Date**: 2026-08-22 (Accepted 2026-08-23)
**Deciders**: process-governance-manager, compliance-officer, brownfield-agent, greenfield-agent, risk-officer

> **Accepted 2026-08-23.** The condition set at Proposal — PR-4 (classification infrastructure, PR #76) and PR-5 (classification routing, landed as 5a → 5b → 5c, PRs #79/#80/#81) — has landed. The §4 `project_policy_pin` backfill shipped as a precondition of PR-5 as required. PR-8 (skill graph hardening) completes §5's mirror-sweep obligation: the retired `case_subtype` token is now absent from all four copies (`skills/` + `.claude/` + `.gemini/` + `.agents/`), verified by `diff -rq` mirror parity and a zero-match grep over the operational trees.

## Context

`md_project` is a three-column stub with no case-type column at all. The distinction between Green Field and Brown Field, and the separate question of whether a deal originates inside or outside the group, are carried today only in prose and in one YAML string convention. The practical consequence is that an internal venture — a project with no external counterparty — passes through target long-listing, HHI antitrust pre-screening, and quality-of-earnings normalization, because nothing in the system knows it is not an acquisition.

**This decision supersedes an informal decision taken on 2026-08-20, which was never itself recorded as an ADR.** That decision treated R&BD as a Brown Field sub-type under a `case_subtype: rbd` string. Its actual record is `CHANGELOG.md:83` ("R&BD … treated as a **Brown Field sub-type** (`case_subtype: rbd`), not a new top-level review type alongside GF/BF, since its deal mechanics … are BF-shaped rather than GF site-selection-shaped") and `docs/architecture/srs.md:94` (the same user decision restated in the requirements). There is no ADR number to supersede, and this ADR does not assert one; the 2026-08-20 decision is cited here as prior art, and the two files above are its authoritative record.

The substance of that 2026-08-20 decision is preserved. R&BD is still not a third top-level case type. What changes is its representation: a single-string sub-type conflates a *deal-shape* fact with a *technology-track* fact, and it has no room for the origin question at all, so a `case_subtype` value can never answer "is there an external counterparty here." Four contributors reached this from different directions — governance (the sub-type is not a control surface), compliance (it cannot be approved, expired, or audited), brownfield (it collides with deal-structure vocabulary), greenfield (an internal greenfield venture has no sub-type to carry).

### Why the classification is a control, not a label

Four independent reviews converged on the same finding: a classification that skips validators is **a waiver with none of a waiver's controls**. A waiver (ADR-0036) carries an approver, an expiry, a history, and a withdrawal path. The originally proposed classification table carried an author column and nothing else — one `UPDATE` would achieve a waiver's effect without being one, and it would do so next to the six validators that ADR-0037 designates explicitly no-waiver. The design below exists to close that gap, and the write-authority asymmetry in §1 is its core.

### Why `origin` needs four values, not three

The proposed values were `internal` / `external` / `hybrid`, where `hybrid` meant a passive minority investment (pilot-014 shape). A **true bilateral joint venture** — two companies contributing technology on equal terms into a newly incorporated entity — fits none of them. It is not internal (there is a full external counterparty), not external (neither party is acquiring the other), and not the passive-minority `hybrid` (control is shared, not absent). Forcing it into `hybrid` puts two deals with *opposite* governance structures into the same bucket, and any validator-applicability rule keyed on that bucket is then wrong for one of them by construction. `joint` is added as a fourth value for this case.

## Decision

### 1. Classification is three orthogonal axes, and writes are asymmetric by authority

The axes are `case_type` × `origin` × `technology_track` — 2 × 4 × 2 = 16 cells, of which the 12 reachable combinations are enumerated in the design document's classification table.

Write authority is **asymmetric**, because the two directions have opposite risk:

- `origin = 'external'` — *widens* the validator set. Single-party write, `rationale` mandatory.
- `origin ∈ {'internal', 'hybrid', 'joint'}` — *narrows* the validator set. **Two-party approval mandatory**: `approver_role` at process-governance-manager authority or above, plus `approved_by` and `approved_at`. This is deliberately priced at no less than a waiver.

### 2. `project_case_classification` is append-only

```sql
CREATE TABLE project_case_classification (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  case_type TEXT NOT NULL CHECK (case_type IN ('greenfield','brownfield')),
  origin TEXT NOT NULL CHECK (origin IN ('internal','external','hybrid','joint')),
  technology_track TEXT NOT NULL DEFAULT 'none' CHECK (technology_track IN ('none','rbd')),
  classified_by TEXT NOT NULL,
  approver_role TEXT, approved_by TEXT, approved_at TEXT,
  classified_at TEXT NOT NULL,
  rationale TEXT NOT NULL,
  superseded_by TEXT REFERENCES project_case_classification(id)
);
CREATE UNIQUE INDEX idx_case_classification_live
  ON project_case_classification(project_id) WHERE superseded_by IS NULL;
```

Append-only with `superseded_by`, consistent with ADR-0012's treatment of the audit log: a reclassification writes a new row and supersedes the old one, so the sequence of classifications a project passed through is recoverable. A single mutable row would delete precisely the audit trail needed to detect a false skip. The approval columns are nullable at the SQL level and enforced conditionally in the application layer, since SQLite `CHECK` cannot express "required only when `origin` is a narrowing value" cleanly alongside the enum constraints.

### 3. `md_project` gains a stage-gate column

```sql
ALTER TABLE md_project ADD COLUMN current_stage_gate TEXT
  CHECK (current_stage_gate IS NULL OR current_stage_gate IN
    ('screening','pre_fs','fs','dd','entity_ic','group_ic'));
```

Without it, the rule "classification freezes at Screening" is unjudgeable by code — there is no column from which to read what stage a project is at. After FS entry, any change to `case_type` or `origin` requires the approval path in §1 *and* a `compliance_check` row recording the reason.

### 4. `project_policy_pin` backfill for in-flight and pre-existing projects — mandatory

**This section is a required part of this decision, not an implementation note.** Under ADR-0021, in-flight projects are pinned to the policy set in force when they started; a new mandatory classification is exactly the kind of policy change that pin exists to mediate.

Every project that exists before PR-5 lands is unclassified. If PR-5 ships with classification as a hard requirement and no backfill, **every one of them hard-blocks at its next gate** — including pilots 011, 012, 013, and 014, and any other project not yet classified. The backfill is therefore a precondition of PR-5, sequenced before the routing logic activates:

1. Enumerate every project with no live `project_case_classification` row.
2. For each, either write a classification row through the normal authority path in §1 — including two-party approval where `origin` is a narrowing value, with pilot-014 the known `hybrid` case — or record a `project_policy_pin` entry pinning it to the pre-classification policy set.
3. A pinned project is exempt from classification-derived routing until it is reclassified; it is **not** exempt from the six validators, which continue to apply in full under their pre-classification (all-applicable) reading.
4. The backfill's own output is auditable: the count of projects enumerated, classified, and pinned is recorded, so "we classified everything" is a number rather than an assertion.

Neither leaving projects unclassified nor auto-assigning them a default classification is acceptable. A default would be a narrowing write with no approver — the exact failure this ADR exists to prevent.

### 5. `case_subtype` is retired

`case_subtype` is removed as a concept. `case_subtype: rbd` becomes `technology_track = 'rbd'`, orthogonal to both `case_type` and `origin` — which is what the 2026-08-20 decision was reaching for and could not express, since an R&BD deal may be internal (an internal venture spin-off carve-out) or external (a technology acquisition or license-in) and the sub-type string cannot distinguish them.

Retirement covers **all four mirror copies** of the `case_subtype` logic — `skills/`, `.claude/`, `.gemini/`, and `.agents/` — not the canonical copy alone. A retired concept surviving in three unswept mirrors is a live concept.

### 6. Validator applicability is fact-based where the fact exists

Antitrust and HHI screening are **not** gated on `origin`. Gating them on `origin = 'internal'` disables them for a carve-out business unit regardless of whether that unit already competes in the external market — and a competing unit spun out and combined with a new partner may have *greater* antitrust exposure, not less. Applicability is instead keyed on an asserted fact, `target.has_external_market_presence`, which is orthogonal to `origin`. `origin = 'internal'` continues to exempt the target long-listing step alone. Quality-of-earnings is reduced to a lightweight-mandatory rather than skipped, since carve-out cost allocation and transfer pricing are themselves manipulable.

Cross-validation at DD close uses evidence that is generated **regardless of classification** (certifications, antitrust findings, change-of-control contract scans) as the primary signal. Comparing `origin` against `dd_finding.rbd_source` is demoted to a secondary signal, because it is blind in the case it most needs to catch: a project misclassified as internal skips the R&BD step, so no `rbd_source` row is ever written and there is nothing to compare against.

A cross-validation mismatch blocks **conditionally**, not always: it blocks where the original classification's `rationale` and evidence were thin, and produces a non-blocking correction (reclassify, and trigger re-execution of the steps that were skipped) where a well-founded initial classification was honestly overturned by DD. Diligence disproving a hypothesis is the process working, not a violation of it.

## Consequences

- Depends on ADR-0046: `applies_when` conditions, including `target.has_external_market_presence`, are predicates in that ADR's AST and resolve through its evidence registry.
- Paired with ADR-0048 (`compliance_check.result` gains `not_applicable`), without which a classification-derived skip would still be recorded as `pass` — a false statement in the audit record.
- The 12 reachable cells × validator-applicability matrix is an exhaustive test obligation in PR-5c, together with classification-corruption scenarios (no row, NULL, unknown enum value); in every one of those degraded states a typical M&A cell must still require all six validators.
- Highest residual risk in this work stream is PR-5c. The completeness check has **zero production callers today**, so this is not "making an existing control classification-aware" — it is building the control and making it classification-aware in one motion. Mitigation: land the unconditional version (all six always required) green against the pilot set first, then layer `applies_when` on top within the same PR, so the two steps are logically separable in the commit history even without a time gap.
- Pilots 011–014 are the first consumers of the §4 backfill and its de facto acceptance test.
- Cells 9 and 10 (pure internal venture) and the internal-origin incorporation / IP-transfer / TUPE steps have no procedure content yet; PR-10 owns that, and a separate meeting is warranted before it starts.
