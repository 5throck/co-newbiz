---
title: "The S8 financial sub-tab key is 'financial-model', and 'overview' only means the 개요 page; entry links go straight to the project page"
author: SungHyuk
date: 2026-11-24
branch: pr/20261123-template-0300-delta-landing
cost: { minutes: 5, tokens: 12567 }
id: l-06cefc9a
scope: repo
status: active
replaces: l-7f1a5169
src: agent
touches:
  - app/web-next/lib/business-goals-view.ts
  - app/web-next/lib/stage-tabs.ts
---

## Decided
- The S8 개요 tab is the project page itself (/projects/{id}). The financial sub-tab (설명·생성·권고) was renamed from "overview" to "financial-model" (user decision 2026-11-24), so "overview" no longer means two things.
- A legacy business-case ?tab=overview URL, or one with no tab at all, redirects to the 개요 page before the S8 screen renders. Every S8 entry link points at /projects/{id} directly.

## Tried and ruled out
- A redirect inside useEffect after the stage paints (2026-11-23): it flashed 재무적 타당성 before 개요.
- Naming the key "case": the user rejected it, because S8 has two lenses (technical and financial) and "case" doesn't say which one.
- "valuation" and "financial-summary": offered, not chosen.

## Watch out
Don't reuse "overview" as an S8 business-case tab key. Other screens' "overview" tabs (market, target profile, deal overview) are unrelated.

In the code:
- app/web-next/lib/business-goals-view.ts: S8_TAB_KEYS, resolveS8Tab, s8BareTabRedirect
- app/web-next/lib/stage-tabs.ts: S8 subtabs and aliases
- app/web-next/lib/project-stage-entry.ts: s8EntryHref, projectStageHref
- app/web-next/app/projects/[id]/business-case/page.tsx: returns null while redirecting
- DEC-20261124-01; design doc 2026-11-21-s8-overview-tab, Defect Remediation 2
