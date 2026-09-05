---
lang: en
counterpart: dd-findings-quantification_ko.md
---

# Research Note — Quantification of DD Findings (QoE·Price Adjustment) Standard Practices

> 🌐 External reference material. Researched: 2026-09-05. For comparing industry practices behind the principle of making dd_finding.value_impact mandatory.

## Standard Practices

1. **Normalized EBITDA determines the price**: the final price is the multiple applied not to the
   seller-reported EBITDA but to the EBITDA adjusted through QoE (Quality of Earnings) — QoE is the
   largest workstream, accounting for roughly 30% of buy-side financial due diligence effort
   (Anders, CT Acquisitions)
2. **The adjustment mechanism is mechanical**: reconcile reported EBITDA line by line against audited/bank
   books → identify one-off·non-recurring items (litigation settlements, restructuring costs, owner
   personal expenses) → apply pro-forma adjustments for recent acquisitions and divestitures
3. **Price impact translates into concrete numbers**: e.g.) at a pre-adjustment EBITDA of $2.5M, a 7x
   multiple = a $17.5M offer; if QoE adjusts EBITDA to $2.0M, the deal is renegotiated to $14.0M even at
   the same multiple — this is why, in principle, every finding must be translated into a number rather
   than merely "noting the reason when a finding cannot be converted"
4. **Debt-like items are deducted separately from the multiple**: debt and debt-like items are deducted
   dollar-for-dollar from the price regardless of EBITDA multiple effects — this suggests that
   "finding → scenario reflection" can follow different paths depending on the nature of the item,
   not just a simple multiple multiplication
5. **Two-way verification is 2026 practice**: on deals with EBITDA above $5M, the seller's sell-side QoE
   and the buyer's confirmatory QoE are each performed and checked to converge within 10–15% — a large
   divergence is itself a negotiation item

## co-newbiz mapping

- The principle of making `dd_finding.value_impact` (KRW millions, ADR-0061) mandatory belongs to the same
  family as QoE's "finding → number" principle. This research supports that "recording a reason when a
  finding cannot be converted" is an exception path, not the default.
- Reflecting the adopted S8 Business Case scenarios (downside/base/upside) is a mechanism similar to QoE's
  pro-forma adjustments.

## Sources

- Anders CPA, "Quality of Earnings (QoE) Report: What It Is (and Why It Matters in M&A)" — https://anderscpa.com/learn/blog/quality-of-earnings-report-analysis-due-diligence-guide/ (accessed 2026-09-05)
- CT Acquisitions, "Financial Due Diligence: QoE, EBITDA, Working Capital" — https://ctacquisitions.com/financial-due-diligence-business-sale-2026/ (accessed 2026-09-05)
- CT Acquisitions, "Quality of Earnings (QoE) Report: 2026 Guide" — https://ctacquisitions.com/quality-of-earnings/ (accessed 2026-09-05)
- Melcap, "How to Determine Quality of Earnings When Buying or Selling a Business" — https://melcap.com/news-and-insight/articles/determine-quality-earnings/ (accessed 2026-09-05)
