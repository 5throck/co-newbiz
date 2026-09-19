---
lang: ko
lang_reason: source-material
---

# Sidebar Drawer (collapsible side menu)

- Spec ID: `2026-09-17-sidebar-drawer`
- Date: 2026-09-17
- Status: implemented

## Problem

The app sidebar was permanently docked at a hardcoded 264px (`styles.css`
`.app-sidebar`), so on narrow windows it consumed reading width with no way
to collapse it. The only responsive behavior (≤880px) turned the sidebar
into a horizontal icon strip that hid labels, group headings, and submenu
structure — poor navigation on mobile. The user asked for a drawer-style
collapse, and chose (1) full-hide drawer with a slide-in overlay and
(2) unifying mobile on the same drawer instead of the icon strip.

## Design

Three visual states derived in `AppShell.tsx` from two pieces of React state
plus one media query; CSS reads a single attribute and nothing else:

| State | Trigger | Sidebar placement |
|---|---|---|
| `docked` | desktop, not collapsed | sticky 264px in flex flow (unchanged) |
| `open` | collapsed or mobile, drawer toggled on | `position: fixed`, overlays content (z-index 61, above `.modal-backdrop` 60, below `.toast-region` 80) with `.drawer-backdrop` behind |
| `closed` | collapsed or mobile, drawer toggled off | `position: fixed` + `translateX(-100%)`; content takes full width because the sidebar leaves the flow |

- **State ownership**: `collapsed` (persisted to localStorage `"cn-sidebar"`,
  same pattern as `cn-theme`) + `drawerOpen` (transient) + `isMobile`
  (`matchMedia("(max-width: 880px)")` listener). The derived state is exposed
  as `data-sidebar-state="docked|open|closed"` on `.app-shell`. Unlike the
  theme, no pre-paint inline script is needed: the sidebar renders only after
  the auth check resolves, so the mount-time sync always finishes first.
- **Toggle cycle**: topbar `topbar-icon-btn` (leftmost, `PanelLeftClose` /
  `PanelLeftOpen` icons, `aria-expanded` + `aria-label` per design-lint):
  docked → collapse; closed → open drawer; open → close drawer, and on
  desktop return to docked (un-collapse). Mobile has no docked mode, so it
  only toggles open/closed. The drawer also closes on route change
  (`useEffect` on `pathname`), backdrop click, and Escape.
- **Accessibility**: reuse of the ADR-0082 dialog conventions — the drawer
  renders inside `.modal-backdrop` (alignment-neutralized by
  `.drawer-backdrop`) with `useModalFocus` (focus trap, Escape, focus
  restore) mounted only while the overlay exists, so the docked sidebar and
  the drawer share the exact same `<Sidebar/>` JSX. When closed, the aside
  is `inert` (React 19 boolean prop) and `visibility: hidden` after the
  slide-out transition — belt and suspenders against focus/tap leakage.
- **Navigation data untouched**: `lib/navigation.ts` stays the SSOT
  (ADR-0105); `tests/unit/navigation.test.ts` keeps passing because the
  AppShell import and structure constraints are preserved.

## Trade-offs accepted

- Docked → closed transition animates the sidebar sliding out but the
  content width snaps instantly (the sidebar leaves the flow) — accepted;
  animating content width is janky for tables and charts.
- No body scroll lock while the drawer is open — consistent with existing
  modals in this app, which do not lock scroll either.
- Mobile loses the always-visible icon strip in exchange for full-width
  content and full menu structure inside the drawer — the point of the
  change.

## Revision (2026-09-17) — standard drawer-pattern alignment (UI review)

First-pass implementation opened the drawer over the content on BOTH desktop
and mobile with a single 3-state toggle cycle (docked → closed → open →
docked). UI review against standard drawer patterns found four defects and
the interaction was re-designed as two platform-typical modes:

1. **Content snap on collapse** — the sidebar left the flex flow
   (`position: fixed`) and slid *over* the content while the content width
   snapped instantly. Fixed: desktop collapse now keeps the sidebar in flow
   and animates `width: 264px → 0` (`--sidebar-width` token), so the content
   reflows in sync — the standard persistent-drawer push transition (MUI
   persistent / GitHub / GitLab). No scrim, no overlay on desktop.
2. **Non-standard 3-state toggle cycle** — replaced with the conventional
   direct 2-state toggle: desktop collapse ⇄ expand; mobile open ⇄ close.
3. **Scrim popped with no fade** — the mobile scrim now stays mounted while
   `isMobile` and fades via `opacity` + `pointer-events` driven by
   `data-sidebar-state`; `useModalFocus` gained an `active` gate (backward
   compatible) so the focus trap engages only while the drawer is open.
4. **Toggle button buried under the scrim** — on desktop the scrim no longer
   exists (push mode); on mobile the standard modal-drawer dismissal
   (scrim tap / Esc / nav link) applies.

Also added `prefers-reduced-motion: reduce` support (drawer transitions
disabled) and `white-space: nowrap` on nav labels so the desktop collapse
clips like a curtain wipe instead of re-wrapping text mid-animation.
Focus trap/restore, Escape close, route-change auto-close, inert-when-closed,
and the `cn-sidebar` persistence are unchanged.

## Revision 2 (2026-09-17) — toggle dual-home + ghost restyle (UI review)

Follow-up UI review of the toggle button found two issues: it carried the
same visual emphasis as one-shot actions (bordered pill, like theme/logout),
and while the sidebar was docked its control sat outside the sidebar it
controls. Fixed with the Notion/Slack/Linear dual-home convention:

- The collapse button lives in the sidebar header (`.sidebar-head`, next to
  the brand) while the sidebar is visible.
- When the sidebar is hidden (collapsed on desktop, always on mobile), the
  control moves to the topbar (`.topbar-icon-btn`) — the two are never
  visible at the same time; the topbar one renders only when
  `sidebarDocked` is false.
- Both are quiet **outline** icon buttons (1px `--border`, transparent
  fill, full-contrast `--fg` icon, `--radius-md`), icon 20px, ≥2.25rem
  touch target (topbar variant 2.5rem); hover adds `--hover-bg` and
  `--border-bright`. Calibration trail: the initial bordered pill carried
  the same emphasis as one-shot actions, the first ghost restyle was too
  hard to discover — the outline style sits between the two (MUI outlined
  icon-button territory). The brand's bottom border moved from
  `.sidebar-brand` to the `.sidebar-head` row.

## Verification

- `bunx tsc --noEmit` (app/web-next) — clean.
- `bun run lint:design` — no hardcoded colors in TSX, icon-only toggle has
  `aria-label`.
- `bun run test:unit` — `navigation.test.ts` AppShell source checks intact.
- Manual: desktop collapse animates as a push (content grows in sync, no
  scrim), expand restores; ≤880px opens a slide-in overlay with fading scrim,
  scrim tap/Esc/nav-link close; state persists across reload; admin variant
  identical; dark theme and reduced-motion visual check.
