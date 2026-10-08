# Pilot 008 Kill Mismatch — HHI Presumption Zone vs "Certain Block" (Wave B-3)

- Date: 2026-10-08
- Author: quant-methodologist (Wave B-3). Second-domain review owed: antitrust-agent, risk-officer.
- Status: **recommendation — needs a human ADR.** No rule, predicate or threshold was changed.
- Golden reference: `tests/eval/golden/cases/pilot-008.yaml`, S7 `kill_criteria` (`known_disagreement`, golden v1.1.0).

## 1. The mismatch

Wave B-2 found that the golden set expects **no** kill hit for pilot 008 at Screening, but the registry entry `procedures/_kill-criteria/brownfield-screening__preliminary_hhi_flags_certain_block.json` fires on the pre-decision fixture:

- Pre-deal shares: Baemin 55.7%, Yogiyo 33.5% (pilot-008 §1).
- Delta HHI = 2 × 55.7 × 33.5 ≈ 3,732. Post-merger HHI (lower bound, two listed players) = 89.2² ≈ 7,957.
- The predicate is `count(antitrust.presumption_screens_triggered) >= 1`. The var counts findings with HHI after > 1,800 and delta > 100 (ADR-0062). Pilot 008 is about 4× over the presumption line on HHI and 37× on delta.

## 2. Facts

| Source | What it says |
|---|---|
| Pilot 008 §1 | KFTC decision 2020-12-28: **conditional approval** with a structural remedy (divest Delivery Hero Korea / Yogiyo). |
| Pilot 010 §2 | Classes 008 (with 001, 002, 009) as "high-concentration-but-resolvable" and says the certain-block condition "had never been triggered" before 010. It says 010 would have been flagged "a `preliminary_hhi_flags_certain_block` case … not just a high-concentration case". |
| Pilot 010 §4 F-1 | Reads 010 as confirming "the condition is correctly specified" because it separates 010 from earlier cases. |
| ADR-0062 | Defines the var as the 2023 DOJ/FTC **structural presumption** zone. It cites practice that "automatic kill is reserved for structural-presumption territory **with no remedy path**". It keeps the action as `escalate_to_risk_officer`: "it does not auto-kill", and remedy-path existence is asked at the human gate. |
| Registry notes | Same: escalates, does not auto-kill; "remedy-path existence is asked there". |

## 3. Which is wrong

- **Fixture: correct.** The shares are the pilot doc's public figures and contain no outcome leakage.
- **Golden label: correct.** The labelled question is "does the screen flag a *certain block*?" On the facts, 008 was not blocked; a remedy cleared it. The pilot record says so explicitly.
- **Rule semantics: the open question.** The predicate tests a *rebuttable presumption* (concentration only), while the condition's name and the pilot record treat it as a *certain block* (presumption **and** no remedy path). A concentration-only test cannot separate 008 from 010. 008 is in fact more concentrated than 010 (010's largest combined segment share is 38.3%). So the claim in pilot 010 F-1, that the condition "is correctly specified", does not hold for the predicate as armed by ADR-0062. Under that predicate, 001, 002 and 009 may also fire once their per-party shares are put into fixtures.

The behaviour is not harmful: the action is escalation to a human, not a kill. But `evaluateRag` forces overall Red whenever its caller sets `killCriteriaTriggered` (FR-RAG-01), and the rule does not say whether an escalate-only hit counts. The eval harness (`scripts/eval/deterministic.ts`) treats any hit as triggered. So a presumption-only escalation would grade a remedy-resolvable deal Red at Screening. That conflicts with the pilot record (high but resolvable) and gives the calibration set a Red-on-favourable point by construction.

## 4. Recommendation (for a human ADR; not applied)

Choose one option and record it in an ADR that amends ADR-0062:

1. **Rename to match the predicate.** Rename the condition to something like `preliminary_hhi_in_presumption_zone`, keep `escalate_to_risk_officer`, and decide whether an escalation-only condition should force overall Red in the RAG engine. If not, it needs an action class that does not count as a kill hit. Then update the pilot 010 F-1 wording and relabel the golden 001/002/008/009 Screening kill expectations as hits.
2. **Make the predicate match the name.** Keep "certain block" and add a no-remedy-path conjunct, for example a human-recorded `antitrust.remedy_path_assessed_none`, so that the condition fires only on presumption **and** no viable remedy. The golden label stays `hits: []` for 008.
3. **Two tiers.** Combine both: a presumption-zone escalation (no forced Red) plus a certain-block kill (forced Red) that needs the remedy-path judgement.

The quant-methodologist preference is option 3, because it keeps the early tripwire ADR-0062 wanted without grading resolvable deals Red. The thresholds (1,800 / 100) are not in question.

## 5. Interim handling

- Golden v1.1.0 marks the 008 S7 `kill_criteria` expectation `known_disagreement` with a reference to this file. The `kill` suite reports it under "could not evaluate" and does not score it. The labelled answer (`hits: []`) is unchanged.
- When the ADR lands, remove `known_disagreement`. Under option 1, also relabel. Bump the golden `VERSION`.
