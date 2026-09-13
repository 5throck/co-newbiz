# Design: S8-S12 project screen readability — nav grouping + in-page tabs

- Date: 2026-09-14
- Status: implemented (Phase 1+2 of 3)

## Problem

`ProjectSubNav.tsx` lists 23 sibling `/projects/[id]/*` routes as one flat, ungrouped link bar, even though they map to five distinct pipeline stages (S8-S12, `lib/stage-meta.ts`) plus supporting tools. Several of the pages behind these links are also too long to read in one scroll (`wacc/page.tsx` 776 lines, `business-case/page.tsx` 450, `dd/page.tsx` 432, `deal-structure/page.tsx` 405, `portfolio/page.tsx` 405, `ic-review/page.tsx` 335).

## Review

Before implementing, the plan was reviewed by ux-designer-agent, design-system-agent, and frontend-engineer. Key findings that changed the approach:
- `StageFrame.tsx` already renders the full S1-S12 `StageRail` (ADR-0086) on 10 of the 23 sub-pages — building a second stage-rail inside `ProjectSubNav` would duplicate an ADR-governed component. The real gap is narrower: `ProjectSubNav`'s own list has no internal structure.
- `docs/design-system/design-guide.md`'s Component Standard table names `Tabs | .tab-nav / .stage-stepper` as the canonical in-page tab pattern; `dd/page.tsx` already hand-rolled it once but nothing reused it, while `opportunities/[id]/page.tsx` uses a second, undocumented `.library-tab*` style.
- `wacc/page.tsx` is a sequential CAPM/WACC calculation where later values depend on earlier ones — tab-hiding earlier steps would break auditability. Excluded from the tab-splitting phase.

## Approach

1. **Phase 1** (this PR): shared `TabNav` component (`components/TabNav.tsx`) formalizing `.tab-nav`; `dd/page.tsx` migrated as first consumer.
2. **Phase 2** (this PR): `ProjectSubNav` groups its existing 23 links under stage headings (S8-S12 + a `tools` group), no route changes.
3. **Phase 3** (follow-up PRs): split `business-case/page.tsx`, `deal-structure/page.tsx`, `portfolio/page.tsx`, `ic-review/page.tsx`, `partnership/page.tsx` into in-page `TabNav` tabs based on existing section boundaries, with the active tab synced to a URL query param.

## Verification

- `bunx tsc --noEmit` clean.
- Live browser check (project `01M2D1NXWKW05PQS4RTVFSWDW1`, visible to the test session): `ProjectSubNav` renders six labeled clusters with correct active-link highlighting; `dd/page.tsx`'s Commercial/Technical/Legal domain tabs switch correctly via the new `TabNav` with no console/parse errors.
