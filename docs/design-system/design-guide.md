---
governance_doc_id: gov-des-00
layer: docs-content
title: "Design Guide — Onyx 3.0"
scope: co-newbiz
owner_agent: design-system-agent
version: "1.0.0"
lang: en
counterpart: design-guide_ko.md
---
# Design Guide — co-newbiz Onyx 3.0

> **Status**: v1.0 — the design policy of record for the web app
> (`app/web-next`). Derived from co-price's `docs/design.md` (UI/UX Design
> System v6.0) and adapted to co-newbiz's deal-review domain. The runtime
> tokens live in `app/web-next/app/styles.css`; this document is the spec the
> tokens implement. `bun run design:lint` enforces the mechanical rules.

---

## 1. Design Philosophy

1. **Clarity-first** — every screen answers "what am I looking at, what can I
   do, what happens next" within one glance. Dense but never cramped.
2. **Evidence-driven** — numbers, sources, and provenance are first-class.
   Financial figures use `JetBrains Mono` with `tabular-nums`; every material
   value links to its evidence (source tooltip / anchor_ref).
3. **Stage-guided** — the UI reflects the S1–S7 process: the user is always
   shown where the deal stands and what the current stage requires.
4. **Agentic-first, Human-final** — agents execute and recommend; the UI is a
   workbench for reviewing agent output. Human input is confirmation and
   correction, not data entry from scratch.
5. **Trust through consistency** — identical semantics render identically
   everywhere (RAG colors, status chips, gate badges, date/number formats).
6. **Accessible by default** — WCAG AA contrast, visible focus, status never
   conveyed by color alone (icon + label + color).

## 2. Design Principles (operating rules)

| # | Principle | Rule |
|---|---|---|
| P1 | Definition-driven UI | Screen structure comes from `process/flow.spec.yaml`; no stage hardcoding in components |
| P2 | Light default, dark equal | `:root` is light; `[data-theme="dark"]` is a first-class equal theme. Never hardcode white/black — use tokens |
| P3 | One source per fact | A value is rendered from its persisted record, never recomputed in the UI |
| P4 | Write paths are explicit | Every create/update/delete has a form/dialog, an audit trail, and visible success/failure feedback |
| P5 | Signals are multi-encoded | Status = color + icon + text (signal lights: ● done / ◐ current / ○ pending / ✕ terminated) |
| P6 | Derived state is computed | `currentStage` and similar are calculated (evaluateProcess), never stored or hand-edited |

## 3. Color System (HSL semantic tokens)

All colors live as CSS custom properties in `styles.css`. Hardcoded hex/rgba
values in components are lint errors (`design:lint`).

### 3.1 Base (light `:root` / dark `[data-theme="dark"]`)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f6f7f9` | `#0a0c10` | page background |
| `--surface` | `#ffffff` | `#12151b` | cards, panels |
| `--surface-2` / `--surface-elevated` | `#f1f3f6` / `#ffffff` | `#181c24` / `#1a1f2a` | raised content |
| `--fg` / `--muted-fg` | `#171a21` / `#5d6572` | `#eceef2` / `#9aa1ad` | text hierarchy |
| `--border` (+`-subtle`, `-bright`) | rgba(16,22,34,…) | rgba(255,255,255,…) | separation scale |
| `--primary` | `hsl(217 91% 45%)` | `hsl(217 91% 60%)` | actions, links, active nav |

### 3.2 Status colors (never color-only)
| Token pair | Meaning | Always paired with |
|---|---|---|
| `--green-bg/fg/border` + `status-green` | pass / GO / complete | ✓ or ● icon + label |
| `--amber-bg/fg/border` + `status-amber` | hold / stale / warning | ⚠ or ◐ icon + label |
| `--red-bg/fg/border` + `status-red` | fail / kill / error | ✕ or ● icon + label |
| `status-not-started` | pending / locked | ○ icon + label |

### 3.3 Derived interaction tokens
`--input-bg`, `--hover-bg`, `--sidebar-bg`, `--placeholder-fg`,
`--scrollbar-thumb(-hover)`, `--glass-bg`, `--glass-inset` — one definition per
theme; components reference tokens only.

## 4. Typography

| Role | Font | Size / Weight | Notes |
|---|---|---|---|
| Page title (h1) | Pretendard | 1.25–1.5rem / 800 | one per page |
| Section title (h2/h3) | Pretendard | 1–1.15rem / 700 | |
| Body | Pretendard | 0.85–0.9rem / 400 | line-height ≥ 1.55 |
| Sub-label / meta | Pretendard | 0.72–0.8rem | `--muted-fg`, uppercase for column headers |
| Financial figures | JetBrains Mono | any / 700 | `tabular-nums`, KRM unit label nearby |
| Code / IDs | JetBrains Mono | 0.72–0.8rem | `code` element |

Spacing follows an 8px base grid (`0.25rem` steps): card padding 16–24px,
list gaps 8–10px, section separation 24px+.

## 5. Layout Architecture

- **App shell**: collapsible sidebar (S1–S7 phase groups, admin section) +
  topbar (menu toggle leftmost only while the sidebar is hidden; theme
  toggle, user, logout right) + scrollable content pane. Two
  platform-typical modes driven by the `data-sidebar-state` attribute on
  `.app-shell`:
  - **Desktop — push collapse**: `docked` (sticky, `--sidebar-width`) ⇄
    `closed` (in-flow `width → 0`, content reflows in sync — no scrim, no
    overlay). Collapse preference persists in localStorage (`"cn-sidebar"`).
  - **Mobile (≤880px) — overlay drawer**: `open` (fixed panel slides in over
    a fading `.drawer-backdrop` scrim, ESC/backdrop/route-change close,
    focus trap via `useModalFocus`) ⇄ `closed` (off-canvas + `inert`).
  - **Toggle dual-home**: the collapse control lives in the sidebar header
    (`.sidebar-head`) while the sidebar is visible; the topbar button
    (`.topbar-icon-btn`) appears only when the sidebar is hidden. Both are
    quiet **outline** icon buttons (1px border, transparent fill,
    full-contrast icon) — more discoverable than a ghost, calmer than the
    one-shot action pills.
- **Content width**: the content pane fills available width (`max-width: none`)
  — centered max-width variants caused the squeezed-column defect and are
  removed. Dense tables may span the full pane.
- **Deal detail** is stage-guided: sticky progress header (S1–S7 signal lights
  + gate badges) above the tab bar; the Workflow tab is the default.
- **Responsive**: ≤880px the sidebar is drawer-only (the old horizontal icon
  strip is retired); grids collapse to 1 column.

## 6. Component Standard

| Component | Spec |
|---|---|
| Card | `.card` / `.glass` — surface + border + radius-3xl, hover lift ≤4px |
| Button | `.btn-primary` (primary action, one per view — the class `PrimaryAction` renders; `.btn-premium` is a DEPRECATED alias with 2026-10-22 review — migrate its remaining call sites, do not use in new code), `.btn-ghost` (secondary), destructive = confirm dialog required |
| Table | `.data-table` — border-b rows; **header cells centered by default** (`.data-table th`), body cells left-aligned, numeric columns right via `.col-num` (header+cell); wide tables wrapped in `.table-scroll` with `min-width`; `tabular-nums` for figures, `caption.sr-only`. Header alignment exceptions are per-column overrides only — never re-left the default |
| Badge / chip | `.status-chip status-*` — icon + text, never color-only |
| Form control | token background/border, focus ring `--primary` 3px, label mandatory |
| Tabs | `.tab-nav` / `.stage-stepper` — `aria-current`, state preserved in URL |
| Modal | `.modal-backdrop` + `.modal-panel` — ESC/backdrop close, focus trap |
| Sidebar drawer | `.app-sidebar` under `data-sidebar-state` — desktop push collapse (width → 0, no scrim); mobile overlay + `.drawer-backdrop` with the ESC/backdrop/focus-trap contract; `inert` when closed |
| Signal light | `.process-light pl-*` — icon + stage id + status label |

## 7. Accessibility

- Contrast ≥ AA (light theme tokens are tuned for it; verify with design:lint
  report).
- Every icon-only control carries `aria-label`; every table a `caption.sr-only`;
  status conveyed by icon+text+color together.
- Focus is always visible (focus ring token); dialogs move focus and restore it.

## 8. Design Lint (mechanical enforcement)

`bun run design:lint` (scripts/co-newbiz/design-lint.ts) fails CI on:
- hardcoded hex/rgba colors in `components/**` and `app/**` (outside
  styles.css token definitions),
- `onInput=` handlers (Korean IME composition bug),
- `<main>` nesting inside `.app-content`,
- icon-only buttons without `aria-label`,
- `window.confirm`-less delete handlers on `api.delete` calls.
