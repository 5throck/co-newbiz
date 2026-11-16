---
title: "After adding migrations or locale keys, restart the running dev server before checking the screen"
author: SungHyuk
date: 2026-11-16
branch: main
cost: { minutes: 30, tokens: 93114 }
id: l-8b64a789
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - app/web-next/app/styles.css
  - app/web-next/components/stages/brownfield/AiEvalChips.tsx
  - app/web-next/components/stages/brownfield/AiEvalDialogs.tsx
  - app/web-next/components/stages/brownfield/AiEvalStart.tsx
  - app/web-next/components/stages/brownfield/AiEvalVersionPanel.tsx
  - app/web-next/components/stages/brownfield/LonglistSection.tsx
  - app/web-next/components/stages/brownfield/aiEvalTypes.ts
  - app/web-next/components/stages/brownfield/types.ts
  - app/web-next/components/stages/brownfield/useAiEval.ts
---

## Decided
The dev server applies migrations only at boot and keeps the locale messages it loaded at start. After a change that adds a migration or new translation keys, restart the dev server before judging the screen. Check for a stale server first when a page shows a 500 or raw message keys.

## Tried and ruled out
Treating the symptoms as code bugs. After the S6 bulk evaluation merge the targets list returned 500 ("no such table: brownfield_eval_draft_version") and the chips showed raw keys like stages.s67.aiEval.chipScore, although the migration files and the ko/en keys were present and correct. Both cleared up only after the server restarted.

## Watch out
- The first symptom of a stale server is only a generic "server response is empty or corrupted" banner. The real cause is in the dev server log and in the browser console (SQLiteError, MISSING_MESSAGE).
- Real DART business reports use heading styles that a numbered-heading-only extractor misses, so section extraction gave no_sections on 2 of 3 filings. Test extractors against the real filing structure.

In the code:
- Migrations auto-apply in app/web-next/instrumentation.ts (CO_NEWBIZ_BOOTSTRAP_MIGRATIONS, default auto).
- Dev server log: app/web-next/.next/dev/logs/next-development.log.
