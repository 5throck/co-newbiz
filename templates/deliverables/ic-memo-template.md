---
governance_doc_id: tpl-ic-memo
layer: template
title: "Investment Committee Memo Template"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.1.0"
effective_from: "2026-08-20"
lang: en
counterpart: ic-memo-template_ko.md
---

<!--
  This is a TEMPLATE. Deliverables produced from it are Korean-language
  (design section 3, language policy) — this file itself stays English per
  CLAUDE.md §4, since templates/ is code-adjacent tooling, not a deliverable.
  Every field in [brackets] is populated at run time from the assumption
  registry / run record; do not hand-type a number here that isn't backed
  by an assumption_key or dd_finding.
-->

# [Project Name] — Investment Committee Memo

**Run ID**: [run_id] · **As of**: [as_of] · **Version**: [document.version] · **Policy version**: [project_policy_pin]

## 1. Executive Summary
[2-3 sentences: deal type (GF/BF), thesis, recommendation]

## 2. RAG Assessment

| Dimension | Grade | Rationale |
|---|---|---|
| Financial | [grade] | [rationale — must cite the triggered rule, not just restate the grade] |
| Market | [grade] | [rationale] |
| Data Confidence | [grade] | [rationale — chain reliability grade if a proxy chain was used] |
| Regulatory/Permit | [grade] | [rationale] |
| Technical/Execution | [grade] | [rationale] |
| Risk | [grade] | [rationale] |
| **Overall** | **[grade]** | [which rule triggered — Red-if-any-Red, Green-only-if-all-Green, else Amber] |

## 3. Financial Summary
NPV / IRR / Payback / DSCR, sourced from `run_output` — [run_id]. Scenario comparison table if simulation was run (seed: [seed]).

## 4. Data Confidence & Methodology
If a proxy chain was used: chain, reliability grade, and **what evidence would raise the grade** (per design's actionable-confidence-dimension rule — not just "B grade," but "what gets it to A").

## 5. Due Diligence Findings
Table of `dd_finding` records with `value_impact` and linked `assumption_key`. No narrative-only findings.

## 6. Deal Structure & Financing (S10 output — ADR-0106)
Vehicle: [direct / SPC / holdco / internal-venture spinoff / JV] · Form: [asset / stock / mixed] · Stake: [type] · Instrument mix: [primary / secondary / mixed]
Four-axis review (all four complete, artifact-referenced): tax structure — [note]; liability isolation — [note]; financing leverage — [note]; exit structure — [note]. Artifact ref: [deal_structure_review ref]
Financing plan (sources & uses): sources [total] = uses [total] KRW millions, balanced [yes]; certainty-of-funds evidence: [commitment papers / internal approvals referenced]

## 7. M&A Special Topics (Brown Field only)
Antitrust / customer retention / incentive / HR integration / certification transferability / regional labor — status of all six, in the evaluation order fixed by meeting M5 (certification last).

## 8. Kill Criteria Check
Explicit pass/fail against every Kill Criteria condition applicable to this gate.

## 9. Recommendation
[Human reviewer's recommendation — this section is never auto-generated; §2's RAG grade is *proposed*, this section is where the human confirms or corrects it, with a reason if corrected.]

## 10. Reviewer Sign-off
| Stage | Reviewer | Date | Result |
|---|---|---|---|
| AI 1st (formal) | [agent_key] | [date] | [verified / could-not-verify list] |
| AI 2nd (cross-domain) | [agent_key, different domain] | [date] | [verified / could-not-verify list] |
| Human final | [reviewer name] | [date] | [approved / rejected / conditional] |

---
*Generated from `templates/deliverables/ic-memo-template.md` v1.0.0. Glossary terms used in this document are listed in the appendix (auto-generated, design section 7.3).*
