---
name: rag-scoring-framework
scope: co-newbiz
description: >
  Applies the six-dimension RAG grading rule (Financial, Market, Data
  Confidence, Regulatory/Permit, Technical/Execution, Risk) — priority-
  ordered, never a weighted average (ADR-0016, D-M3-3): overall is RED if
  any dimension is RED or a Kill Criterion triggers, GREEN only if all six
  are GREEN, AMBER otherwise. Data confidence structurally caps the
  ceiling; hysteresis rules prevent single-day grade flapping.

  Use when: "RAG grade", "RAG scoring", "overall grade calculation",
  "hysteresis", "structural vs behavioral remedy grading".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: process-governance-manager
prerequisites:
  - proxy-industry-chain
metadata:
  type: process
  triggers:
    - RAG grade
    - RAG scoring
    - overall grade calculation
    - hysteresis
    - structural vs behavioral remedy grading

  procedure_keys:
    - entity-ic-review
relates_to:
  - skill: dd-to-valuation-bridge
    type: follows

---

## Context

`docs/rag-framework.md`'s single most load-bearing rule (D-M3-3): the
overall grade is priority-ordered, not averaged. A weighted average would
let five strong dimensions mathematically outweigh one RED dimension — the
priority-ordered rule refuses that outcome by design, since a RED dimension
represents a real problem no amount of other-dimension strength offsets.
The Regulatory/Permit dimension additionally requires distinguishing
structural remedies (one-time closing conditions, re-gradable toward Green
once confirmed discharged) from behavioral remedies (ongoing compliance
obligations, Amber for the obligation's full duration with no partial
discharge) — real pilot cases (pilot-001, pilot-008) validated both shapes
exist and must be graded differently.

## When to Use

- Any project at FS gate or later needs its RAG grade computed or updated
- Reviewing whether a grade transition (Amber↔Green) satisfies the hysteresis rule

## Execution Steps

1. **Score each of the six dimensions independently**:
   - Financial (D-M3-1 bands: Green requires IRR ≥ hurdle+2.0pp AND DSCR
     ≥1.3x under downside; precondition — WACC/hurdle must be `kind='user'`)
   - Market (`competitive-intelligence`/`historical-financial-analysis`/`peer-benchmarking` inputs)
   - Data Confidence (`proxy-industry-chain`'s chain-reliability grade:
     A→Green, B→Amber, C or staleness violation→Red)
   - Regulatory/Permit (classify structural vs. behavioral remedy shape
     before grading — do not apply one pattern to both)
   - Technical/Execution (`technical-due-diligence` findings)
   - Risk (`debt-and-contingent-liability-simulation`,
     `customer-attrition-risk` findings)
2. **Apply the priority-ordered overall rule**: RED if any dimension is RED
   or a Kill Criterion is triggered; GREEN only if all six are GREEN;
   AMBER otherwise — never compute a weighted average
3. **Apply hysteresis on any grade change**: Amber→Green promotion requires
   sustained IRR≥hurdle+2.0pp for one full run cycle (not a single fetch);
   Green→Amber demotion triggers at IRR<hurdle+0.5pp; minimum 7-day hold
   period measured against `run` timestamps — re-running twice on the same
   calendar day does not satisfy it
4. **Apply Screening/Pre-FS reduced check**: financial dimension defaults
   Amber-capped pending a completed model; the other five score normally
5. **Never render an overall grade without checking all six dimensions
   completed** — a partial assessment shows incomplete, not a default grade
   (`docs/ui-spec.md` §3's display contract, already implemented in the web UI)

## Output Format

- Per-dimension grade with rationale, overall grade (priority-ordered),
  hysteresis status for any transition

## Related Skills

- `proxy-industry-chain` — the data-confidence cap source
- `stage-gate-governance` — the Kill Criteria that override any RAG grade
- `dd-to-valuation-bridge` — a common source of Risk/Technical dimension findings
