---
name: design-lint
scope: co-newbiz
description: >
  Mechanical enforcement of the Onyx 3.0 design system - detects hardcoded
  colors in components/screens, onInput leftovers (Korean IME composition
  breaks), icon-only buttons missing aria-label, and nested <main> inside
  .app-content. Use when: "design lint", "UI consistency check",
  "hardcoded colors".
version: 1.0.0
last_reviewed: "2026-08-30"
status: active
owner: design-system-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - design lint
    - UI consistency
---

# Design Lint

Run with `bun scripts/co-newbiz/design-lint.ts`. Checks:

1. **Hardcoded colors** - hex/rgba directly in components/app tsx are forbidden
   (styles.css token definitions are the only exception).
2. **onInput leftovers** - Korean IME composition corrupts values mid-typing;
   onChange only.
3. **Nested <main>** - pages must not re-declare <main> inside AppShell's
   app-content pane.
4. **Icon-only buttons** - must carry an aria-label.

Non-zero exit on violations. New violation types are added to this skill and
to design-lint.ts together.
