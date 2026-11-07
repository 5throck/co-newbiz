---
title: Screening review from a stage screen is scoped to that stage; dev browser caches stale chunks
author: SungHyuk
date: 2026-11-07
branch: pr/20261107-135823-fix-review-scope-s3-screen-review-to-the
cost: { minutes: 7, tokens: 42645 }
id: l-87ec9d92
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - app/web-next/components/GateDecisionPanel.tsx
  - app/web-next/components/ReviewBuckets.tsx
  - app/web-next/components/stages/synergy/SynergyResult.tsx
  - app/web-next/lib/library.generated.ts
  - app/web-next/lib/pm-catalog.generated.ts
  - app/web-next/lib/process-blocker-keys.ts
  - app/web-next/lib/process-flow.ts
  - app/web-next/lib/review/ai-first.ts
  - app/web-next/lib/review/gate-artifacts.ts
---

## Decided
The screening gate covers S1-S4, so once S3 completes, S4 becomes current and a gate review flagged it as a structural defect, which skipped AI 2nd. Reviews requested from a stage screen now pass that stage as the carrier, and later stages are treated as not reached (info only). Gate-level reviews (inbox, proposal confirm) keep full scope.
Unassessed kill criteria at S3 come from evaluating both track screenings while the track is undecided; the fix is designed in ADR-0193 (draft), not done by UI tweaks.

## Tried and ruled out
Assuming the stage:S3 artifact produced the S4 defect: it covers only S3; the S3 screen requests gate:screening through the decision panel.

## Watch out
The same gate:screening key now has scoped and unscoped content hashes, so switching screens can show "stale".
On dev-newbiz the browser served old JS chunks after edits; force-refetch chunks (fetch with cache reload) before judging a fix as not applied.
CHANGELOG and PR bodies must be English-only; Korean UI labels in them fail the pre-commit and PR language gates.

In the code: app/web-next/lib/review/gate-artifacts.ts (carrierStage), lib/review/http.ts (carrierStage / carrier_stage), lib/review/ai-first.ts, lib/gate-snapshot.ts OPPORTUNITY_PROCEDURES.screening, docs/adr/0193 draft.
