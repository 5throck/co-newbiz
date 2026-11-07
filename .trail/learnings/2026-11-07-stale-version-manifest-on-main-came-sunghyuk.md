---
title: Stale version manifest on main came from dev-sync skipping files already dirty; reformat needs layout-agnostic source tests
author: SungHyuk
date: 2026-11-07
branch: pr/20261107-230406-fix-ci-resolve-ci-quality-failures-and-n
cost: { minutes: 15, tokens: 216242 }
id: l-6e9adf68
scope: repo
status: active
src: agent
touches:
  - ".github/workflows/ci.yml"
  - ".github/workflows/delete-merged-branches.yml"
  - ".github/workflows/docker-cleanup.yml"
  - ".github/workflows/docker.yml"
  - ".github/workflows/quality.yml"
  - ".github/workflows/visual-smoke.yml"
  - "app/web-next/app/api/projects/[id]/dimension-inputs/[rowId]/review/route.ts"
  - "app/web-next/app/api/projects/[id]/dimension-inputs/route.ts"
  - "app/web-next/app/api/projects/[id]/site-announcement/route.ts"
  - app/web-next/components/GateSnapshotAck.tsx
---

## Decided
- The main-branch CI "VERSION_MANIFEST drift" failure did not come from billing or a bad generator. dev-sync commits only the files that changed during the run. A manifest already dirty from an earlier sync was treated as leftover and silently dropped. The fix: dev-sync always commits the regenerated manifest. This is a local patch with an upstream request open.
- Static-source tests now compare normalized source to normalized needles, so a Biome reformat cannot break them.

## Tried and ruled out
- Putting JSX `{/* biome-ignore */}` comments inside `.map((x, i) => (` bodies. That is a syntax error, and a later `biome --write` corrupted the file, so it had to be restored from HEAD. Use a `//` comment there instead.

## Watch out
- The CI lint step runs `biome ci --changed`, so a PR that touches an unformatted file fails on formatting the earlier PR left behind.
- A regex in a negative assertion can pass trivially once the source is normalized. Re-check every `not.toMatch` after normalizing.

In the code: scripts/dev-sync.ts (ALWAYS_REGENERATED, LOCAL-PATCH U-20261107-003); tests/unit/helpers/src-normalize.ts; tests/unit/table-sizing.test.ts `&&\s*\(?\s*<th`; PR 5throck/co-newbiz#829.
