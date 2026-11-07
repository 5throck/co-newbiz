---
title: Run dev-sync from main; merged-PR branch refusals and regenerable artifacts
author: SungHyuk
date: 2026-11-07
branch: pr/20261107-100741-style-review-biome-formatting-on-review-
cost: { minutes: 196, tokens: 1080106 }
id: l-ce86493c
scope: repo
status: active
src: agent
touches:
  - docs/VERSION_MANIFEST.md
  - memory/2026-11-07.md
  - tests/unit/review-runtime.test.ts
  - CHANGELOG.md
  - app/web-next/lib/review/ai-second.ts
  - app/web-next/lib/review/engine.ts
  - app/web-next/lib/review/http.ts
  - docs/designs/2026-11-06-ai-review-stage-scope-fit-i18n-design.md
  - app/web-next/lib/review/review-display.ts
  - tests/unit/review-item-keys.test.ts
---

## Decided
After every merged PR, check out main (fast-forward) BEFORE the next dev-sync run. dev-sync refuses a follow-up sync on a merged-PR branch ("commits would be orphaned off main").

## Tried and ruled out
Committing follow-ups on the old PR branch — blocked by the refusal, correct behavior.

## Watch out
- Each dev-sync run regenerates docs/VERSION_MANIFEST.md and appends memory/YYYY-MM-DD.md. These diffs block `git checkout main` after a merge. They are regenerable: `git stash push` them (do not delete) before switching, and leave them unmerged — the next sync regenerates them.
- Root `typecheck:baseline` covers tests/; `typecheck:web` does not. A new test file can pass typecheck:web and still fail CI. Run `bun run typecheck:baseline` before sync.
- Static-source tests read component sources and assert literal strings (Korean UI text, tr() keys). When strings move to catalogs, update those tests to assert `tr("key")` plus the catalog value, not the literal.

In the code: scripts/dev-sync.ts branch refusal; scripts/typecheck-baseline.ts; tests reading components via readFileSync (review-status-message.test.ts, synergy-score-eval-ai.test.ts as examples).
