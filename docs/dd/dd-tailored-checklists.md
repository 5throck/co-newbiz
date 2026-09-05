---
governance_doc_id: gov-dd-04
layer: docs-content
title: "Tailored Checklists"
scope: co-newbiz
owner_agent: commercial-dd-agent
version: "1.0.0"
effective_from: "2026-09-05"
lang: en
counterpart: dd-tailored-checklists_ko.md
---
# When the standard checklist alone is not enough
> **Language**: **English** · [한국어](dd-tailored-checklists_ko.md)

The standard checklists for the 7 areas introduced in [the domain-specific DD guide] are mandatory checks applicable across any industry. But the risks to verify differ entirely between, say, acquiring a semiconductor plant and investing in a delivery-platform startup — for a semiconductor plant, product liability related to handling chemicals becomes a critical check item, and for a platform, the risk of couriers being recognized as employees — items that the standard checklist does not contain. To avoid missing these industry- and company-specific risks, co-newbiz maintains a procedure for proposing industry-specific **tailored items** in addition to the standard checklist (design basis: internal ADR-0099).

One principle matters here — standard items are never replaced; tailored items are strictly **additions**. This is not about swapping in tailored items because the standard checklist is too loose; it exists to fill gaps the standard cannot cover.

## How it works

1. The responsible execution program reads this project's context (what industry it is, which track it is on, and what the earlier viability analysis concluded) and proposes roughly 5–10 checklist items specific to this deal.
2. Each proposed item is always assigned a **source confidence grade**. An item proposed on a bare "this might exist" hunch with no supporting evidence is automatically recorded at the lowest grade, **C** — the design deliberately exposes, rather than hides, thin evidentiary backing.
3. Proposed items join the project's actual checklist only after human review and approval, and only then become subject to pass/fail determination. Being proposed does not mean being automatically adopted.

Where needed, an internet-search capability can be enabled during this process to reference recent industry issues and regulatory trends (internal setting `CO_NEWBIZ_DD_TAILOR_AGENTS`). However, this feature does not mean "the AI finds everything on its own"; it is designed to make the limits of what that search might miss transparently visible to the reviewer.

## 🌐 External Reference — Is tailoring checklists by industry an industry standard?

Yes, it is. The core principles of M&A due diligence are industry-agnostic, but each industry has its own regulatory, operational, and valuation-risk characteristics, so adapting the standard checklist to the realities of the sector is common industry practice. For example, technology companies are examined with focus on intellectual-property ownership and data security/information-security certifications, manufacturers on environmental liability and supply chain risk, and healthcare on licenses and reimbursement systems. Ideally a multidisciplinary team of financial, legal, operational, and sector specialists handles this adaptation; co-newbiz supplements it with a source confidence grading system (A/B/C) — even if it cannot fully replace expert validation, it at least prevents evidence-free proposals from masquerading as evidence-backed ones. See the [docs/research/dd-checklist-tailoring-practice.md] document for sources and details (research date 2026-09-05).

## Source Mapping

| Claim | Basis |
|---|---|
| Pipeline and confidence grades | ADR-0099, dd-checklist-tailor.ts |
| Custom item storage | migration 0069, project_checklist_item_state |
| Industry tailoring practice | docs/research/dd-checklist-tailoring-practice.md |
