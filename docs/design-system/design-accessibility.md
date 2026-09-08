---
governance_doc_id: gov-des-05
layer: docs-content
title: "Accessibility · Universal Design"
scope: co-newbiz
owner_agent: design-system-agent
version: "1.0.0"
effective_from: "2026-09-05"
lang: en
counterpart: design-accessibility_ko.md
---
# Screens must work for everyone, without exception

Accessibility (universal design, UD) means "making it so that even people with disabilities, or people working on particular devices or in particular environments, can use the screen on equal terms with everyone else." People who cannot use a mouse, people who have trouble distinguishing colors, people who use screen readers, and people who feel dizzy from moving visuals must all be included — this is something to take care of from the design stage onward, so that no one is excluded. At co-newbiz, this is not "something to consider later if there is spare time" but a **shipping condition** that every screen must satisfy before deployment. The six rules below were confirmed at the 2026-09-05 accessibility audit.

1. **Everything must be operable with the keyboard alone** — without a mouse, every button and menu on the screen must be reachable using only the keyboard (Tab, arrow keys, Enter, etc.). There is always a clearly visible outline showing which element currently has focus.
2. **Tables must have their structure read out** — screen readers used by visually impaired users convey tables through sound, not sight. Tables get a caption and each header is explicitly associated with the cells it covers, so that when heard through a screen reader it is clear "which row and column this number belongs to." In addition, header and cell alignment must always match within each column, so the table also looks visually tidy.
3. **Status must never be conveyed by color alone** — if status depends only on color ("red = failure, green = success"), color-blind users cannot tell them apart. That is why status badges always pair the color with a text label such as "Success" or "Fail".
4. **Do not demand excessive motion** — screens that constantly move or auto-advance slides can cause dizziness or discomfort for some users. When a user has enabled "reduce motion" in their system settings, we respect it — for example, by replacing an animated background image on the login screen with a static one.
5. **Icon-only buttons must have names** — a button with only an icon and no text (e.g., a trash-can shape) sounds like just "button" to a screen reader user. So such buttons must always carry a hidden name (aria-label) such as "Delete", making it clear what the button does.
6. **Ensure sufficient contrast between text and background** — body text must maintain a contrast ratio of at least 4.5:1 against the background. Users with low vision, or users viewing the screen in bright light, must be able to read the text; this is verified in both the light theme and the dark theme — mechanically: `bun run contrast:check` (CI-wired) computes WCAG contrast over the token pairs of `app/web-next/app/styles.css` in both themes and fails below 4.5:1.

## 🌐 External Reference — Industry design system and accessibility standards

- The standard is to name tokens by **what they are used for**, not by the color value itself (e.g., `color-text-primary`) — Material Design 3, https://m3.material.io/foundations/design-tokens (accessed 2026-09-05)
- Contrast ratios cannot be guaranteed by the numbers written in a design document alone; there are arguments that they must be verified at runtime, in the actual screen, that the color combination is implemented as specified —
  https://medium.com/@SaraTariqMustafa/design-tokens-dont-fix-accessibility-they-can-hide-it-dc07534864e6
  (accessed 2026-09-05)
- Contrast requirements of the international web accessibility standard (WCAG 2.1): 4.5:1 for normal text, 3:1 for large text —
  https://www.w3.org/TR/WCAG21/ (accessed 2026-09-05)

## Source Mapping

| Claim | Basis |
|---|---|
| Items 1–5 | 2026-09-05 UD audit remediation (PR #219 series), ui-spec as-built |
| Contrast requirements | W3C WCAG 2.1 (external reference above) |
