---
title: "Check the current branch is main before running sync, or the commit joins whatever PR is checked out"
author: SungHyuk
date: 2026-11-08
branch: pr/20261108-124056-chore-templates-upgrade-template-deliver
cost: { minutes: 73, tokens: 690666 }
id: l-44f5a95c
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - "app/web-next/app/api/opportunities/[id]/route.ts"
  - app/web-next/app/api/opportunities/route.ts
  - "app/web-next/app/opportunities/[id]/page.tsx"
  - app/web-next/components/AttractivenessReEvaluate.tsx
  - app/web-next/components/stages/OpportunityFunnelStage.tsx
  - docs/VERSION_MANIFEST.md
  - docs/designs/2026-11-08-reevaluate-selected-until-s4-design.md
  - docs/specs/entries/2026-11-08-reevaluate-selected-until-s4-design.json
  - docs/specs/registry.json
---

## Decided
- Before running the sync pipeline for a new change, confirm the checkout is on main. Another session or a template upgrade may have left the shared checkout on its own PR branch.
- If a commit lands on the wrong PR, undo it with a revert commit on that branch through sync, not with a force push. Then re-apply it on a fresh branch from main with cherry-pick --no-commit and sync again.

## Tried and ruled out
- Stashing "unrelated" dirty files to get the audit to pass. On someone else's branch, those files are that branch's uncommitted work, not stray changes. Stash them only to switch branches, and restore them afterwards.

## Watch out
- dev-sync creates a pr/ branch only when it runs on main. On any other branch it commits and pushes to that branch, which updates that branch's open PR.
- Switching the shared checkout also changes what the dev server serves.

In the code: scripts/dev-sync.ts step 5 (branch creation, reuses a non-main branch); check with `git branch --show-current` before `bun scripts/dev-sync.ts`.
