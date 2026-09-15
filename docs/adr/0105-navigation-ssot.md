---
lang: ko
lang_reason: source-material
---

# ADR-0105: Navigation SSOT — menu registration and order as an enforced contract

- Status: Accepted
- Date: 2026-09-04
- Deciders: New Business Review Lead (PM), per user direction
- Related: ADR-0091 (role-screen separation), docs/designs/2026-09-01-standard-screen-patterns-design_ko.md

## Context

The sidebar menu was hardcoded JSX in AppShell. Consequences observed in the
2026-09-04 review: new standard screens shipped without any menu entry
(e.g., /projects/[id]/process, /pipeline), section order drifted with nothing
detecting it, and the screen-patterns design doc contained no navigation
governance at all — nothing forced "developed screen → linked in web + menu".

## Decision

1. `app/web-next/lib/navigation.ts` is the single source of truth for the web
   menu: NAV_SECTIONS (탐색/분석·참조 sections, in flow.spec stage order),
   ADMIN_NAV (ADR-0091 role separation), NON_MENU_ROUTES (explicit escape
   hatch: auth surfaces, StageRail-reached /process/[stage], project detail
   sub-flows).
2. AppShell renders only from this file; icons are a local href→icon map.
3. tests/unit/navigation.test.ts enforces: page↔menu parity (every page.tsx
   route is registered or explicitly allowlisted — orphans fail), menu hrefs
   resolve to real pages, no unintended duplicate hrefs, 탐색 order matches
   the flow.spec stage sequence, and AppShell has no local NAV_SECTIONS copy.
4. New standard screens MUST be registered in navigation.ts in the same PR
   that adds the page; the parity test makes omission impossible to merge.

## Consequences

- Menu order is now reviewable as data; reordering is a one-line SSOT change.
- The design doc's screen-pattern mandate gains its missing enforcement half.
