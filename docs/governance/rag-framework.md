---
lang: ko
lang_reason: proper-noun
---

# RAG Scoring Framework — Detailed Rules

**Owner**: process-governance-manager (with financial-analyst, quant-methodologist, risk-officer)
**Design of record**: design v1.0 §4-2 / meeting M3 / ADR-0016
**Status**: Stage 3 draft — thresholds below are the meeting M3 decisions (D-M3-1 through D-M3-4), specified concretely enough to seed the future `rag_rule` table (Stage 5). Manual application starts now.

## 1. Six Dimensions

Financial, Market, Data Confidence, Regulatory/Permit, Technical/Execution, Risk. See `docs/governance/process-map.md` for where each dimension's inputs originate.

## 2. Financial Dimension Bands (D-M3-1)

| Grade | Condition |
|---|---|
| Green | IRR ≥ hurdle + 2.0pp **AND** DSCR ≥ 1.3x under the downside scenario |
| Amber | IRR ≥ hurdle, but below the Green band (either condition not met) |
| Red | IRR < hurdle in the base case |

Precondition: WACC/hurdle must be `assumption.kind = 'user'` (design §4-1) before this dimension can be scored — meeting M1 fixed this as a Pre-FS entry condition, so the sequencing already holds.

## 2.5. Regulatory/Permit Dimension — Structural vs. Behavioral Remedies

An antitrust or regulatory remedy is not a single grading pattern — two real, structurally different shapes have shown up in pilot cases, and they should be graded differently:

- **Behavioral remedy** (an ongoing compliance obligation — e.g. `docs/pilots/pilot-001-hd-hyundai-stx-heavy-industries.md`'s 3-year supply/pricing conditions): grade Amber **for the full duration of the obligation**. There is no discharge event partway through — the obligation is either still active (Amber) or expired (re-evaluate).
- **Structural remedy** (a one-time closing condition — e.g. `docs/pilots/pilot-008-delivery-hero-woowa-brothers.md`'s mandatory divestiture): grade Amber **while the condition is open** (real closing risk exists — e.g. a divestiture buyer search could fail), but re-gradable toward Green **once the condition is confirmed discharged**, since nothing remains to monitor post-discharge, unlike a behavioral remedy.

Do not apply one grading pattern to both shapes — a discharged structural remedy and a live behavioral remedy are not the same risk, even if both originated from a "conditional approval."

## 3. Data Confidence Dimension and Cap (D-M3-2, D-M3-3)

| Chain reliability grade | Data confidence grade |
|---|---|
| A | Green |
| B | Amber |
| C, or a staleness-gate violation | Red ("judgment withheld") |

**The overall RAG rule is priority-ordered, not a weighted average** (D-M3-3, this is the framework's single most load-bearing rule — see ADR-0016):

```
overall = RED   if any dimension is RED, OR a Kill Criteria condition is triggered
overall = GREEN if all six dimensions are GREEN (including data confidence)
overall = AMBER otherwise
```

Data confidence caps the ceiling structurally, since it is one of the six dimensions the Green rule requires — a Grade-B proxy chain (confidence = Amber) makes an all-Green outcome impossible regardless of the other five dimensions' strength.

## 4. Hysteresis (D-M3-4)

| Transition | Trigger |
|---|---|
| Promote Amber → Green | IRR ≥ hurdle + 2.0pp, sustained for one full run cycle (not a single day's fetch) |
| Demote Green → Amber | IRR < hurdle + 0.5pp |
| Minimum hold period | 7 days, measured against `run` timestamps — two manually re-triggered runs on the same calendar day do not satisfy the hold period |

## 5. Stage-Gate Threshold Applicability

Per design §4-2, thresholds are declared per `stage_gate` — the bands above apply from FS onward, once a full financial model exists. Screening and Pre-FS use a reduced check (financial dimension is Amber-capped by default pending a completed model; the other five dimensions score normally).

## 5-1. Stage-Gate Threshold Applicability — Market Dimension (Decision 6, draft)

The `market` dimension's **evidence layer has landed** (migration 0017, PR-6): the `project_variable_snapshot` table, the first scoring-var seeds (9 market / right-to-win vars + `market.link_fit_quality`), and five `market-dd-*` rule rows staged `enabled=0` with `_threshold_placeholder` scalars — the anti-tamper skeleton the thresholds meeting fills in. **The thresholds meeting has now happened**: the approved record `docs/decisions/market-thresholds.md` (2026-08-23) owns every number, the fillers, the `switching_cost_grade` CHECK enum (landed by migration 0019), and `competitive_intensity`'s permanent ban as a standalone var; migration 0019 finalized all five staged rows in place and added the three record-mandated rows (the screening/pre-FS TAM-growth gate splits and `market-dd-right-to-win-absent`). **Activation has landed** (migration 0022, PR-9): the seven non-green market rows are `enabled=1` with `policy_id` + `thresholds_source` verbatim from the record, and `db/lib/rule-assessment.ts` grades them per run (§5-3); the green `market-dd-right-to-win` row alone stays `enabled=0` — the Decision 9 Green cap lifts only after calibration. This subsection documents the staged rule agreed in the design's Decision 6 (2026-08-22 RAG formalization design, §1.1), following the same pattern as §5's `financial` treatment.

| Stage gate | Rule |
|---|---|
| Screening | `market` is Amber-capped by default. Only `TAM` and `growth_rate` are evaluated, sourced from `fact_industry`. The other market axes (bargaining power, competitive intensity, switching cost, entry barriers, right-to-win) stay unassessed. |
| Pre-FS | `TAM`/`growth_rate` must be evidence-backed (not merely present — an `evidence_ref` is required, not just a non-null value). The full six-axis `value_chain_link` evidence is still not expected at this stage. |
| DD | The full six-axis `value_chain_link` evidence activates, and the Amber cap lifts. |

This mirrors the financial dimension's staged approach (§5): a dimension without a completed evidentiary base cannot produce a Green grade, but Amber/Red signal is still live where the available evidence supports it.

### Corrected evidence mapping (Decision 6)

The design's meeting review corrected a mapping error in the original plan (see the design doc's "뒤집힘 4"): `value_chain_link.concentration_hhi` measures upstream/downstream bargaining power (industry concentration in adjacent supply-chain tiers), not horizontal competitive intensity — the two can point in opposite directions, and conflating them silently mis-grades. The corrected mapping:

- `concentration_hhi` → `bargaining_power` (its original meaning), **not** `competitive_intensity`.
- `competitive_intensity` is a **new, still-unsourced** var — to be sourced from `fact_industry` convention or `dimension_input`, not from `concentration_hhi`.
- `switching_cost_grade` is a CHECK-constrained enum since migration 0019 (`negligible`\|`low`\|`moderate`\|`high`\|`very_high`, D-M-MKT-2), so an `in`-predicate over it is typo-safe; `substitution_threat` is CHECK-constrained since migration 0020 — the D-M-MKT-2 rider, a five-member ordinal mirroring `switching_cost_grade`'s members, landed as an implementation proposal (a repo-wide scan found no established vocabulary anywhere) and **ratified 2026-08-23** by `docs/decisions/substitution-threat-vocabulary.md` (chair: process-governance-manager). No rule reads the column yet; the first that does may cite that record as its vocabulary source.
- Vars sourced from `value_chain_link` require `r2 >= 0.6` (mirroring `gradeChain()`'s own reliability threshold) — below that, the var is excluded as low-confidence rather than treated as present. The missing-vs-low-confidence distinction now exists at schema level: `project_variable_snapshot.status` carries a fourth member `low_confidence` (migration 0017 — the design DDL sketched three statuses, but Decision 6's own text requires the distinction). The enforcement has landed: `db/lib/snapshot-filler.ts` (the filler PR) writes all 22 seeded scoring vars once per run per the records' var contracts — an arg-max link below r2 0.6 yields `low_confidence` for `market.bargaining_power_hhi` with the value kept, while `market.link_fit_quality` is written truthfully `present` even below the floor. The market rules are enabled since migration 0022 (PR-9) and evaluated per run by `db/lib/rule-assessment.ts` (§5-3).

## 5-2. Technical/Execution and Risk Dimensions — Staged Evidence Layer (PR-7)

The `technical_execution` and `risk` dimensions' **evidence layer has landed** (migration 0018, PR-7): 11 more `evidence_var` seeds — all `computed`, unlike market's asserted judgment vars, because every source is an existing table/column (`dd_finding`, `certification`, `permit`+`permit_edge`, `contingent_liability`, `covenant_test`, `partner_candidate`) — and eight `tech-dd-*` / `risk-dd-*` rule rows staged `enabled=0` (`technical_execution` ×4, `risk` ×4, per the risk agenda's Decision-8 axes: contingent liability in both agenda-sketched forms, covenant breach, partner-sourcing failure — the risk-officer kill-trigger the original mapping had entirely omitted). **The thresholds records have now landed**: `docs/decisions/technical-execution-thresholds.md` and `docs/decisions/risk-thresholds.md` (both 2026-08-23, replacing their `docs/decisions/open/` agendas), and migration 0019 finalized all eight staged rows in place to the records' mapping tables (CHECK enums on every vocabulary column included) plus added the three technical Red rows (`tech-dd-trl-pre-validation`, `tech-dd-ip-disputed`, `tech-dd-cert-load-bearing-loss` with the new `cert.load_bearing_non_transferable_on_coc` var). **Activation has landed** (migration 0022, PR-9): all 11 rows are `enabled=1` with `policy_id` + `thresholds_source` verbatim from the records, and `db/lib/rule-assessment.ts` grades them per run (§5-3).

Two boundary statements worth their own lines:

- **`antitrust_finding` is excluded from `risk` by premise** (risk agenda §2.1): it already feeds `regulatory_permit`, and counting one finding in two of the six dimensions would make the overall grade disproportionately sensitive to a single piece of evidence. Reversal requires a separate ADR, never a threshold decision.
- **No full gate ladder is documented for these dimensions yet** — deliberately. Market's §5-1 ladder exists because the design's Decision 6 decided it; for technical/risk, the 2026-08-23 records assign stage gates per rule (all technical rows `dd`; the risk partner-sourcing row restated `pre_fs`, D-M-RISK-7) rather than a screening→pre_fs→fs ladder, and per-gate missing-evidence treatment beyond the predicates' fail-closed `is_null` handling is still activation work (PR-9), not a settled ladder.

## 5-3. Rule Evaluation Path (PR-9 activation)

`db/lib/rule-assessment.ts` (`assessRulesForRun`) is the rule-evaluation consumer the staged layers waited on. Per run it:

1. fills the run's `project_variable_snapshot` (`snapshot-filler.ts` 1.1.0 — live `project_industry` bindings are the default fact-family industry set),
2. loads the stage gate's **enabled** rules (priority-ordered) and evaluates each `condition_expr` against the snapshot through the ADR-0046 predicate engine (Kleene semantics),
3. grades each dimension by **first-match-wins on priority** (D-M-RISK-5, pinned for PR-9): the dimension grade is the grade of the highest-priority TRUE rule — Red dominance is structural because Red rules carry lower priority numbers (D-M-RISK-4 layer 2, D-M-TE-8),
4. writes one `rag_assessment` row per **assessed** dimension — no rule TRUE and any rule UNASSESSED ⇒ the dimension is UNASSESSED and **no row is written** (a defaulted Amber is never persisted),
5. grades all-rules-determinately-FALSE as **Amber under the Decision 9 Green cap** — never Green pre-calibration, with the cap named in the persisted rationale.

The runtime guards mirror the migration-level ones: a green-graded rule winning a dimension **throws** instead of yielding Green (Decision 9 / D-M-MKT-11.2), and an enabled rule targeting a dimension outside market/technical_execution/risk throws rather than being silently skipped. `financial`/`data_confidence`/`regulatory_permit` keep their existing scorers (`rag-engine.ts`) — they are not predicate rules — and no overall row is composed here (ADR-0049 §2: an incomplete assessment renders no overall grade). Runs are immutable (ADR-0005): the snapshot composite PK makes grading the same run twice throw.

## 5-4. Kill-Criteria Evaluation Path (ADR-0057)

The kill-criteria registry now has its runtime consumer: `db/lib/kill-criteria.ts` (`evaluateKillCriteria`) evaluates a procedure's **enabled** registry entries against the run's `project_variable_snapshot` through the same ADR-0046 predicate engine as §5-3 (identical var coercion; fill-once composition, supported order assess-first-then-evaluate). Semantics per ADR-0057: TRUE ⇒ `triggered` with the entry's action; **UNASSESSED ⇒ listed in `unassessed`, the caller decides** — the ADR-0049 honesty rule applied to kill criteria (absence of evidence is not a clean bill, and no defaulted halt either); FALSE ⇒ determinately not triggered. Read-only — the §1 line above ("overall = RED if ... a Kill Criteria condition is triggered") stays a human-gate routing rule until gate-flow wiring consumes the evaluation record; that record now exists: `db/repositories/kill-criteria.repository.ts` (`recordKillCriteriaEvaluation`, ADR-0058 §1) persists the complete per-criterion ledger to `kill_criteria_evaluation` (migration 0023 — triggered/false/unassessed all recorded, anchors snapshotted; deliberately neither compliance_check nor gate_pass_record), and the gate-flow reader landed with it: `getRecordedEvaluation` (same repository, 1.1.0) groups the ledger into the gate-impact summary (`halt`/`mark_conditional`/`escalate_to_risk_officer`/`unassessed`/`evaluated_false`) with an explicit `never_evaluated` status — zero rows in the asked scope is never an empty-looking pass (ADR-0049 at read time). Facts only: whether a triggered criterion blocks the gate remains the human gate's call (non-negotiable boundary #2). The two ADR-0055 entries (covenant halt, D-M-RISK-2; partner mark_conditional, D-M-RISK-3) are enabled with `policy_id: gd-0022-risk-thresholds` — registry state 29 declared / 2 executable / 2 enabled (six ADR-0052 §A/§B deal-shape-chain and PMI entries joined inert 2026-08-23), load-time anti-tamper throwing on enabled-without-anchors.

## 6. Calibration (Stage 3 Follow-Up)

Action item A-3 from meeting M3: a calibration dry-run tests the bands above against 5-10 historical decisions before they are trusted for live gating. This runs once entity onboarding under `docs/planning/transition-plan.md` produces enough historical cases to calibrate against — tracked as a Stage 3 follow-up, not a blocker to using the bands manually in the interim (manual application lets a human sanity-check every grade before the calibration dataset exists).

**Two different calibration paths, not one** — `docs/pilots/pilot-004-sk-group-capital-rebalancing.md` finding F-1: the antitrust-screening-adjacent steps (RAG's Regulatory/Permit dimension, `brownfield-dd`'s antitrust step) can be backtested against real, public regulatory decisions — pilots 001-003 did exactly this. `group-investment-review`'s group-agenda-ranking step (step 4: IRR-over-hurdle spread + RAG grade + capital requested) **cannot** — its inputs are internal capital-allocation figures no group discloses at that granularity, publicly, ever. This step's calibration must wait for the team's own internal historical cases; there is no public-case substitute path for it, unlike the other steps.

## 7. Seed Data Shape (Stage 4/5 Forward Reference)

The rules above are written to be directly encodable once the `rag_rule` table exists (design §4-2 schema): each row here becomes a `(stage_gate, dimension, grade, condition_expr, priority)` tuple. No schema work happens in Stage 3 — this section exists so Stage 4's SRS can point back to a settled source rather than re-deriving the thresholds from meeting transcripts.

## 8. Related

- `docs/governance/process-map.md` — where RAG assessment sits in the stage-gate flow.
- `docs/manuals/business-manual.md` §3 — how a human reviewer should read a RAG grade.
- `memory/meeting-2026-08-20-m3-rag-criteria.md` — the source meeting and full discussion.
