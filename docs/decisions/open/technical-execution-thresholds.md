# Open Decision — Technical Execution Dimension Thresholds

**Status**: OPEN. Nothing on this page is decided.

> **What this file is**: this is the **agenda for a meeting that has not happened yet**. It records the
> candidate axes for the `technical_execution` dimension, the evidence that exists in the database today,
> and the structural shape a rule might take. It is **not** a rule file and carries no thresholds.
>
> The meeting must produce **named domain-agent participants and a dated decision record**, mirroring the
> `D-M3-1` .. `D-M3-4` precedent in `docs/rag-framework.md`. That record becomes the `thresholds_source`
> required by the `rag_rule` CHECK constraint before any rule may be set `enabled=1`.
>
> **Gate**: PR-9 (rule activation) MUST NOT proceed for `technical_execution` until this file is replaced by
> a dated decision record.

---

## 1. No numbers here, on purpose

`technical_execution` currently has no scoring function and no prose criteria anywhere in
`docs/rag-framework.md` — callers hand-write the grade into scenario JSON. That is exactly the condition in
which an invented threshold would harden into policy unnoticed. Where a number belongs, this file writes:

> **임계값 미정 — 다음 미팅에서 결정**

## 2. Evidence sources available today

| Source | Column(s) | State today |
|---|---|---|
| Technology maturity | `dd_finding.trl_grade` | **Unconstrained TEXT.** A CHECK enum is required first — `TRL1`..`TRL9` is the proposed vocabulary, itself subject to confirmation |
| IP clarity | `dd_finding.ip_ownership_status` | **Unconstrained TEXT.** Needs an enum before any `in` predicate can be trusted |
| Certification transferability | `certification.transferable_on_coc`, `certification.transferability_basis` | Arriving via the Decision 5 certification migration (5 new columns). `transferability_basis='inferred'` is hard-blocked at write time in the repository layer — it must never reach a rule |
| Permit critical path | `permit`, `permit_edge` | Available. `permit_edge` gives the dependency structure, so "critical path" is derivable rather than asserted |

**Shared prerequisite**: two of the four sources are unconstrained TEXT. Adding the CHECK enums is a
prerequisite for this meeting's output being implementable, not a follow-up. Without the constraint, an `in`
predicate that mis-spells a value fails to match **silently** and grades the project favourably.

---

## 3. Candidate axes

### 3.1 Technology maturity

- **Evidence**: `dd_finding.trl_grade`, once constrained to an enum (proposed `TRL1`..`TRL9`).
- **Proposed structure**:
  ```
  in(var=tech.trl_grade, values=[<low TRL members TBD>]) -> <grade TBD>
  ```
  or, if the enum is treated as ordinal:
  ```
  cmp(var=tech.trl_grade_ordinal, cmp=lt, value=<TBD>) -> <grade TBD>
  ```
- **Open**: (a) confirm `TRL1`..`TRL9` as the enum, (b) decide ordinal-vs-membership treatment — the
  predicate AST supports both but not interchangeably, (c) the cut itself:
  **임계값 미정 — 다음 미팅에서 결정**
- **Gate sensitivity**: TRL evidence originates in DD findings, so at Screening this var is structurally
  `unassessed`. The meeting should state which gate each threshold applies at rather than assuming DD.

### 3.2 IP clarity

- **Evidence**: `dd_finding.ip_ownership_status`, once constrained to an enum.
- **Proposed structure**:
  ```
  any_of[
    in(var=tech.ip_ownership_status, values=[<unfavourable members TBD>]),
    is_null(var=tech.ip_ownership_status)
  ] -> <grade TBD>
  ```
- **Note**: `is_null` vs. UNASSESSED are different things here. An absent IP finding at DD stage is itself a
  signal; an absent IP finding at Screening is merely not-yet-known. The meeting must decide whether
  missing IP status is graded or left `unassessed`, and that decision is gate-dependent.
- **Open**: the enum membership, which members are unfavourable, and the resulting grade. All
  **임계값 미정 — 다음 미팅에서 결정**

### 3.3 Certification and permit risk

Two related but distinct sub-axes; the meeting should decide whether they are one axis or two.

**(a) Certification transferability on change of control**

- **Evidence**: `certification.transferable_on_coc`, `certification.transferability_basis`.
- **Proposed structure**:
  ```
  count(var=cert.non_transferable_on_coc, cmp=gte, value=<TBD>) -> <grade TBD>
  ```
  possibly weighted by whether the certification is business-critical — which is *not* a field that exists
  today and would have to be added or asserted via `dimension_input`.
- **Hard constraint (not negotiable in the meeting)**: rows whose `transferability_basis` is `inferred` are
  blocked at write time. A rule must never be written that depends on inferred transferability, and must
  never treat "no row" as "transferable".
- **Open**: the count cut, whether criticality weighting is in scope, and how a certification with unknown
  transferability is treated. **임계값 미정 — 다음 미팅에서 결정**

**(b) Permit critical path**

- **Evidence**: `permit` plus `permit_edge` dependency structure.
- **Proposed structure**:
  ```
  any_of[
    cmp(var=permit.critical_path_duration, cmp=gt, value=<TBD>, unit=months),
    count(var=permit.unresolved_on_critical_path, cmp=gte, value=<TBD>)
  ] -> <grade TBD>
  ```
- **Overlap check required**: permits also feed the `regulatory_permit` dimension, which has its own scoring
  function today. The meeting must decide explicitly which aspect belongs where — `regulatory_permit` for
  *whether the permit can be obtained*, `technical_execution` for *whether the schedule survives obtaining
  it*, is one candidate split, but it is a proposal, not a decision. Double-counting the same fact across
  two dimensions inflates the overall grade's sensitivity to a single piece of evidence.
- **Open**: the duration cut, the count cut, and the boundary against `regulatory_permit`. All
  **임계값 미정 — 다음 미팅에서 결정**

---

## 4. Context the meeting must hold

- **Decision 9 Green cap (confirmed)**: uncalibrated `technical_execution` rules, once `enabled=1`, may emit
  **Amber or Red only — never Green** until calibration against 5–10 historical cases is complete. Setting a
  threshold here does not lift the cap.
- **Three-valued logic**: because most of this dimension's evidence only exists from DD onward, `UNASSESSED`
  is the normal state at earlier gates, not an error. Rule authors must confirm the intended Kleene outcome
  per operator rather than assuming "any missing var → UNASSESSED".
- **Prerequisite ordering**: the two CHECK enums (§2) land before rule authoring, not alongside it.

## 5. Decisions required from this meeting

1. Confirm the `trl_grade` enum (`TRL1`..`TRL9`?) and ordinal-vs-membership treatment.
2. Define the `ip_ownership_status` enum and which members are unfavourable.
3. Decide whether certification risk and permit risk are one axis or two.
4. Draw the boundary between `technical_execution` and `regulatory_permit` for permit evidence.
5. Decide the treatment of missing evidence per axis, per gate.
6. Every numeric threshold above.
7. Named participants and date, recorded in the `D-M3-*` style, to serve as `thresholds_source`.
