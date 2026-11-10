---
title: "Silent zod fallbacks turned an LLM minutes pass into an always-empty surface - headroom, tolerant repair, logged rejections"
author: SungHyuk
date: 2026-11-10
branch: main
cost: { minutes: 81, tokens: 73127 }
id: l-28db43ca
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - app/web-next/lib/committee-chair.ts
  - app/web-next/lib/committee-llm.ts
  - app/web-next/lib/committee-minutes-schema.ts
  - docs/VERSION_MANIFEST.md
  - tests/unit/calibration-escalation.test.ts
  - tests/unit/committee-minutes-schema.test.ts
  - app/web-next/components/CommitteePanel.tsx
  - app/web-next/lib/pm-catalog.generated.ts
  - app/web-next/lib/prompts.generated.ts
---

## Decided
Any LLM pass whose output is schema-validated must (a) budget enough output tokens for the WORST case input (full 12-seat roster, Korean summaries — 2500 tokens truncated the minutes JSON mid-object), (b) normalize known model shape drift before validation (top-level resolutions array, Korean/array owner fields, off-vocabulary acts), and (c) log every rejection. A silent catch + null → deterministic fallback made a systematically failing pass look like a working-but-empty surface for days.

## Tried and ruled out
Trusting a small repro: a 2-seat toy material parsed clean while every real session failed — the failure was size-dependent truncation, only visible with full-roster material. Also relying on the prompt alone: even with a corrected example, minor drift (owner_seat as a Korean role or array) killed the whole document parse.

## Watch out
When an LLM-generated surface renders empty, check the fallback flag in the stored draft FIRST and reproduce with production-shaped material, not a toy. The rejections are now logged (committee-chair console.warn with zod paths) — check the server log before theorizing.

In the code: app/web-next/lib/committee-llm.ts (minutes maxTokens 6000), committee-minutes-schema.ts (normalizeMinutesDraft), committee-chair.ts (rejection logging); prompt SSOT app/web-next/prompts/prompts.json committee.minutes.
