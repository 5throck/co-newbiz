# Pilot 009 — Emart (Shinsegae) / eBay Korea (Brown Field, Retail/E-Commerce)

**Case type**: Brown Field (M&A) — second consumer-industry pilot; first pilot with real, disclosed **acquirer-side balance-sheet impact** (debt/leverage change from the transaction)
**Region**: Korea (KR)
**Run mode**: Manual (no system — Stage 3 pilot per ADR-0034)
**Case source**: researched per user instruction (2026-08-20), consumer-industry coverage
**Status**: In progress

## 0. Purpose and Scope

Same public-data-only constraint as prior pilots. Chosen because this deal has an unusually complete real financial picture for both sides: the target's own audited-level operating metrics (GMV, revenue, operating profit — a rarity among all pilots to date, most of which had no target financial disclosure at all) **and** the acquirer's own disclosed balance-sheet impact (asset percentage, debt increase) — the first pilot where the Financial dimension has enough real data to approach (not fully reach) a grade.

## 1. Deal Facts (Real Public Facts)

| Field | Value |
|---|---|
| Acquirer | Emart (Shinsegae Group), via a purpose-built special-purpose company ("Emerald SPV") |
| Target | eBay Korea (operator of Gmarket, Auction, and G9) |
| Stake acquired | 80.01%, from eBay Inc. (US parent) |
| Deal value | KRW 3.4404 trillion |
| Completion | 2021-06-24 (agreement date) |
| Strategic rationale (disclosed) | Combine eBay Korea's online marketplace scale with SSG.com's (Emart's existing e-commerce arm) fulfillment-center know-how; committed to over KRW 1 trillion in online fulfillment-center investment over the following 4 years; explicit goal of an integrated online+offline "360 ecosystem" (Emart/Shinsegae Department Store offline + eBay Korea/SSG.com online) |
| Post-deal market position | Combined online retail share ~15% (eBay Korea 12% + SSG.com 3%), surpassing Coupang's disclosed 13% share, behind Naver's 18% |
| **Target financial performance (2020, pre-deal)** | GMV KRW 17.2 trillion (+6.2% YoY); revenue KRW 1.2 trillion (+13.8% YoY); operating profit KRW 85 billion (+38.2% YoY) — one of the only profitable major e-commerce operators in the Korean market at the time |
| **Acquirer balance-sheet impact (disclosed)** | Deal value represented 15.2% of Emart's total assets (KRW 22.3 trillion); Emart's total liabilities increased from KRW 11.8 trillion to KRW 16.2 trillion — the increase reflects both the KRW 3.44 trillion acquisition financing and the assumption of eBay Korea's own KRW 980 billion in liabilities |

## 2. Walkthrough Against `procedures/_shared/brownfield-fs/schema.yaml` and RAG Framework

| Step | Real-world check | Result |
|---|---|---|
| QoE / normalized EBITDA (FS step 1) | **The strongest real target-financial-disclosure match of any pilot to date** — GMV, revenue, and operating profit with YoY growth rates are all public, which is closer to what a QoE exercise actually needs than any prior pilot's target (pilots 001/002/006 had no target-level financials at this granularity; pilot 002 only had post-deal acquirer-side performance). Still not a full QoE (no normalization adjustments, working-capital detail, or one-time-item breakdown disclosed), but materially closer than any prior case. | **Partially satisfiable — the closest any pilot has come to real QoE-relevant data.** |
| Full valuation / DSCR-relevant leverage impact | **New territory for the RAG framework's Financial dimension**: `docs/rag-framework.md` §2 requires DSCR ≥ 1.3x under a downside scenario for a Green financial grade. This is the first pilot with a real, disclosed **acquirer-side leverage change** (KRW 11.8T → 16.2T total liabilities) to even approach that calculation — still missing the acquirer's EBITDA/interest-coverage figures needed to compute an actual DSCR, but for the first time the debt-side of the ratio is real, not absent entirely. | **Partially satisfiable — closer than any prior pilot, still not complete (no coverage-side figures).** |
| Six-way M&A cross-check start (antitrust) | Real and moderate: combined ~15% of a market with three larger/comparable competitors (Naver 18%, Coupang 13%, and other players) — no antitrust conditions were publicly reported for this deal, consistent with a moderately-concentrated but non-dominant combination. | **Satisfiable — a real "no antitrust issue found" case, a third data point alongside pilot 002 (unconditional approval) and pilot 006 (zero overlap).** |

## 3. A Genuinely New Observation: SPC Acquisition Structure

Every prior Brown Field pilot involved a direct corporate acquirer. This deal was structured through a purpose-built special-purpose company ("Emerald SPV") — a real, common real-world structure the design's `deal_structure_hypothesis` step (Pre-FS) doesn't explicitly name as an option. This is a minor but real structural gap: the procedure's structure-hypothesis step should explicitly prompt for "direct acquisition vs. SPC/holdco vehicle," since the choice affects liability ring-fencing and financing structure in ways worth capturing at Pre-FS rather than discovering later.

## 4. Findings

| # | Finding | Type | Action |
|---|---|---|---|
| F-1 | This case has real target-level operating metrics (GMV/revenue/operating-profit with YoY growth) closer to QoE-relevant data than any prior pilot — confirms the QoE step is well-specified when the data exists; the gap in every prior pilot was data availability, not step design. | Positive — process validated with the best real data yet | None needed |
| F-2 | Real acquirer-side leverage impact (total liabilities KRW 11.8T → 16.2T) is disclosed for the first time across all pilots — still insufficient alone for a DSCR calculation (no coverage-side EBITDA/interest figures), but confirms that when both debt-side and coverage-side figures are eventually available in a future case, the Financial dimension's DSCR requirement is a computable, not just theoretical, check. | Positive — informs future pilot sourcing (a case with BOTH debt and coverage figures would be the next useful find) | Track as a sourcing note for a future pilot candidate |
| F-3 | The `brownfield-pre-fs` deal-structure-hypothesis step doesn't explicitly prompt for acquisition-vehicle choice (direct vs. SPC/holdco) — this case used a purpose-built SPC, a common real-world pattern the step should name. | Gap — minor procedure enhancement | Add "acquisition vehicle (direct / SPC / holdco)" as an explicit prompt in `brownfield-pre-fs` step 2's description |
| F-4 | This is the third distinct real antitrust outcome shape found in the pilot set (pilot 001: behavioral remedy; pilot 002/this case: no remedy needed; pilot 008: structural remedy) — confirms the antitrust-screening step correctly produces different outcomes across genuinely different concentration levels rather than defaulting to one pattern. | Positive — process validated across a third real outcome shape | None needed |

## 5. Verdict

**Process partially executable, with the richest real financial-disclosure match found in any pilot to date (target operating metrics, acquirer leverage impact) and one minor structural gap (F-3, acquisition-vehicle prompt).** Not a failure under ADR-0034. This pilot moves the Financial dimension closer to being testable with real numbers than any prior case, without yet completing it — the next useful sourcing target is a case disclosing both acquirer debt *and* coverage figures together.

## 6. Cross-Pilot Update (001-009)

Consumer-industry coverage (pilots 008, 009) added two new real outcome shapes not previously in the pilot set: a **structural antitrust remedy** (pilot 008) and the **richest real financial-disclosure case** to date (pilot 009). Across nine real cases spanning eight distinct industries (marine engines, heavy machinery, diversified conglomerate, semiconductors, biopharma, renewable energy, food-delivery platforms, retail/e-commerce), the pattern established since pilot 001 continues to hold without exception: **every finding has been a real-case-surfaced scope gap, never a procedure logic error.**
