---
title: RAG Outcome Calibration — Method
version: 1.0.0
date: 2026-10-08
owner: quant-methodologist
design: docs/designs/2026-10-08-wave-b-ai-eval-design.md (§7)
implementation: scripts/eval/calibration.ts (suite `calibration` in `bun run eval`)
tests: tests/unit/eval-calibration.test.ts
---

# RAG Outcome Calibration — Method

This method checks whether an overall RAG grade says something true about how a deal actually turned out. It is evidence for people. **It never retunes RAG weights, dimension rules, the data-confidence cap or kill criteria.** Any change to those goes through the policy path with an ADR (design §2, non-goals).

## 1. What is predicted, what is observed

| Item | Definition |
|---|---|
| Prediction | The overall RAG grade (`green` / `amber` / `red`) at a gate, from **pre-decision inputs only** (`inputs_ref`, leakage-linted). `post_decision` fixtures are never used. |
| Outcome label | `public_outcome.favourable` in the golden case. Favourable = closed or approved, including conditional approval. Unfavourable = prohibited, abandoned or suspended. Only pilots whose doc states a public outcome carry a label. |
| Excluded | A case with no label, a case whose pre-decision overall is `not_graded` (an incomplete assessment produces no grade; it is not defaulted to Amber), and any `post_decision` expectation. |

## 2. Grade-to-probability mapping (v1.0.0)

| Grade | Proposed P(favourable) |
|---|---|
| Green | 0.80 |
| Amber | 0.50 |
| Red | 0.20 |

The mapping is a stated prior, not a fitted curve. It lives in `GRADE_PROBABILITY` / `MAPPING_VERSION` in `scripts/eval/calibration.ts`. Changing it needs a version bump of this document and of the constant, with the reason recorded here. It must never be fitted to the labelled pilots: with n ≈ 1 a fit would only memorise the pilot.

## 3. With and without the data-confidence cap

The engine (`db/lib/rag-engine.ts`, ADR-0016) caps the overall grade at Amber when data confidence is not Green. To see whether the cap lowers overconfidence, every engine prediction is computed twice:

- **Capped**: the engine's grade of record.
- **Uncapped**: the same assessment with `data_confidence` treated as Green and the overall recomputed with `computeOverall`. A kill-criteria hit or any Red dimension still forces Red, and an incomplete assessment stays ungraded. Only the cap is removed.

Reported: Brier delta (capped − uncapped; negative means the cap helped) and the count of Green predictions on unfavourable outcomes in each variant.

## 4. Metrics

- **Brier score**: mean of (p − y)², with y = 1 for favourable. Lower is better. 0.25 is what a constant 0.5 forecast scores.
- **Reliability table**: one bin per grade. Columns are n, predicted probability, observed favourable rate, and a 95% bootstrap interval of the observed rate.
- **Bootstrap**: percentile bootstrap, 2,000 resamples with replacement, with a fixed-seed PRNG (mulberry32, seed 20261008). The same golden version therefore always gives the same intervals. With n = 1 the interval degenerates to a point. That is the honest answer, not a narrow interval.

## 5. Two tracks

| Track | Grade source | Why |
|---|---|---|
| Engine | `evaluateRag` on the pre-decision fixture, via the same input derivation as the `rag` suite | Calibrates the system as built. |
| Reference | The pre-decision `rag_overall` label in the golden case (the pilot record's own grade) | Calibrates the pilot-record reasoning while fixtures cannot yet drive the engine. |

## 6. Small-n limits (read this before any number)

- From pre-decision inputs, **only pilot 010** (Red, KFTC prohibition) has a gradable overall grade. So n = 1, and only on the reference track. Pilot 003 and 009 are labelled but `not_graded` at their gate. Pilot 008 has no pre-decision overall expectation.
- The engine track is n = 0 today. The pilot-010 fixture lists combined segment shares, not each party's share, so the HHI presumption screen and therefore the kill trigger cannot be derived. The engine honestly returns no overall grade.
- No Green or Amber bin has any data. The cap delta cannot be measured: no labelled case has a graded data-confidence dimension.
- Result at golden v1.1.0: reference Brier 0.040 (n = 1). **Insufficient for weight changes.** It shows only that one Red call matched one prohibition.
- Outcome labels are public and likely in model training data. That contamination does not touch the deterministic engine, but it limits any LLM-assisted grade.

## 7. Sourcing plan — growing the calibration set

Target before any calibration claim: at least 30 labelled, pre-decision-gradable cases, with at least 5 in each grade bin, and at least 10 that exercise the cap (data confidence graded below Green).

### 7.1 Pilots that need structured, engine-ready fixtures

| Pilot | Label | What the fixture lacks | Unblocks |
|---|---|---|---|
| 010 Affinity / Lotte Rental | prohibition | Per-party pre-deal shares per segment (`pre_deal_shares_pct` + `merging_parties`) from public market-share reporting dated before 2026-01-26 | Engine track n = 1 (kill trigger → Red) |
| 008 Delivery Hero / Woowa | conditional approval | A pre-decision S7 `rag_overall` label; financial (`irr`, `hurdle`, `dscrDownside`) is not public, so expect `not_graded` unless the kill trigger fires. See the known disagreement in `docs/audits/2026-10-08-pilot-008-hhi-presumption-vs-certain-block.md`. | A Red-on-favourable point, the case that tests the rule |
| 009 Emart / eBay Korea | closed | Market/risk grades and a chain grade, if the pilot record supports them | A second favourable point |
| 003 Doosan Bobcat / Robotics | suspended | Out of scope for six-dimension RAG (share-exchange restructuring); keep excluded | — |
| 001 HD Hyundai / STX, 002 Hanwha / HSD Engine | closed (doc mentions; not yet labelled) | An outcome label under design §3.3, and per-party shares for the HHI screen | Two favourable points |

Authoring follows the golden rules: cite the pilot doc, add no new numbers, bump `VERSION`, and get a second-domain review.

### 7.2 Public cases with a proxy chain (to exercise the cap)

The cap only matters when demand is estimated through a proxy chain (chain grade B or C). Candidates are public Korean component-maker deals or investments whose end market is measured upstream, with a known outcome:

- Marine-engine components → ship orders (CGT): crankshaft or engine-part suppliers. This is the design's reference chain (crankshaft → marine engine → ship).
- Automotive parts → vehicle production (units): parts-maker acquisitions with a KFTC or closing record.
- Secondary-battery materials → EV production or GWh capacity: materials-capacity investments that were later completed or abandoned.
- Semiconductor equipment and materials → fab capex: supplier investments around announced fab programmes (compare pilot 005).
- Wind-turbine components → installed MW: supply-chain investments tied to offshore wind programmes (compare pilot 007).

Each new case needs a written pilot doc first (public facts only, outcome dated after the inputs), then a golden case with `public_outcome`. The proxy-industry-chain skill assigns the chain grade, and a second-domain reviewer checks the grade before the case is labelled.

## 8. Governance

- The suite runs offline in `bun run eval`. It has no pass threshold, because a calibration number is not a regression gate.
- Results are reported in the scoreboard under "Suite: calibration" with this document's small-n statement.
- A finding that looks like it calls for a weight or rule change goes to process-governance-manager as a policy proposal with an ADR. It is never applied directly.
