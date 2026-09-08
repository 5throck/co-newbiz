---
governance_doc_id: gov-des-02
layer: docs-content
title: "Design Guide — Tokens, Typography, Spacing"
scope: co-newbiz
owner_agent: design-system-agent
version: "1.0.0"
effective_from: "2026-09-05"
lang: en
counterpart: design-tokens_ko.md
---
# Why colors, typography, and spacing are never hard-coded in screen code

If you write a raw color value into screen code — "this button is blue" — then later, when the brand color changes or dark mode needs to be supported, you have to hunt down and fix hundreds of screens one by one. So co-newbiz pre-defines values such as colors, spacing, and font sizes as labeled variables called **design tokens**, and screen code only ever references those labels.

The single source of truth for these tokens is `app/styles.css`, used by the actual product screens (`app/web-next`), and `docs/design-system/design-guide.md` is the written record of that design intent. This `/library` screen you are reading now also loads the very same `app/styles.css` directly, exactly like every other app screen (ADR-0108 — the separately built documentation portal is gone and the app itself is the only rendering surface), so there is no separate "color matching" work to do at all — these are the same screens looking at the same CSS in the first place.

## Color tokens

Token names describe "where the value is used," not "what color it is." For example, `--accent` does not mean "blue"; it means "the color used wherever emphasis is needed" — so even if the brand color changes later, the name stays the same and changing only the value propagates it across all screens.

| Token | Purpose |
|---|---|
| `--bg`, `--fg`, `--surface`, `--surface-2`, `--surface-elevated` | Base background, body text, and the 3-level surface elevation (panel / subtle-fill / elevated) |
| `--muted-bg`, `--muted-fg` | Muted fill and secondary explanatory text |
| `--border`, `--border-subtle`, `--border-bright` | Border colors — default / subtle divider / emphasized outline |
| `--primary` (+ `--primary-h/s/l` channels, `--primary-dim/-bg/-border`) | The brand/emphasis color, defined over HSL channels so variants derive with dynamic opacity |
| `--accent`, `--accent-fg` | Emphasis color for elements the user interacts with (links, the currently selected tab). `--accent-fg` is the foreground used **on** accent backgrounds — `#ffffff` in light theme — so accent-filled buttons keep 4.5:1 contrast |
| `--success`, `--warning`, `--danger` (+ `-bg` variants) | Status colors for approval/caution/risk signals |
| `--green-bg/-fg/-border`, `--amber-*`, `--red-*` | RAG grade chip colors (light- and dark-tuned pairs) |
| `--input-bg`, `--hover-bg`, `--sidebar-bg` | Theme-scoped interaction surfaces (no hardcoded whites/blacks) |

When building screens, colors must be specified only through these tokens; raw color values like `#0000FF` are never written into code. The product screens switch light/dark via the `[data-theme="dark"]` attribute, while this documentation portal switches in three steps: `:root` (default) → `prefers-color-scheme` (auto-detected device setting) → `.dark` (manually enabled by the user) — the trigger for switching differs between the two screens, but the resulting color values themselves are kept identical.

## Font sizes and spacing

- Body text is 15px with 1.65× line height, secondary explanations are 14px, and the smallest labels (micro text) are 12px — these size differences are what let the screen communicate "is this a heading, body text, or a side note?"
- Spacing follows an 8px rhythm (8/16/24/32) — spacing values are utility literals on the 8px grid rather than a spacing token; arbitrary numbers (e.g., 13px, 17px) are avoided so margins keep a steady rhythm across screens.
- Corner radius uses the token scale — `--radius-sm`, `--radius-md` (0.625rem), `--radius-lg`, and `--radius-full` (pills/circles) — never a raw px value; `--radius-md` is the default for interactive controls (buttons, inputs, chips).
- Amounts are written as integers without decimals, in units of a million KRW, with commas every three digits (e.g., 9,000). This notation is standardized across all screens.

## 🌐 External Reference — How design tokens are managed in the industry

As of 2026, the industry standard is the W3C-defined common format (the specification that solved the problem of design tools and code exporting tokens in incompatible formats) together with a three-tier structure of **raw value → semantic name → component-specific value**. For example, layering `blue-500` (raw value) → `action-color` (semantic name) → `button-bg-primary` (button-specific value) means changing a single value propagates cleanly to every screen that references it. co-newbiz's `--bg`/`--fg`/`--border`/`--accent` system already follows the "purpose-based semantic naming" tier and is in line with this trend. The industry also recommends starting small, with roughly 30–50 tokens, and treating token changes with the same weight as a breaking shared-API change. For sources and details, see [docs/research/design-token-architecture.md] (surveyed 2026-09-05).

## Source Mapping

| Claim | Basis |
|---|---|
| Token list | app/web-next/app/styles.css, docs/design-system/design-guide.md |
| Amount notation | ADR-0061 (dd value_impact units), 2026-09-05 design cleanup PR #219 |
| Token architecture practice | docs/research/design-token-architecture.md |
| Single rendering surface (no separate theme sync needed) | ADR-0108, app/web-next/app/library/page.tsx |
