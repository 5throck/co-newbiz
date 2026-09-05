# Pilot 008 — Delivery Hero / Woowa Brothers (Baemin) (Brown Field, Food Delivery Platform)

**Case type**: Brown Field (M&A) — first pilot in consumer/platform services; first pilot with a **structural** (divestiture) antitrust remedy rather than behavioral or no remedy
**Region**: Korea (KR)
**Run mode**: Manual (no system — Stage 3 pilot per ADR-0034)
**Case source**: researched per user instruction (2026-08-20) — consumer-industry coverage was identified as thin across pilots 001-007
**Status**: In progress

## 0. Purpose and Scope

Same public-data-only constraint as prior pilots. Chosen specifically because Korea's food-delivery-platform market concentration case produced a **structural remedy** (forced divestiture of the acquirer's existing Korean business) — a materially different antitrust outcome shape from every prior pilot: pilot 001 got a 3-year behavioral remedy (supply obligations), pilot 002 got unconditional approval, and none tested a "you may acquire, but only if you sell something first" structural condition.

## 1. Deal Facts (Real Public Facts)

| Field | Value |
|---|---|
| Acquirer | Delivery Hero (Germany-headquartered food-delivery platform group) |
| Target | Woowa Brothers (operator of Baedal Minjok / "Baemin," Korea's largest food-delivery app) |
| Deal value | KRW 4.75 trillion |
| Regulatory decision | Korea Fair Trade Commission (공정거래위원회), conditional approval, 2020-12-28 |
| Pre-deal market shares (Korea food-delivery app market) | Baemin ~55.7%; Yogiyo (Delivery Hero's existing Korean operation) ~33.5% — combined would have approached ~90% concentration |
| Condition imposed | Delivery Hero permitted to acquire Woowa Brothers **only if** it divests its existing Korean operations — Delivery Hero Korea, operator of Yogiyo and Baedaltong — to an unrelated third party |
| Effect of the remedy | Reduced Delivery Hero's realized market-share gain from the combination to ~22.2 percentage points, rather than capturing the full combined ~89% |
| FTC's stated rationale | Chairperson Cho Seong-wook: the combination's stated purpose was for Delivery Hero's logistics/technology capability and Woowa Brothers' marketing capability to generate synergy, not to create a monopoly — if that framing was accurate, Delivery Hero should accept the divestiture condition, since it doesn't need Yogiyo to realize the stated synergy |
| Sequence | Acquisition of Woowa Brothers completed ~March 2021 following FTC approval; Yogiwo/Delivery Hero Korea divestiture proceeded as a separate, subsequent transaction |
| Eventual divestiture outcome | Yogiyo (Delivery Hero Korea) sold to a consortium including GS Retail |

## 2. Walkthrough Against `procedures/_shared/brownfield-dd/schema.yaml` Step 3 (Antitrust) and `entity-ic-review`

| Step | Real-world check | Result |
|---|---|---|
| HHI/HHI-delta calculation (ma-01) | **Real and extreme**: pre-deal shares (55.7% + 33.5%) show this is the highest-concentration real case found across all pilots — far beyond pilot 001's ~70-80% engine-parts share. | **Satisfiable — the clearest HHI-relevant real case yet.** |
| Multi-jurisdiction filing (ma-02) | Single jurisdiction (Korea) — Delivery Hero is foreign-headquartered but the relevant market and remedy are Korea-specific; no multi-jurisdiction complexity disclosed for this specific combination. | **Satisfiable, single-jurisdiction case (same shape as pilot 001, contrast to pilot 002's multi-jurisdiction case).** |
| Gun-jumping (ma-03) | No public evidence of pre-clearance integration; sequence (MOU → FTC review → conditional approval → completion → separate divestiture process) is normal. | **Satisfiable.** |
| Remedy type and structure — **not previously tested** | **This is the first pilot to encounter a structural remedy.** Every procedure step referencing antitrust remedies (`brownfield-dd` step 3's description, `docs/governance/rag-framework.md`'s Regulatory/Permit dimension) was written and validated (pilots 001, 002) against **behavioral** remedies (ongoing supply/pricing obligations) or no remedy. A structural remedy (mandatory divestiture as a condition of closing) has different implications: it is a one-time, closing-condition action rather than an ongoing compliance obligation, and it directly reduces the deal's realized synergy/scope rather than constraining post-closing conduct. | **Gap found — see §4 F-1.** |

## 3. Illustrative RAG Assessment — Regulatory/Permit Dimension, Structural-Remedy Case

Per `docs/governance/rag-framework.md`, the Regulatory/Permit dimension for pilot 001 (behavioral remedy) was graded Amber — "conditional approval obtained, but with ongoing obligations, not a clean pass." Applying the same logic to a structural remedy raises a real question this pilot surfaces: **is a structural remedy, once satisfied at closing, actually a cleaner post-closing state than an ongoing behavioral remedy** (nothing left to monitor after divestiture completes), even though the underlying antitrust concern was more severe (near-90% concentration vs. pilot 001's ~70-80%)? A grading rule that only looks at "was there a remedy" without distinguishing structural-and-discharged from behavioral-and-ongoing would treat these differently-shaped risks the same way.

**Illustrative grade**: Amber during the period between conditional approval and completed divestiture (open condition, real closing risk if divestiture buyer search fails); arguably re-gradable toward Green once divestiture is confirmed complete (structural condition discharged, no ongoing behavioral obligation) — a **two-phase grading pattern** none of the prior pilots' cases required, since pilot 001's behavioral remedy never "completes," it just continues for 3 years.

## 4. Findings

| # | Finding | Type | Action |
|---|---|---|---|
| F-1 | The antitrust-remedy-handling logic (implicit in `brownfield-dd` step 3 and `docs/governance/rag-framework.md`'s Regulatory/Permit grading) was only validated against behavioral remedies (pilot 001) and no remedy (pilot 002) — a structural (divestiture) remedy has a materially different shape: a discrete closing condition rather than an ongoing obligation, and its completion should plausibly re-grade the Regulatory/Permit dimension rather than leave it permanently capped the way an ongoing behavioral obligation would. | Gap — RAG framework nuance | Add to `docs/governance/rag-framework.md`: distinguish structural remedies (re-gradable on confirmed discharge) from behavioral remedies (capped for the obligation's full duration) as a documented sub-rule, informed by this case |
| F-2 | This is the highest real market-concentration case found across all pilots (pre-deal combined ~89%) — confirms the antitrust-screening steps scale correctly to an extreme case, not just moderate ones (pilots 001/003 were both materially lower concentration). | Positive — process validated at the high end of real concentration risk | None needed |
| F-3 | The FTC's own stated reasoning (if the stated synergy rationale is genuine, the divestiture condition shouldn't be costly to accept) is a real example of a regulator testing a deal's *stated* rationale against its *structural* implications — a useful real precedent for how `antitrust-agent` might frame a synergy-vs-market-power distinction in its own analysis, not just report the HHI number. | Positive — informs agent methodology, not a schema gap | None needed, informational |

## 5. Verdict

**Process partially executable, with the first real structural-remedy case found across all pilots, surfacing a genuine grading-model nuance (F-1) that no prior pilot's cases could have revealed.** Not a failure under ADR-0034 — every prior pilot's antitrust cases happened to be behavioral-remedy or no-remedy; this case's structural-remedy shape was simply unavailable in the pilot set until sourced specifically for consumer-industry coverage.
