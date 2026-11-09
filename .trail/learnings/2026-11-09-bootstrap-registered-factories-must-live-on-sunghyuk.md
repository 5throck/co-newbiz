---
title: "Bootstrap-registered factories must live on globalThis, not module variables"
author: SungHyuk
date: 2026-11-09
branch: pr/20261110-064541-fix-web-globalthis-backed-executor-seams
cost: { minutes: 512, tokens: 3567555 }
id: l-a32029f5
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - app/web-next/lib/business-case-generator.ts
  - app/web-next/lib/committee-agents.ts
  - app/web-next/lib/dd-checklist-tailor.ts
  - docs/VERSION_MANIFEST.md
  - docs/skill-graph.json
  - docs/skill-graph.md
  - memory/2026-11-10.md
  - memory/skill-review/2026-11-10.md
---

## Decided
Executor/agent seam factories registered at server bootstrap (instrumentation.ts) must be stored on globalThis with a per-seam key, never in a module-level variable.

## Tried and ruled out
Module-level `let factory` variables: Next.js compiles instrumentation and each route handler as separate bundles (dev HMR recompiles per edit), so the route-side module instance never sees the bootstrap's registration. The committee llm_required guard introduced by ADR-0196 decision 10 made this latent defect user-visible: convening failed with "LLM provider not configured" even though the provider was configured and the server had been restarted (the bootstrap log even printed "LLM mode registered").

## Watch out
Any new seam registered at bootstrap (instrumentation.ts) and consumed in API routes needs the globalThis pattern. The bootstrap log alone proves nothing about route visibility. Symptom signature: route returns llm_required 400 in ~5ms while bootstrap says registered.

In the code: app/web-next/lib/committee-agents.ts (CALL_AGENT_FACTORY_KEY), business-case-generator.ts (EXECUTOR_FACTORY_KEY), dd-checklist-tailor.ts — three seams converted in the 2026-11-10 seam fix; instrumentation.ts keeps registering exactly as before.
