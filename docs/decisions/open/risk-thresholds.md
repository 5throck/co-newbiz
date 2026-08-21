# Open Decision — Risk Dimension Thresholds

**Status**: OPEN. Nothing on this page is decided.

> **What this file is**: this is the **agenda for a meeting that has not happened yet**. It lists the
> candidate axes for the `risk` dimension, the evidence available today, and the structural shape a rule
> might take. It is **not** a rule file and contains no thresholds.
>
> The meeting must produce **named domain-agent participants and a dated decision record**, mirroring the
> `D-M3-1` .. `D-M3-4` precedent in `docs/rag-framework.md`. That record becomes the `thresholds_source`
> required by the `rag_rule` CHECK constraint before any rule may be set `enabled=1`.
>
> **Gate**: PR-9 (rule activation) MUST NOT proceed for `risk` until this file is replaced by a dated
> decision record.

---

## 1. No numbers here, on purpose

Like `market` and `technical_execution`, the `risk` dimension has no scoring function today and no prose
criteria in `docs/rag-framework.md`. Where a number belongs, this file writes:

> **임계값 미정 — 다음 미팅에서 결정**

## 2. Evidence sources

| Source | Column(s) | Note |
|---|---|---|
| Contingent liabilities | `contingent_liability.probability`, `contingent_liability.amount_expected` | Two-factor: the meeting must decide whether the rule tests the product, the factors separately, or both |
| Covenant breach | `covenant_test.breached` | Boolean-shaped; the question is counting and recency, not magnitude |
| Partner-sourcing failure | `partner_candidate.status`, `partner_candidate.dependency_risk` (ADR-0031) | **Added late.** This was one of the risk-officer's own three kill-triggers and was entirely absent from the original mapping — its absence from the risk owner's own mandate is itself worth a line in the meeting record |

### 2.1 Explicitly excluded: `antitrust_finding`

`antitrust_finding` is **not** a `risk` evidence source. It already feeds the `regulatory_permit` dimension.
Including it here would double-count a single finding across two of the six dimensions, making the overall
grade disproportionately sensitive to one piece of evidence. This exclusion is a **premise of the meeting,
not an agenda item** — it follows directly from the Decision 4 / F19 finding. If someone wants it reversed,
that is a separate ADR, not a threshold decision.

---

## 3. Candidate axes

### 3.1 Contingent liability exposure

- **Evidence**: `contingent_liability.probability` × `contingent_liability.amount_expected`, aggregated
  across rows.
- **Proposed structures** (the meeting picks one; they are not equivalent):
  ```
  # (a) expected-value form — one large-but-unlikely item and many small-but-likely items score the same
  cmp(var=risk.contingent_expected_value, cmp=gte, value=<TBD>, unit=krw) -> <grade TBD>

  # (b) two-factor form — separates "big" from "likely"
  all_of[
    cmp(var=risk.contingent_max_amount, cmp=gte, value=<TBD>, unit=krw),
    cmp(var=risk.contingent_max_probability, cmp=gte, value=<TBD>, unit=ratio)
  ] -> <grade TBD>

  # (c) both, as separate rules at different priorities
  ```
- **Scale question**: an absolute KRW figure ages badly and does not travel across deal sizes. A ratio to
  deal value or to target EBITDA may be more durable. Which denominator (if any) is
  **임계값 미정 — 다음 미팅에서 결정**, as are all the cuts above.
- **Known debt**: monetary amounts are stored as `REAL` across this repository, a known and recorded
  violation. Threshold comparisons on money inherit that imprecision; the meeting should be aware of it
  when choosing boundary values, since exact-equality boundaries are not reliable.

### 3.2 Covenant breach

- **Evidence**: `covenant_test.breached`.
- **Proposed structure**:
  ```
  count(var=risk.covenants_breached, cmp=gte, value=<TBD>) -> <grade TBD>
  ```
  possibly qualified by recency or by covenant type:
  ```
  all_of[
    count(var=risk.covenants_breached_recent, cmp=gte, value=<TBD>),
    in(var=risk.covenant_type, values=[<TBD>])
  ] -> <grade TBD>
  ```
- **Open**: does a single breach suffice, or is it a count? Does a cured breach still count, and for how
  long? Is a financial covenant weighted differently from an affirmative one? Recency window and count:
  **임계값 미정 — 다음 미팅에서 결정**

### 3.3 Partner-sourcing failure (per Decision 8 / ADR-0031)

- **Evidence**: `partner_candidate.status` and `partner_candidate.dependency_risk`.
- **Why it is here**: the deal's viability can depend on a partner that has not been secured. This is a
  kill-trigger in the risk officer's own definition, yet it had no path into any `risk` rule.
- **Proposed structure**:
  ```
  all_of[
    count(var=risk.partner_candidates_active, cmp=lte, value=<TBD>),
    in (var=risk.partner_dependency_risk,     values=[<high members TBD>])
  ] -> <grade TBD>
  ```
  i.e. *"few or no viable partner candidates remaining AND the deal is highly partner-dependent"*. The
  conjunction matters: a thin candidate pool is only a risk where dependency is high.
- **Open**: (a) which `status` values count as "active/viable" — the enum needs confirming, (b) the
  vocabulary and cut for `dependency_risk`, (c) the candidate-count floor. All
  **임계값 미정 — 다음 미팅에서 결정**
- **Interaction with kill-criteria**: this same evidence may also drive a kill-criterion. The meeting should
  decide whether it is graded, kill-triggering, or both, and avoid a configuration where a project is graded
  Amber on a fact that should have stopped it outright.

---

## 4. Context the meeting must hold

- **Decision 9 Green cap (confirmed)**: uncalibrated `risk` rules, once `enabled=1`, may emit **Amber or Red
  only — never Green** until calibration against 5–10 historical cases is complete. Choosing thresholds here
  does not lift the cap.
- **Three-valued logic**: `all_of(FALSE, UNASSESSED)` is FALSE; `any_of(TRUE, UNASSESSED)` is TRUE. For a
  risk dimension the direction of leniency matters more than elsewhere — a rule that is accidentally lenient
  on missing evidence reproduces exactly the false-pass this whole effort exists to close. Each rule's
  behaviour under missing evidence should be stated explicitly in the decision record, not inferred.
- **`antitrust_finding` stays excluded** (§2.1).

## 5. Decisions required from this meeting

1. Contingent liability: expected-value form, two-factor form, or both — and the denominator, if any.
2. Covenant breach: count, recency window, and whether type matters.
3. Partner sourcing: confirm the `status` enum, the `dependency_risk` vocabulary, and the candidate floor.
4. For each axis: graded, kill-triggering, or both.
5. For each rule: the intended behaviour when evidence is missing.
6. Every numeric threshold above.
7. Named participants and date, recorded in the `D-M3-*` style, to serve as `thresholds_source`.
