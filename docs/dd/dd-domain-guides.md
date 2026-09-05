---
governance_doc_id: gov-dd-02
layer: docs-content
title: "Domain-Specific DD Guide"
scope: co-newbiz
owner_agent: commercial-dd-agent
version: "1.0.0"
effective_from: "2026-09-05"
lang: en
counterpart: dd-domain-guides_ko.md
---
# Why due diligence is split into 7 areas
> **Language**: **English** · [한국어](dd-domain-guides_ko.md)

If due diligence (see [the DD overview]) is carried out by a single person, blind spots are inevitable. Someone strong in finance may miss the legal traps in a contract; someone strong in technology may fail to notice accounting irregularities. That is why co-newbiz divides due diligence into 7 specialist areas (domains), each run as a separate checklist. The exact wording of each checklist item is governed by the YAML source files in the repository; the table below is an explanation to help you understand "why each area exists and what it is trying to protect."

| Area | Purpose | What is checked |
|---|---|---|
| **commercial** | Market, customer, and competitive validation | Whether revenue is concentrated in a small number of customers (customer concentration), whether competitive advantage is strong enough to raise prices at will, and whether the current growth momentum is sustainable rather than a passing trend |
| **technical** | Technology and equipment validation | Whether the core technology is still at the experimental stage or genuinely commercialized, how much remaining useful life the equipment has, and whether environmental, health, and safety (EHS) regulations are being violated |
| **legal** | Legal and regulatory validation | Whether ownership of the assets or equity to be sold is actually clean, whether any regulatory reviews are pending, and whether there are ongoing or foreseeable lawsuits |
| **financial** | Financial quality validation | Whether book profits reflect actual cash generation (quality of earnings), whether there is a risk of working capital suddenly drying up, and what the debt repayment schedule and tax risks look like |
| **hr** | People and organization validation | Whether key executives are locked into excessive compensation or special-benefit contracts, whether post-acquisition employment terms are equitable, and whether labor risks exist (unpaid wages, labor disputes, etc.) |
| **market** | Market re-validation | Whether the demand projections made in the original viability analysis are still valid today, and whether substitutes or new competitors have emerged in the meantime |
| **financing** | Funding certainty validation | Whether the structure can actually raise the required money, and — if borrowing — whether there is headroom to comply with the loan covenants |

These 7 areas are not independent of one another. For example, a "customer churn risk" found in commercial due diligence ties directly into the "revenue projection" in financial due diligence, and a "key-person departure risk" found in HR due diligence interacts with "technology succession feasibility" in technical due diligence. That is why due diligence results do not end as isolated per-item conclusions; they are ultimately consolidated into a single investment judgment through the [DD→valuation bridge].

## 🌐 External Reference — How the industry divides commercial due diligence

Industry standards likewise typically structure commercial due diligence around four pillars — market intelligence, competitive intelligence, customer intelligence, and growth assessment (e.g., the Martec Group's "5 Pillars", PE Primer) — and customer concentration, customer churn rate, and revenue sustainability are cited as the most commonly examined items. co-newbiz's commercial area checkpoints (customer concentration, pricing power, growth sustainability) align with most of these industry-standard pillars. See the [docs/research/dd-commercial-workstreams.md] document for detailed sources (research date 2026-09-05).

## Source Mapping

| Claim | Basis |
|---|---|
| Domain system | checklists/*.yaml, ADR-0099 |
| Industry workstreams | docs/research/dd-commercial-workstreams.md |
