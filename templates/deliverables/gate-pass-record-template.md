---
governance_doc_id: tpl-gate-pass-record
layer: template
title: "Gate Pass Record Template"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: gate_pass_record
---

<!--
  output_type: gate_pass_record (procedures/_output-types.yaml) — "Stage-gate
  pass/fail record incl. the applicable Kill Criteria results". Produced at
  every gate transition under the stage-gate-governance skill (13 procedures
  reference it). TEMPLATE stays English (CLAUDE.md §4); deliverables
  produced from it are Korean per the language policy. [Bracketed] fields
  populate from the run record — never hand-type a result that isn't backed
  by a kill_criteria_evaluation row, a compliance_check row, or a recorded
  waiver. Evidence discipline (GAO-20-48G): credibility, objectivity,
  reliability, usefulness — every field below exists to make one of the
  four visible at the gate.
-->

# [Project Name] — Gate Pass Record

**Run ID**: [run_id] · **Procedure**: [procedure_key] v[procedure.version] · **Gate**: [gate] · **As of**: [as_of] · **Policy version**: [project_policy_pin]

## 1. Gate Decision

**Decision**: [ ] Go · [ ] Kill · [ ] Hold · [ ] Recycle  *(closed vocabulary — Hold/Recycle are expected outcomes for tech bets with immature evidence, not exceptions)*

**Rationale**: [2-3 sentences citing the driving evidence, not restating the decision]

## 2. Kill Criteria Results (3-number record)

**Declared [N_declared] / Applicable [N_applicable] / Completed [N_completed]** — from `getRecordedEvaluation` (ADR-0058); a `never_evaluated` scope is NOT clearance and must appear below.

| Criterion | Applicability | Result | Evidence (ADR-0058 ref) |
|---|---|---|---|
| [criterion_key] | applicable / not_applicable (reason) | pass / fail / never_evaluated | [doc:/src:/https: ref] |

**Unassessed criteria resolution**: each `never_evaluated` row carries the explicit human decision that resolved it (silence is never resolution).

## 3. Override Record (only if a Kill Criteria hit was overridden)

| Criterion | Triggering finding | Override decision | Group IC record |
|---|---|---|---|
| [criterion_key] | [finding + evidence ref] | [explicit decision text] | [record ref — a default/implicit override from inaction is invalid] |

## 4. Deliverable & Checklist Completeness

**Mandatory checklist items**: [M_completed] / [M_required] completed · **Active waivers**: [waiver refs or "none"]
*(compliance-monitoring's gate check result; an item is satisfied by completion or waiver, never by omission)*

## 5. Evidence Quality (GAO-20-48G)

- **Credibility**: [are the sources named and competent for the claim?]
- **Objectivity**: [reviewer independent of author where applicable — non-champion reviewer for technical evidence]
- **Reliability**: [verifiable refs; reproduced or reproducible under the run record]
- **Usefulness**: [does this record answer the gate question a reviewer will actually ask?]

## 6. Sign-off

| Role | Name/Key | Decision input acknowledged |
|---|---|---|
| [Recorder — agent key] | [key] | [scope of what was checked] |
| [Human authority — registry key, if this gate is human] | [key] | [signature surface: verified / could not verify / needs judgment] |
