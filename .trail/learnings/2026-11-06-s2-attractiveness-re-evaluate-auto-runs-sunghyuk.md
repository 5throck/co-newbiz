---
title: S2 attractiveness re-evaluate auto-runs the AI draft on open; a person still confirms the score
author: SungHyuk
date: 2026-11-06
branch: main
cost: { minutes: 43, tokens: 67085 }
id: l-bf1611d7
scope: repo
status: active
src: agent
touches:
  - memory/2026-11-06.md
  - tests/unit/longlist-review-fixes.test.ts
  - CHANGELOG.md
  - "app/web-next/app/deals/[id]/[stage]/page.tsx"
  - "app/web-next/app/opportunities/[id]/page.tsx"
  - app/web-next/components/CarrierGate.tsx
  - app/web-next/components/StageFrame.tsx
  - app/web-next/components/stages/synergy/SynergyResult.tsx
  - scripts/co-newbiz/i18n-lint.baseline.json
  - tests/unit/deal-stage-carrier.test.ts
---

## Decided
Opening 재평가 (re-evaluate) on S2 automatically requests the AI attractiveness draft once and prefills it as a proposal. Saving the score stays a human click (design rule: only a person turns an AI output into the recorded decision). Editor opens in a full-width row under the opportunity, not inside the narrow actions cell.

## Tried and ruled out
- Auto-saving the AI score: conflicts with the human-confirms rule; would need an ADR.
- Triggers like S1 re-analysis completion, factor edits, stale-on-open, or a schedule: not chosen; the user's ask was read as "run the draft when re-evaluate is opened". Revisit if they want background re-scoring.
- Rendering the editor inline in the funnel actions cell: the rationale text blew out the table layout.

## Watch out
Do not auto-fire the draft on page load (LLM cost). CI lint runs biome on touched files wholesale.

In the code: app/web-next/components/AttractivenessReEvaluate.tsx, components/stages/OpportunityFunnelStage.tsx, POST /api/opportunities/{id}/attractiveness-recommendation, PUT /api/opportunities/{id}.
