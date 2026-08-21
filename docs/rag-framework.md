# RAG Scoring Framework — Detailed Rules

**Owner**: process-governance-manager (with financial-analyst, quant-methodologist, risk-officer)
**Design of record**: design v1.0 §4-2 / meeting M3 / ADR-0016
**Status**: Stage 3 draft — thresholds below are the meeting M3 decisions (D-M3-1 through D-M3-4), specified concretely enough to seed the future `rag_rule` table (Stage 5). Manual application starts now.

## 1. Six Dimensions

Financial, Market, Data Confidence, Regulatory/Permit, Technical/Execution, Risk. See `docs/process-map.md` for where each dimension's inputs originate.

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

The `market` dimension is unformalized today (no scoring function exists — see the 2026-08-22 RAG formalization design, `docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md` §1.1). This subsection documents the staged rule agreed in that design's Decision 6, ahead of PR-6's implementation, following the same pattern as §5's `financial` treatment.

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
- `switching_cost_grade` / `substitution_threat` are currently unconstrained `TEXT` columns and need a `CHECK` constraint before they can be trusted by an `in`-predicate (an unconstrained column lets a typo silently fail to match, producing a false unassessed/mismatch).
- Vars sourced from `value_chain_link` require `r2 >= 0.6` (mirroring `gradeChain()`'s own reliability threshold) — below that, the var is excluded as low-confidence rather than treated as present. This distinction (missing vs. low-confidence) does not exist yet in the current implementation.

## 6. Calibration (Stage 3 Follow-Up)

Action item A-3 from meeting M3: a calibration dry-run tests the bands above against 5-10 historical decisions before they are trusted for live gating. This runs once entity onboarding under `docs/transition-plan.md` produces enough historical cases to calibrate against — tracked as a Stage 3 follow-up, not a blocker to using the bands manually in the interim (manual application lets a human sanity-check every grade before the calibration dataset exists).

**Two different calibration paths, not one** — `docs/pilots/pilot-004-sk-group-capital-rebalancing.md` finding F-1: the antitrust-screening-adjacent steps (RAG's Regulatory/Permit dimension, `brownfield-dd`'s antitrust step) can be backtested against real, public regulatory decisions — pilots 001-003 did exactly this. `group-investment-review`'s group-agenda-ranking step (step 4: IRR-over-hurdle spread + RAG grade + capital requested) **cannot** — its inputs are internal capital-allocation figures no group discloses at that granularity, publicly, ever. This step's calibration must wait for the team's own internal historical cases; there is no public-case substitute path for it, unlike the other steps.

## 7. Seed Data Shape (Stage 4/5 Forward Reference)

The rules above are written to be directly encodable once the `rag_rule` table exists (design §4-2 schema): each row here becomes a `(stage_gate, dimension, grade, condition_expr, priority)` tuple. No schema work happens in Stage 3 — this section exists so Stage 4's SRS can point back to a settled source rather than re-deriving the thresholds from meeting transcripts.

## 8. Related

- `docs/process-map.md` — where RAG assessment sits in the stage-gate flow.
- `docs/manuals/business-manual.md` §3 — how a human reviewer should read a RAG grade.
- `memory/meeting-2026-08-20-m3-rag-criteria.md` — the source meeting and full discussion.
