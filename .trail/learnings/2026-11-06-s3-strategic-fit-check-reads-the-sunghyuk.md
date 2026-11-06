---
title: "S3 strategic-fit check reads the S2 attractiveness rationale, and synergy confirmation does not select the opportunity"
author: SungHyuk
date: 2026-11-06
branch: main
cost: { minutes: 1, tokens: 1495 }
id: l-1c39467e
scope: repo
status: active
src: agent
touches:
  - app/web-next/lib/process-flow.ts
---

## Decided
Diagnosis only (2026-11-06). Proposed fixes: S3 predicate reads the fit verdict/rationale fields; the review stops flagging stages after the current one as defects; review text is localized through message keys instead of regex.

## Watch out
- The S3 "strategic fit judgement" condition is satisfied by the opportunity's general rationale field, which S2 attractiveness writes, so a deal can pass with no fit judgement.
- Confirming the synergy score does not change status to "selected"; S3 stays incomplete until a person selects the opportunity. Users read this as "linked but not connected".
- The screening gate spans S1–S4 (S4 belongs to both screening and pre_fs). A review run at S3 therefore lists S4 as a structural gap, and that gap also makes AI 2nd skip.
- Review claims are English strings that the display layer pattern-matches into Korean, so new claim wording needs a matching pattern or it shows untranslated.

In the code: app/web-next/lib/process-flow.ts S3 predicate (opp.rationale vs fit_verdict/fit_rationale); lib/review/gate-artifacts.ts buildGateArtifact; lib/review/ai-first.ts locked branch; lib/review/review-display.ts localizeItem; components/ReviewBuckets.tsx.
