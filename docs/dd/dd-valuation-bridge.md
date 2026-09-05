---
governance_doc_id: gov-dd-06
layer: docs-content
title: "DD→Valuation Bridge"
scope: co-newbiz
owner_agent: valuation-agent
version: "1.0.0"
effective_from: "2026-09-05"
lang: en
counterpart: dd-valuation-bridge_ko.md
---
# How due diligence results feed into the actual investment decision
> **Language**: **English** · [한국어](dd-valuation-bridge_ko.md)

No matter how rigorously due diligence is conducted, if its results are not reflected in the actual investment terms, DD is just another report shelved in a drawer. This document explains how findings formally recorded under [the DD findings recording rules] ultimately flow through to the Investment Committee's (IC) approval decision.

## From finding to investment judgment, in three steps

1. **Findings converted into amounts** (`dd_finding.value_impact`, in KRW millions) express the quantitative impact of each finding. For example, "core customer churn risk could reduce annual revenue by KRW 3 billion" — expressed as a number, per the principles described in the earlier document.
2. These amounts are reflected into the three scenarios of the business plan built earlier (at Stage S8) — **downside (pessimistic)**, **base**, and **upside (optimistic)** — folding risks and opportunities unknown before due diligence into the plan.
3. The adjusted results flow into the financial summary of the final package submitted to the Investment Committee, and into an overall **RAG grade** (a traffic-light style rating: red / amber / green) expressing how reliable the investment proposal is overall.

## Two rules that must be upheld

- **No amount, no entry** — for any finding to be reflected in the IC package, it must carry a value_impact (amount), or, if it does not, a clear stated reason for why it cannot be converted into money. A finding left as "discovered but unquantified" cannot be reflected in the final judgment.
- **Information confidence caps the grade** — no matter how good the financial figures look, if the confidence of the underlying information (data confidence) is low, the overall RAG grade cannot rise above that level. This is a safeguard against judging optimistically on the numbers alone when "the numbers are good but the sources are weak."

## 🌐 External Reference — Does the industry reflect findings into price this way too

Yes, this structure shares its principles with industry M&A practice. The industry computes the final price by applying a multiple to earnings normalized through due diligence (Quality of Earnings), while debt-like items are deducted directly from the price, separately from that multiple calculation. Also standard practice as of 2026: the seller and buyer each independently compute normalized earnings and check whether their results converge within 10–15% — when the two computations diverge materially, the difference itself becomes a negotiation issue. See the [docs/research/dd-findings-quantification.md] document for sources and details (research date 2026-09-05).

## Source Mapping

| Claim | Basis |
|---|---|
| Bridge procedure | skills/dd-to-valuation-bridge, ADR-0098 |
| Grade capping | docs/governance/rag-framework.md, ic-package route comments |
| QoE bridge practice | docs/research/dd-findings-quantification.md |
