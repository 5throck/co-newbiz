---
governance_doc_id: gov-dd-01
layer: docs-content
title: "DD Overview & Process"
scope: co-newbiz
owner_agent: process-governance-manager
version: "1.0.0"
effective_from: "2026-09-05"
lang: en
counterpart: dd-overview_ko.md
---
# What is DD (Due Diligence), and why does this company do it
> **Language**: **English** · [한국어](dd-overview_ko.md)

**Due diligence** (DD) is a verification step performed before acquiring a company or starting a new business, in which you carefully confirm "whether the information we have is actually true, and what risks may be hidden." It follows the same logic as checking the property registry, looking for leaks, and researching local market prices before buying a house — except the subject is not a house but an entire company, so you have to examine it simultaneously from multiple angles: financial, legal, technical, market, and organizational.

In co-newbiz's new business review process, DD corresponds to **S9**, the ninth of the twelve stages (S1–S12). This stage is applied somewhat differently in two situations:

- **Brownfield** — the case of acquiring or making an equity investment in an already existing company. Here, DD is due diligence on the target company in the literal sense: verifying "whether the materials this company has shown us match reality."
- **Greenfield** — the case of not buying an existing company but entering a new business by building it ourselves. Since there is no target company to verify, we instead validate whether our own entry strategy and cost structure (the plans built in the earlier S5–S8 stages) are realistically feasible.

## Where DD sits in the overall flow

DD is not a standalone stage but one link in a chain connected to the stages before and after it.

**S8 business viability analysis** (the first-pass calculation of whether this business makes money) → **S9 DD** (verifying whether the assumptions behind that calculation are true) → **S10 investment structure design** (deciding how and through what company structure to invest) → **S11 Investment Committee (IC) review** (final approval decision)

In other words, DD serves as the bridge between "a plan made of numbers" and "an investment proposal that can actually be approved." If the findings that come out of DD are weak, no matter how sophisticated the investment structure designed afterwards, it will be a house built on wrong premises.

## The 7 investigation areas (domains)

DD is not done by one person looking at everything; it is divided by area of expertise. co-newbiz uses the following 7 areas as its standard — what each area actually checks is covered in more detail in [the domain-specific DD guide].

| Area | In plain terms |
|---|---|
| commercial | Is there really a market in which this business can be sold |
| technical | Do the technology and equipment we plan to use actually work and last |
| legal | Is ownership clean, with no litigation or regulatory issues |
| financial | Can the numbers in the books be trusted |
| hr | Will key people stay, and are there hidden burdens in their compensation |
| market | Re-confirming whether the original market judgment still holds |
| financing | Is the structure actually capable of raising the required money |

For each area there is a predefined list of detailed items to check (a checklist), and in principle you cannot move to the next stage unless the items marked "mandatory" pass. To pass them exceptionally, a formally approved waiver is required, which is covered in the [waiver & kill criteria] document.

## Operating rules — why we start from "undetermined"

The investigation results of this stage are not fixed as pass/fail from the outset. Every checklist item starts in the **"not yet verified (undetermined)"** state and is only finalized as pass or fail after the actual investigation is complete. This design exists to block out post-hoc corrections of the "write it down as passed for now and fix it later if a problem appears" variety.

To be recognized as complete, DD must satisfy both of the following conditions:

1. Every item on the applicable checklist has received a definitive determination (not undetermined)
2. No unmet mandatory item remains (waivers formally approved as exceptions are separate)

And any problem or risk discovered during the investigation does not end with "it was noted in the meeting minutes" — it must be formally recorded as a `dd_finding`; this recording rule is covered in the [DD findings recording rules] document.

## 🌐 External Reference — How M&A due diligence is conducted in the industry

A typical merger and acquisition (M&A) due diligence process proceeds in 5–6 standard stages: ① preliminary review that makes a first-pass judgment of the deal's value with limited information → ② confirmatory (main) due diligence in which the full data room is reviewed after signing a letter of intent (LOI) (the most extensive and critical stage) → ③ negotiation reflecting the findings into price and contract terms → ④ final confirmation just before closing → ⑤ closing. co-newbiz's Brownfield track corresponds to this confirmatory due diligence stage, while the Greenfield track (self-founded entry with no external target company) does not map exactly onto this standard process — the key difference is that instead of verifying someone else's company, we verify our own assumptions. See the [docs/research/dd-process-phases.md] document for sources and details (research date 2026-09-05).

## Source Mapping

| Claim | Basis |
|---|---|
| 7 domains, completion predicate | ADR-0099, process-flow.ts S9 branch |
| Mandatory and waiver rules | docs/manuals/business-manual §2, checklists front matter |
| Track-level stage comparison | docs/research/dd-process-phases.md |
