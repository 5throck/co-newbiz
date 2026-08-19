# Pilot 006 — Orion / LigaChem Bio (Brown Field, Cross-Industry Diversification)

**Case type**: Brown Field (M&A) — first pilot outside heavy industry/electronics; a food/confectionery conglomerate entering biopharma
**Region**: Korea (KR)
**Run mode**: Manual (no system — Stage 3 pilot per ADR-0034)
**Case source**: researched per user instruction (2026-08-20) to test a genuinely different industry
**Status**: In progress

## 0. Purpose and Scope

Same public-data-only constraint as prior pilots. Chosen specifically because it is **not adjacent-industry diversification** — Orion (confectionery/food) has essentially no value-chain relationship to LigaChem Bio (ADC biopharma R&D) — which tests whether the design's procedures assume some pre-existing industry linkage that this case genuinely lacks.

## 1. Deal Facts (Real Public Facts)

| Field | Value |
|---|---|
| Acquirer | Orion Corporation (confectionery/food conglomerate) |
| Target | LigaChem Bio (formerly LegoChem Biosciences), an antibody-drug conjugate (ADC) biopharma R&D company |
| Stake acquired (2024-03) | 25.73% |
| Deal value | KRW 548.5 billion |
| Structure | Mixed: third-party rights-issue subscription (7,963,283 new shares at KRW 59,000/share) + secondary purchase from the founder-CEO and president (1,400,000 shares at a KRW 56,186 base price) — 9,363,283 shares total |
| Target's pipeline | 4 ADC assets in clinical stage; cumulative global out-licensing deal value ~KRW 9 trillion |
| Completion | 2024-03-29 |
| Follow-on investment (2025) | Additional 3,915,321 shares (~KRW 125 billion) via subsidiary PAN ORION Corp., raising the stake to ~25.53% — target also secured ~KRW 1 trillion in combined development funding (national growth fund investment + ~KRW 450 billion existing cash) |
| Stated rationale | CEO publicly framed this as building "food and bio as dual core business pillars," citing demographic aging and rising health/longevity demand as the strategic driver — an explicit diversification thesis, not a synergy thesis |
| Prior group bio history | 2020 JV with Shandong Luokang Pharmaceutical (China); 2022 formation of Orion Biologics under Orion Holdings — this is Orion's third bio-sector move, not a first attempt |
| Real financial performance (as of 2024-12-05) | Stake value ~KRW 987.8 billion — an unrealized gain of ~KRW 439.3 billion (80.1% above acquisition price) |

## 2. Walkthrough Against `procedures/_shared/brownfield-pre-fs/schema.yaml` and `brownfield-fs/schema.yaml`

| Step | Real-world check | Result |
|---|---|---|
| Deal structure hypothesis (Pre-FS) | **Real and granular**, same class of detail as pilot 002 — a mixed primary (rights issue) + secondary (founder share purchase) structure with real per-share pricing. | **Satisfiable.** |
| WACC/hurdle IRR | Not public — same boundary as every prior pilot. | **Not executable.** |
| Certification transferability (Pre-FS) | **Genuinely different from every prior BF pilot**: this is not a change-of-control certification question (the target's regulatory pathway — clinical trial approvals, eventual drug approval — belongs to the drug candidates, not to corporate ownership, and doesn't transfer or lapse on a change of control the way an ISO/type-approval certification would). This case reveals that the procedure's certification-transferability step, as written, implicitly assumes an operational/manufacturing certification (the design's own worked examples: class-society type approval, IATF, CE/UL) — **a biopharma clinical-stage target has a structurally different certification/regulatory-approval shape** that this step doesn't fully anticipate. | **Gap found — see §4 F-1.** |
| QoE / normalized EBITDA (FS) | **Not meaningful for this target**: a clinical-stage biopharma company with a licensing-revenue (not product-revenue) model and ongoing R&D losses does not have an EBITDA to normalize in the way the step assumes — QoE analysis is built for an operating business with historical earnings, and this target's real value driver is pipeline/licensing potential, not current earnings. | **Gap found — see §4 F-2.** |
| Six-way M&A cross-check start (antitrust) | Real and clean: Orion (confectionery) and LigaChem Bio (ADC biopharma) have **zero product-market overlap** — no antitrust filing complexity is publicly reported for this deal, consistent with a pure diversification acquisition rather than a horizontal or even vertical combination. | **Satisfiable — the cleanest antitrust case of any pilot to date, precisely because there is no industry relationship at all.** |

## 3. Value-Chain-Linkage Analysis — A Genuinely Negative Finding

`market-intelligence-agent`'s `value-chain-linkage-analysis` skill (design §4-5) is built around six axes: demand-derivation elasticity, cost pass-through, bargaining power, cycle co-movement, vertical-integration pressure, substitution threat — all of which assume the target sits somewhere in the acquirer's own upstream/downstream chain. **This deal has no value chain linking food/confectionery to ADC biopharma at all.** Attempting to run this analysis on this case produces six null results, not six weak ones — this is structurally different from a weak-but-present linkage.

This is a real, useful boundary case: **not every Brown Field thesis is a value-chain move.** Some are pure-diversification bets (Orion's own stated rationale: demographic/health-trend exposure, unrelated to confectionery's own chain). The design's procedures should not force a value-chain-linkage analysis to produce a false-positive weak linkage just because the step exists — a "not applicable, this is a diversification thesis" outcome should be a first-class, explicitly allowed result, not an implicit failure of the analysis.

## 4. Findings

| # | Finding | Type | Action |
|---|---|---|---|
| F-1 | Certification-transferability step assumes an operational/manufacturing-type certification (class society, IATF, CE/UL — the design's own worked examples); a clinical-stage biopharma target's regulatory pathway (trial/drug approval tied to the asset, not the corporate entity) doesn't fit this shape. | Gap — procedure scope | Add a branch/note to `brownfield-pre-fs`/`brownfield-dd`'s certification step: for R&D-stage biopharma or similarly asset-tied-regulatory-pathway targets, substitute a "regulatory pathway and clinical-stage risk assessment" in place of change-of-control certification transferability |
| F-2 | QoE/normalized-EBITDA step assumes an operating business with historical earnings; a pre-revenue or licensing-revenue R&D target has no EBITDA to normalize. | Gap — procedure scope | Add an explicit alternate path in `brownfield-fs` for R&D/pipeline-value-driven targets — likely a pipeline-valuation or comparable-licensing-deal-value approach instead of QoE, flagged as Stage 4 SRS input alongside F-1 |
| F-3 | Value-chain-linkage analysis correctly produces a null (not weak) result for a genuine diversification thesis with no industry relationship — this should be treated as a valid, expected outcome, not a sign the analysis failed to find something. | Gap — documentation/expectation-setting, not logic | Note in `docs/value-chain-linkage.md` *(forward reference, not yet written — Stage 4)* that a null result across all six axes is a valid outcome for pure-diversification theses |
| F-4 | The antitrust-screening path produced the cleanest, most unambiguous result of any pilot — zero product-market overlap, no filing complexity — confirming the step correctly scales down its own complexity when a deal genuinely has none. | Positive — process validated | None needed |
| F-5 | Real financial performance (80.1% unrealized gain by year-end) was **not** used to infer a Financial-dimension RAG grade, same discipline as pilot 002's F-3 — confirming this restraint holds even for a second, unrelated real case with a similarly tempting number. | Positive — framework validated a second time | None needed |

## 5. Verdict

**Process partially executable, with two genuinely new and actionable scope gaps (F-1, F-2) that only a biopharma-target case could have surfaced** — every prior pilot's targets were operating industrial businesses with conventional certifications and historical EBITDA, so neither gap was visible until this pilot. Not a failure under ADR-0034. This case earns its place in the pilot set specifically by being industrially unrelated to every prior case.
