# Pilot 010 — Affinity Equity Partners / Lotte Rental (Brown Field, Rental Car — BLOCKED)

**Case type**: Brown Field (M&A) — first pilot with an outright **prohibition** outcome (kill_criteria `halt`, not conditional approval of any shape); first pilot testing a **common-ownership/common-control** antitrust theory rather than a direct merger of the target entities
**Region**: Korea (KR)
**Run mode**: Manual (no system — Stage 3 pilot per ADR-0034)
**Case source**: researched per user instruction (2026-08-20) — rental car industry
**Status**: In progress — real deal was formally blocked; this pilot walks the process up to that outcome

## 0. Purpose and Scope

Same public-data-only constraint as prior pilots. Every prior pilot (001-009) ended in some form of approval — unconditional, behavioral remedy, or structural remedy. **None tested the antitrust-screening path's `halt` outcome for real.** This case is the first to do so, and it does so via a genuinely different mechanism than a direct target-to-target merger: the acquirer, a private equity sponsor, already controlled the #2 rental car operator and sought to acquire the #1 operator — the antitrust concern is **common ownership across two competing portfolio companies**, not a merger between the two competitors' own corporate entities.

## 1. Deal Facts and Industry Lineage (Real Public Facts)

### Prior deals in the same industry (context)

| Deal | Year | Facts |
|---|---|---|
| SK Networks / AJ Rentcar | 2019 | SK Networks acquired 42.24% (9,353,660 shares) of AJ Rentcar for KRW 300 billion from AJ Networks and related parties. Merged with SK Networks' own rental division 2020-01-01 to form the unified "SK Rentcar" — no antitrust controversy publicly reported. |
| Affinity Equity Partners / SK Rentcar | 2024 | SK Networks sold 100% of SK Rentcar (Korea's #2 rental car operator) to Affinity Equity Partners for KRW 820 billion, completed 2024-08. Real competitive bid process: Affinity, IMM Private Equity, and Glenwood PE were shortlisted; Affinity won with the highest bid (initially proposed ~KRW 850B, final board-approved figure KRW 820B). This was Affinity's first Korean buyout in 3 years. |
| **Affinity Equity Partners / Lotte Rental** | 2026 (per the deal's regulatory timeline) | Affinity, having already acquired SK Rentcar (#2), signed a definitive agreement (~2025-03) to acquire 63.5% of Lotte Rental (Korea's **#1** rental car operator) from Lotte Group entities, and filed for KFTC merger review. |

### The blocked deal — KFTC decision (2026-01-26)

| Field | Value |
|---|---|
| Regulatory decision | Korea Fair Trade Commission — **prohibition** (기업결합 불허), announced 2026-01-26 |
| Real substance of the combination | Not a direct merger of Lotte Rental and SK Rentcar as corporate entities — both would come under the **common control of the same PE sponsor** (Affinity), which the FTC treated as the substantive combination for review purposes |
| Market definition | Two separately defined and separately reviewed markets: **short-term rental** (rental period < 1 year) and **long-term rental** (rental period ≥ 1 year); short-term further split geographically into inland Korea and Jeju |
| Market shares (2024 year-end, post-hypothetical-combination) | Short-term inland: 29.3% combined; short-term Jeju: 21.3% combined; long-term: 38.3% combined — Lotte Rental and SK Rentcar were the #1 and #2 players in every one of these segments |
| FTC's competitive-advantage reasoning | Lotte Rental and SK Rentcar were found to hold a durable structural advantage over smaller competitors on funding capacity, brand recognition, nationwide sales network, IT infrastructure, and integration with vehicle-maintenance and used-car-sales operations — such that "each other" was effectively each firm's only real competitive check, not the smaller operators |
| FTC's stated harm theory | The combination would harden the short-term market into "one dominant large player vs. many small operators," eliminating the closest real competitive constraint (the two large players checking each other) and creating a material price-increase risk |
| Long-term market-specific reasoning | Structural: leasing-finance regulation (여신전문금융업법) constrains how far a long-term-rental fleet can be scaled relative to leased vehicles, and end-of-term fleet disposal depends on used-car-sales networks — both factors reinforcing Lotte Rental/SK Rentcar's structural advantage in that segment specifically |
| PE-ownership factor | FTC explicitly stated the acquirer being a private-equity sponsor, rather than a strategic/operating acquirer, did **not** influence the review outcome — addressing a natural but incorrect hypothesis that PE ownership might be treated more leniently |
| Real second-order financial fallout | Hotel Lotte and Busan Lotte Hotel had separately planned to sell stakes worth ~KRW 980.5 billion and ~KRW 592.4 billion respectively, as part of financing arrangements connected to this transaction — the prohibition disrupted this unrelated capital-raising plan too, a real example of a blocked M&A having balance-sheet consequences beyond the deal itself |
| Market reaction (real) | Industry commentary described the outcome as more severe than expected — most observers anticipated a conditional approval given the share levels, not an outright prohibition |
| Related, separate precedent (context) | Hyundai Motor separately explored acquiring Lotte Rental and held informal pre-consultation with the KFTC, then withdrew before formal filing due to vertical-combination competitive concerns raised in that informal process — echoing a 2017 precedent where Hyundai's attempted acquisition of AJ Rentcar (SK Rentcar's predecessor) also collapsed, that time due to opposition from smaller/mid-size rental operators |

## 2. Walkthrough Against `procedures/_shared/brownfield-screening/schema.yaml`

| Step | Real-world check | Result |
|---|---|---|
| 2. Preliminary HHI screen | **Real and decisive**: with both parties already publicly known as the #1 and #2 national players and pre-existing common ownership of the #2 player already established, a preliminary screen using only public market-share reporting would very plausibly have flagged this as a `preliminary_hhi_flags_certain_block` case **before** DD, not just a high-concentration case requiring further review (contrast with pilot 008, which was high-concentration but resolved via a structural remedy rather than an outright block). | **Satisfiable, and this is the first pilot where the Screening-stage kill criteria condition itself (not just a DD-stage finding) would plausibly have fired for real — see §4 F-1.** |
| Kill Criteria: `preliminary_hhi_flags_certain_block` → escalate to risk-officer | This condition exists in the schema but had never been triggered by any prior pilot's real facts (pilots 001/002/008/009 were all high-concentration-but-resolvable or non-issues). This case is the first with market facts strong enough to plausibly trigger it at Screening, well before the DD-stage antitrust workstream would even begin. | **First real trigger case for this specific kill criteria condition — validates the condition was correctly specified, not dead code.** |

## 3. Walkthrough Against `brownfield-dd/schema.yaml` Step 3 (Antitrust) and `docs/rag-framework.md`

- **HHI/market definition (ma-01)**: real and unusually precise — the FTC's own multi-market segmentation (short-term inland / short-term Jeju / long-term) is a real, worked example of exactly the kind of careful market definition `antitrust-agent`'s `antitrust-screening` skill is meant to produce, more granular than any prior pilot's market definition.
- **Common-ownership theory (new)**: none of `checklists/ma-special-topics-checklist.yaml`'s items, nor `brownfield-dd`'s antitrust step description, explicitly names "common ownership under one financial sponsor across two competing portfolio companies" as a distinct antitrust theory from a direct target-to-target merger. This case's real substance was exactly that theory. See §4 F-2.
- **RAG framework, Regulatory/Permit dimension**: for the first time, this case would grade **Red**, not Amber — per `docs/rag-framework.md`'s priority-ordered overall rule, "any dimension Red" makes the overall grade Red regardless of the other five dimensions. This is the first pilot case that would actually exercise the framework's Red path rather than its Amber-capping behavior (pilots 001/002/008 all landed at Amber, since they involved remedies, not prohibitions).

## 4. Findings

| # | Finding | Type | Action |
|---|---|---|---|
| F-1 | This is the first pilot case where the Screening-stage kill criteria (`preliminary_hhi_flags_certain_block`) would plausibly have fired for real, before DD — confirming the condition is correctly specified and not merely theoretical. No schema change needed; this is a validation finding. | Positive — process validated at the Screening gate for the first time | None needed |
| F-2 | Neither `checklists/ma-special-topics-checklist.yaml` nor `brownfield-dd`'s antitrust step explicitly distinguishes "common ownership/control by the same financial sponsor across competing targets" from a direct merger of the targets themselves — this case's real substantive theory was the former, and the procedure text currently reads as if it assumes the latter. | Gap — checklist/procedure wording | Broaden `ma-01`'s wording and `brownfield-dd` step 3's description to explicitly name common-ownership/common-control combinations as a distinct antitrust fact pattern, not just direct mergers |
| F-3 | This is the first pilot case that would grade Red on the Regulatory/Permit dimension (not Amber) — confirms the RAG framework's priority-ordered Red rule is not just a theoretical possibility but fires correctly on a real fact pattern with real, extreme market-concentration data. | Positive — framework validated at its most severe grading path for the first time | None needed |
| F-4 | A blocked deal's real financial fallout extended beyond the deal itself — Lotte Group's separate, contingent hotel-stake-sale financing plans were disrupted by the prohibition. This is a real example of a Kill Criteria hit having consequences the procedure's own scope (this specific deal's review) doesn't capture — the disruption is a real-world signal that a Screening-stage or Pre-FS-stage flag of "material dependency of unrelated capital plans on this deal's approval" would have been useful early-warning information. | Gap — minor, informational | Consider whether `brownfield-pre-fs`'s deal-structure-hypothesis step should prompt for "dependent/contingent transactions" as a disclosure item — flagged, not applied here, since it is a narrow scenario |
| F-5 | Industry commentary that the outcome was "more severe than the share levels would suggest" is a real signal that qualitative factors (funding/brand/IT/vertical-integration advantage, per the FTC's own stated reasoning) can outweigh HHI numbers alone in a real regulatory decision — confirms `antitrust-screening` should weight qualitative competitive-advantage factors, not just numeric concentration, consistent with what the skill's design already intends but which no prior pilot's real facts required emphasizing this strongly. | Positive — validates existing skill design, no change needed | None needed |

## 5. Verdict

**Process partially executable, and the single most consequential real case in the pilot set to date** — the first pilot to reach an actual `halt`/prohibition outcome, the first to exercise the Screening-stage kill criteria for real, the first to grade Red rather than Amber, and the first to surface a genuinely new antitrust fact pattern (common ownership across portfolio companies) the checklist wording doesn't yet name. Not a failure under ADR-0034 — quite the opposite, this is exactly the class of finding a manual pilot exists to surface, and it required a real, extreme case to appear at all.

## 6. Cross-Pilot Update (001-010)

Ten real cases across nine industries (marine engines, heavy machinery, diversified conglomerate, semiconductors, biopharma, renewable energy, food-delivery platforms, retail/e-commerce, rental cars) have now been walked. The pattern holds without exception across all ten: every finding has been a real-case-surfaced scope gap, never a procedure logic error — and this pilot, specifically because it was the first case severe enough to reach an outright block, closed the pilot set's last major outcome-shape gap (no-remedy, behavioral remedy, structural remedy, and now prohibition are all represented with real cases).
