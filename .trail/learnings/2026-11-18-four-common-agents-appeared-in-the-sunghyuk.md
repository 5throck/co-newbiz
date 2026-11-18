---
title: Four common agents appeared in the roster during an audit run and were kept out of the feature PR
author: SungHyuk
date: 2026-11-18
branch: pr/20261118-143030-feat-docs-integrate-humanize-kr-as-a-pin
cost: { minutes: 5, tokens: 23041 }
id: l-15617989
scope: repo
status: active
src: agent
touches:
  - ".agents/skills/humanize-polish/SKILL.md"
  - ".gemini/skills/humanize-polish/SKILL.md"
  - ".hermes/skills/humanize-polish/SKILL.md"
  - CHANGELOG.md
  - docs/VERSION_MANIFEST.md
  - docs/designs/2026-11-18-humanize-polish-integration-design.md
  - docs/lifecycle/skills/humanize-polish.md
  - docs/skill-graph.json
  - docs/skill-graph.md
  - docs/specs/entries/2026-11-18-humanize-polish-integration-design.json
---

## Decided
When a full audit run during unrelated work added four agents to the roster (45 instead of 41) with their mirrors and lifecycle records, they were moved out of the working tree and the tracked roster files were restored, so the feature PR stayed in scope. The audit then passed and did not recreate them.

## Tried and ruled out
Regenerating the agent registry to make the audit pass with the new agents: dropped because it would have shipped an unreviewed roster change inside an unrelated PR.

## Watch out
The writer of those files was not identified; their lifecycle records are dated 2026-11-12, which suggests template-delivered common agents. If the roster count in `AGENTS.md` changes unexpectedly, find the source before committing. The moved files are in a temp folder named co-newbiz-roster-sidefx, outside the repo.

In the code:
- `AGENTS.md` (roster counts)
- `variant.json`
