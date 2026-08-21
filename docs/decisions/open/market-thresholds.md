# Open Decision — Market Dimension Thresholds

**Status**: OPEN. Nothing on this page is decided.

> **What this file is**: this is the **agenda for a meeting that has not happened yet**. It exists so that
> the meeting which fills in real `market` thresholds has a written starting point — the axes, the evidence
> that is actually available in the database today, and the structural shape of each proposed rule.
> It is **not** a rule file, not a spec, and not a source of truth for any grading logic.
>
> The meeting must produce **named domain-agent participants and a dated decision record**, mirroring the
> `D-M3-1` .. `D-M3-4` precedent (see `docs/rag-framework.md` §2–§4), which is how the `financial` and
> `data_confidence` thresholds were established. Output of that meeting becomes the `thresholds_source`
> value required by the `rag_rule` CHECK constraint before any rule may be set `enabled=1`.
>
> **Gate**: PR-9 (rule activation) MUST NOT proceed for the `market` dimension until this file is replaced
> by a dated decision record.

---

## 1. Why there are no numbers here

Every numeric threshold on this page is deliberately left blank. A placeholder number that looks plausible
is worse than an empty slot: it gets copied, it gets reviewed as if someone had chosen it, and it silently
becomes the de-facto policy. Where a number belongs, this file writes:

> **임계값 미정 — 다음 미팅에서 결정**

Do not fill these in outside the meeting.

## 2. Corrected evidence mapping (per Decision 6)

The earlier mapping was wrong on one point and thin on several others. The corrected mapping — which this
meeting inherits as its premise, not as something to re-litigate — is:

| Axis | Evidence source | State today |
|---|---|---|
| `market.bargaining_power_hhi` (upstream/downstream) | `value_chain_link.concentration_hhi` | Available. Used in its **original** meaning (adjacent-industry concentration), not as competitive intensity |
| `market.competitive_intensity` (horizontal) | **NEW var — currently unsourced.** Candidate sources: a `fact_industry` `metric_key` convention, or `dimension_input` assertion | **Blocked**: no source chosen. Must be settled in this meeting *before* thresholds |
| Customer lock-in | `switching_cost_grade` | Available, but the column is **unconstrained TEXT**. A CHECK constraint is required first — otherwise an `in` predicate silently mismatches on a typo |
| TAM / growth rate | `fact_industry` via `metric_key` convention | Available. The exact `metric_key` names are part of what this meeting must record |
| Entry barrier | `dimension_input` (human judgement) | Available. Judgement var — requires `evidence_ref` + `rationale` + cross-domain `reviewed_by` |
| Right-to-win | `dimension_input`, **decomposed into 3 vars**: `right_to_win.customer_overlap`, `right_to_win.tech_overlap`, `right_to_win.brand_transferability` | Available. Schema cost of the decomposition is zero |
| Regulatory | *(excluded)* | Handled by the `regulatory_permit` dimension. Not a `market` axis — including it would double-count |

**Low-confidence exclusion**: any var derived from `value_chain_link` must be excluded on low fit quality
using the same criterion `gradeChain()` already applies, so that "low confidence" is distinguishable from
"missing". The exact cutoff is **임계값 미정 — 다음 미팅에서 결정**.

---

## 3. Axis-by-axis agenda

Each axis below states: the proposed predicate **structure** (shape only), what evidence exists today to
inform a real number, and the open questions the meeting must answer.

### 3.1 Bargaining power (upstream / downstream)

- **Evidence**: `value_chain_link.concentration_hhi`, one value per linked adjacent industry, plus the
  link's fit-quality measure.
- **Proposed structure**:
  ```
  all_of[
    cmp(var=market.bargaining_power_hhi, cmp=gte, value=<TBD>),
    cmp(var=value_chain_link.fit_quality, cmp=gte, value=<TBD>)
  ] -> <grade TBD>
  ```
- **Available today to inform a number**: the HHI values already stored for the pilot projects. There is no
  calibration set yet; the meeting should look at the actual distribution across pilots 011–014 before
  choosing a cut.
- **Open**: is bargaining power evaluated separately upstream vs. downstream, or as a worst-of? Threshold:
  **임계값 미정 — 다음 미팅에서 결정**

### 3.2 Competitive intensity (horizontal)

- **Evidence**: **none wired today.** This is the axis with the largest gap. Two candidate routes:
  1. a `fact_industry` `metric_key` convention (e.g. a top-N concentration or participant-count metric), or
  2. a `dimension_input` judgement var with mandatory `evidence_ref`.
- **Proposed structure** (this is the user's own worked example from the design session, reproduced here as
  the reference shape for what a real market demerit rule looks like):
  ```
  all_of[
    cmp(var=market.growth_rate,        cmp=lt,  value=<TBD>),
    in (var=market.entry_barrier,      values=[low]),
    cmp(var=market.top3_share,         cmp=gte, value=<TBD>)
  ] -> demerit
  ```
  i.e. *"low growth AND low entry barrier AND high top-3 concentration → demerit"*. Note this composite is
  what actually expresses competitive intensity, and that it spans three axes — the meeting should decide
  whether competitive intensity is a standalone var at all, or is *only* ever expressed as this composite.
- **Open (blocking)**: pick the source before picking numbers. Growth cut, `top3_share` cut, and the demerit
  grade are all **임계값 미정 — 다음 미팅에서 결정**.

### 3.3 Customer lock-in / switching cost

- **Evidence**: `switching_cost_grade`. Unconstrained TEXT today.
- **Prerequisite**: add a CHECK constraint enumerating the allowed grades. Until then an `in` predicate is
  unsafe — an unexpected value fails the match silently rather than erroring.
- **Proposed structure**:
  ```
  in(var=market.switching_cost_grade, values=[<enum members TBD>]) -> <grade TBD>
  ```
- **Open**: what is the enum? Which members are favourable? Both **임계값 미정 — 다음 미팅에서 결정**.

### 3.4 TAM and growth rate

- **Evidence**: `fact_industry`, addressed by `metric_key`. The convention for which `metric_key` values
  carry TAM and which carry growth rate must be recorded as part of the decision, not assumed.
- **Proposed structure**:
  ```
  any_of[
    cmp(var=market.tam,          cmp=lt, value=<TBD>, unit=krw),
    cmp(var=market.growth_rate,  cmp=lt, value=<TBD>, unit=ratio)
  ] -> <grade TBD>
  ```
- **Available today**: the `fact_industry` rows already loaded. This is the axis with the most real data and
  is therefore the most defensible one to calibrate first.
- **Open**: absolute TAM floor, growth-rate floor, and whether TAM is sector-relative rather than absolute.
  All **임계값 미정 — 다음 미팅에서 결정**.

### 3.5 Entry barrier

- **Evidence**: `dimension_input` — a human judgement, not a measurement.
- **Proposed structure**: `in(var=market.entry_barrier, values=[<TBD>])`, most usefully as one conjunct of
  the composite in §3.2 rather than standalone.
- **Open**: the ordinal vocabulary itself (how many levels, what they are called, what each means) is
  undecided. Because this is a judgement var it cannot reach scoring until `reviewed_by` (a different
  domain) is populated. Levels and cut: **임계값 미정 — 다음 미팅에서 결정**.

### 3.6 Right-to-win (3 decomposed vars)

- **Evidence**: three `dimension_input` vars — `right_to_win.customer_overlap`, `right_to_win.tech_overlap`,
  `right_to_win.brand_transferability`.
- **Proposed structure**: the decomposition exists precisely so that `at_least` becomes expressible:
  ```
  at_least(k=<TBD>, of=[
    cmp(var=right_to_win.customer_overlap,       cmp=gte, value=<TBD>),
    cmp(var=right_to_win.tech_overlap,           cmp=gte, value=<TBD>),
    cmp(var=right_to_win.brand_transferability,  cmp=gte, value=<TBD>)
  ]) -> <grade TBD>
  ```
- **Note for the meeting**: `at_least` interacts with three-valued logic — `at_least(k=2, [TRUE, TRUE, UNASSESSED])`
  is TRUE. Choosing `k` is therefore also a choice about how tolerant the rule is of missing evidence.
- **Open**: `k`, the per-var scale, and the per-var cuts. All **임계값 미정 — 다음 미팅에서 결정**.

---

## 4. Context the meeting must hold (not itself under discussion)

### 4.1 Staged reduced evaluation (Decision 6)

`market` is not evaluated at full breadth at every gate. The staged rule, to be written into
`docs/rag-framework.md` as a §5 sub-section, is:

| Gate | What is evaluated | Cap |
|---|---|---|
| Screening | TAM / growth rate only; all other axes remain `unassessed` | `market` capped at Amber by default |
| Pre-FS | TAM / growth rate sourced; the six axes still `unassessed` | Amber cap continues |
| DD | Full six axes, `value_chain_link` evidence active | Amber cap released |

This means a threshold chosen for DD is not automatically the threshold that fires at Screening. The meeting
should record, per axis, which gate the threshold applies at.

### 4.2 The Decision 9 Green cap

Confirmed by the user: once these rules are set `enabled=1`, uncalibrated `market` rules may emit **Amber or
Red only — never Green**, until calibration (re-running 5–10 historical cases) is complete. Because the
overall RAG rule already requires all six dimensions Green to produce Green, the cost of the cap is close to
zero while the useful Red signal survives intact. **Choosing a threshold in this meeting does not lift the
cap** — lifting it requires the separate calibration exercise.

---

## 5. Decisions required from this meeting

1. Source for `market.competitive_intensity` (blocking — pick before any number).
2. CHECK constraint enum for `switching_cost_grade`.
3. `metric_key` naming convention for TAM and growth rate in `fact_industry`.
4. Ordinal vocabulary for `entry_barrier` and for the three `right_to_win` vars.
5. Low-confidence exclusion cutoff for `value_chain_link`-derived vars.
6. Every numeric threshold above, per gate.
7. Named participants and date, recorded in the `D-M3-*` style, to serve as `thresholds_source`.
