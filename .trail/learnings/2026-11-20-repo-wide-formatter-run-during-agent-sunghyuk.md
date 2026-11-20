---
title: Repo-wide formatter run during agent work was reverted; scope biome --write to explicit files
author: SungHyuk
date: 2026-11-20
branch: main
cost: { minutes: 16, tokens: 474178 }
id: l-911bfdfe
scope: repo
status: active
src: agent
touches:
  - "app/web-next/app/api/opportunities/[id]/committee-sessions/[sessionId]/positions/route.ts"
  - "app/web-next/app/api/opportunities/[id]/committee-sessions/[sessionId]/route.ts"
  - "app/web-next/app/api/projects/[id]/committee-sessions/[sessionId]/positions/route.ts"
  - "app/web-next/app/api/projects/[id]/committee-sessions/[sessionId]/route.ts"
  - docs/VERSION_MANIFEST.md
  - memory/2026-11-20.md
  - scripts/co-newbiz/generate-prompt-registry.ts
  - CHANGELOG.md
  - "app/web-next/app/api/opportunities/[id]/committee-sessions/[sessionId]/advance/route.ts"
  - "app/web-next/app/api/opportunities/[id]/committee-sessions/route.ts"
---

During the turn-meeting work a single bulk formatter pass (every file's mtime in the same second, repo biome.json settings: double quotes, width 120) touched ~178 files unrelated to the task; the owner approved reverting them so the feature PR stays focused.

## Decided
Feature PRs must not carry repo-wide formatting. Unrelated formatter output is reverted, not committed; a separate style-only PR can do the sweep later.

## Tried and ruled out
- `git diff -w` to prove "formatting only": useless — line wraps and quote-style changes are non-whitespace, so it flags everything.
- Keyword grep on diffs to find real content: too noisy (wrapped lines break it).
- What worked: cluster file mtimes to identify the bulk run, then whitespace-stripped compare per file to confirm content-identical reformat, plus explicit exceptions for files with real edits (generated catalogs, openapi.yaml).

## Watch out
- Subagents running `biome check --write` without explicit file paths can sweep the whole repo. Instruct them to pass explicit paths only.
- Before reverting anything, list the exact files and get owner approval; a bulk `git checkout --` of an inferred list was blocked by permissions once and rightly so.

In the code:
- Repo formatter config lives in biome.json (double quotes, lineWidth 120). CI lint only checks files changed vs the base branch, so files committed before the config change carry old formatting and stay unflagged until touched.
