---
governance_doc_id: gov-dd-03
layer: docs-content
title: "DD Findings Recording Rules"
scope: co-newbiz
owner_agent: commercial-dd-agent
version: "1.0.0"
effective_from: "2026-09-05"
lang: en
counterpart: dd-findings_ko.md
---
# Once due diligence uncovers something, what comes next
> **Language**: **English** · [한국어](dd-findings_ko.md)

Suppose the due diligence process described in [the DD overview] uncovers a problem or a risk. For example, say you learn that "40% of this company's revenue comes from a single customer." Writing that down as one line in the meeting minutes and moving on is not enough. You must calculate — in numbers — how much the company's value would fall if that customer left, and keep it as a formal record, so that the Investment Committee (IC) can later reflect this finding in the actual investment decision and price. co-newbiz calls this formal record a `dd_finding`.

## The four things every finding record must contain

- **What was found (description)** — not an impression such as "revenue looks weak," but a verifiable fact stated in clear sentences.
- **How much impact it has (value_impact)** — the amount is converted in whole numbers, denominated in **KRW millions** (internal accounting rule ADR-0061). For the customer-concentration example above, you would estimate the annual revenue and profit lost if that customer left and record it as a number. If the finding is of a nature that simply cannot be converted into money (e.g., reputational risk), you must state the reason why conversion is impossible alongside it.
- **Which assumption it ties to (assumption_key)** — you specify which assumption in the original business plan this finding shakes. If the plan contains the assumption "a revenue plan built on a 95% customer retention rate," then the customer-concentration risk just discovered ties directly to that assumption.
- **Where the evidence is (evidence_ref)** — you record the location of the documents or materials supporting the finding, so that it can later be confirmed that this was not merely hearsay.

## The flow from finding to final investment proposal

**Problem found in due diligence** → **formally recorded as a `dd_finding`** (including the four elements above) → **reflected in price and the investment proposal** (see [the DD→valuation bridge] for the concrete reflection procedure) → **included in the Investment Committee (IC) package**

What matters in this flow is that a finding "that does not translate into a number" cannot be reflected at any later stage. A finding that is described in prose but carries no amount — however serious it may look — is not automatically reflected in the final investment decision. That is why recording value_impact is established as a rule without exceptions.

## 🌐 External Reference — Is converting findings into numbers also the industry standard?

Yes, it is. In industry M&A due diligence too, the final purchase price is determined by applying a multiple not to the seller's self-reported earnings (EBITDA) but to earnings normalized through due diligence (Quality of Earnings, QoE). In other words, the standard is to attempt to convert findings into numbers as a matter of principle; "recording only the reason conversion is impossible" is the exception, not the default. Also, items with a debt-like character are deducted directly from the price separately from the earnings-multiple calculation — the path through which a finding is reflected can vary depending on its nature. See the [docs/research/dd-findings-quantification.md] document for sources and details (research date 2026-09-05).

## Source Mapping

| Claim | Basis |
|---|---|
| value_impact unit and obligation | ADR-0061, business-manual_ko §"DD 발견사항" |
| Inclusion in the IC package | ADR-0100, ic-package route |
| Quantification principle | docs/research/dd-findings-quantification.md |
