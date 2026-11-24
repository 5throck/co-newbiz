---
title: "The S8 'overview' tab key means the financial sub-tab, not the 개요 page, so a redirect that runs after the S8 screen paints flashes 재무적 타당성 first"
author: SungHyuk
date: 2026-11-24
branch: pr/20261123-template-0300-delta-landing
cost: { minutes: 2, tokens: 147000 }
id: l-7f1a5169
scope: repo
status: active
src: agent
touches:
  - app/web-next/lib/business-goals-view.ts
  - app/web-next/components/stages/BusinessCaseStage.tsx
  - AGENTS.md
  - agents/pm.md
---

## Decided
The 개요 tab of S8 is the project page itself (/projects/{id}). Inside the business-case screen, the tab key "overview" is the financial default sub-tab (설명·생성·권고), shown under the 재무적 타당성 highlight. So a bare business-case URL must leave before the stage renders, and S8 entry links should go straight to /projects/{id}.

## Tried and ruled out
A client-side useEffect redirect from bare /business-case to /projects/{id} (2026-11-23 fix). It runs after the first paint, so users still saw 재무적 타당성 briefly, then 개요 (reported 2026-11-24).

## Watch out
Entry links still point at the bare route and must change together, or the flash comes back.

In the code:
- app/web-next/lib/business-goals-view.ts: resolveS8Tab(null) returns "overview"; s8BareTabRedirect
- app/web-next/components/stages/BusinessCaseStage.tsx: the useEffect redirect
- Entry links: components/StageFrame.tsx STAGE_HREF.S8, app/projects/page.tsx project-list shortcut, app/deals/[id]/[stage]/page.tsx PROJECT_STAGE_PATH.S8
