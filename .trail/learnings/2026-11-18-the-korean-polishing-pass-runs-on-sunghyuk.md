---
title: "The Korean polishing pass runs on the mid-tier model through the existing docs writer, with the skill alone carrying the step"
author: SungHyuk
date: 2026-11-18
branch: main
cost: { minutes: 1, tokens: 1251 }
id: l-a76fbef3
scope: repo
status: active
src: agent
touches:
  - agents/docs-writer.md
  - external-deps.json
---

## Decided
The LLM polishing step runs as the existing docs-writer agent on the sonnet alias, with the pinned upstream polishing prompt read at run time. Meaning drift is caught by deterministic gates rather than by a stronger model: change rate warns at 30 percent and rolls back at 50 percent, and numbers, dates, statute references and acronyms must match before and after.
Only the skill carries the step; `agents/docs-writer.md` is not edited.

## Tried and ruled out
Opus, which upstream tunes its polishing agent for: dropped for cost and tier policy; revisit only if real runs show style quality problems the gates cannot catch.
Adding the step to `agents/docs-writer.md`: dropped because agent edits trigger roster, lifecycle and persona regeneration checks.

## Watch out
Only scripted rewrites exercised the gates; no real LLM polishing was run end to end when this was decided. The pinned dependency entry lives in `external-deps.json`.

In the code:
- `external-deps.json` (humanize entry)
- `agents/docs-writer.md`
