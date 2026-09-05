---
name: ui-information-architecture
scope: co-newbiz
description: >
  Designs and reviews SPA screens against `docs/architecture/ui-spec.md`'s non-
  negotiable rules: source tooltips from the API envelope's `meta` block
  (never hand-typed), color never the sole differentiator for RAG status,
  no "PASS" stamp anywhere, glossary tooltips on registered terms,
  3-depth navigation maximum, dark mode, tablet-responsive layout.

  Use when: "new SPA screen", "UI design review", "3-depth navigation",
  "RAG display contract", "source tooltip".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: frontend-engineer
prerequisites: none
relates_to:
  - skill: access-control-review
    type: composes_with
metadata:
  type: implementation
  triggers:
    - new SPA screen
    - UI design review
    - 3-depth navigation
    - RAG display contract
    - source tooltip
---

## Context

Wave 5.6B already implements this discipline for the screens it built
(`app/web/src/`) — this skill is the design/review standard for any new
screen, including the deferred financial charts, proxy-chain diagram,
simulation histogram, and other screens explicitly out of Wave 5.6B's
scope pending their backing API endpoints. The routing bug Wave 5.6B found
and fixed (a global middleware accidentally intercepting the SPA shell) is
a reminder that "it renders in isolation" isn't sufficient verification —
real browser navigation through the actual server is the bar.

## When to Use

- Designing or reviewing a new SPA screen or component
- Confirming an existing screen's accessibility/display-contract compliance

## Execution Steps

1. **Every numeric figure needs a source tooltip** sourced from the API
   response envelope's `meta` block (`assumption_key`, `as_of`, `source`,
   `anchor_ref`) — never hand-typed text approximating the source
2. **RAG status**: icon + label + color together, never color alone
   (`RagSignalCard`'s existing pattern) — verified against
   `accessibility-audit`
3. **No "PASS" stamp**: verified / could-not-verify / needs-judgement
   split, matching `agent-output-provenance`'s design intent
4. **Glossary tooltips**: dashed-underline, click/hover popover, on any
   registered term in body text (`GlossaryTerm` component's existing pattern)
5. **3-depth navigation maximum**: use client-side tab state for
   within-page sections (as `ProjectDetail`'s tabs already do), not nested
   routes, to stay within the cap
6. **Dark mode and tablet-responsive**: CSS custom properties for
   light/dark (existing `styles.css` pattern), responsive down to tablet width
7. **Verify in a real browser** against the actual running server — not
   just that the component renders in isolation

## Output Format

- New/reviewed screen meeting the display-contract checklist above

## Related Skills

- `rest-api-design` — the envelope shape this UI's tooltips depend on
- `accessibility-audit` — the WCAG verification this screen must pass
