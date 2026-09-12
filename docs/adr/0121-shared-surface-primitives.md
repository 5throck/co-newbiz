# ADR-0121: Shared surface primitives — PageState, Toast, DataTable, Tabs

- Status: Accepted
- Date: 2026-09-12
- Deciders: New Business Review Lead (PM)
- Deciders note: the 2026-09-12 UI audit found 27 hand-written "불러오는 중..." text swaps, 45 one-off red `role=alert` paragraphs, no shared table or tabs primitive (16 tables on one page, thead drift policed only by lint rule R9), and 727-line single-scroll pages. Component-level abstraction is the missing layer between the token registry (ADR-0087) and the screen patterns (ADR-0086); these four primitives fill exactly that layer without introducing any UI dependency.
- Related: ADR-0086 (pattern inventory — extended by this ADR), ADR-0087 (tokens-first process — these are declared in design-tokens.json v1.2.0 first), ADR-0088 (report data presentation — DataTable encodes it), ADR-0082/0083 (CRUD + visual standard — unchanged), ADR-0119 (chip/button vocabulary), ADR-0120 (workspace consumes these primitives)

## Context

Every one of the 47 pages is a single-file client component that rolls its own
loading text, error paragraph, thead/tbody, and (rarely) tabs. The purpose-built
loading component from the previous stack (`EnginePendingPanel`) is dead code,
and `styles.css` still carries ~500 lines of classes for screens that no longer
exist. Progressive disclosure has no standard mechanism, so pages stack every
section in one scroll.

## Decision

1. **PageState** — one surface for loading (skeleton shapes matching the
   content's outline), empty (one muted sentence + exactly one next-action
   link), and error (`role=alert` + one retry control). Replaces ad-hoc
   `불러오는 중...` swaps and top-of-page alert paragraphs; nested sections may
   use section-scoped PageState instead of a page-wide error line.
2. **Toast** — a small status/alert queue for mutation outcomes
   (role=status success, role=alert failure, auto-dismiss ~4s, manual close).
   Decisions recorded by humans (gates, adoption, promotion, charter confirm)
   always confirm via toast IN ADDITION to any inline update, so the result of
   a boundary-#2 human action is never silent.
3. **DataTable** — the shared table primitive with ADR-0088 presentation
   defaults built in (centered headers, left body, right-aligned `.col-num`,
   `.table-scroll` wrapper, `caption.sr-only`). New screens use it by default;
   hand-written theads remain legal only where a genuinely bespoke layout
   justifies it (design-doc documented).
4. **Tabs** — the shared tab strip with `role=tablist`, `aria-current`, and URL
   query state (`?tab=`), keeping within the 3-depth navigation ceiling of
   ui-spec §1. It is the standard progressive-disclosure mechanism for stage
   pages (e.g., S4 권고/채점/결정/게이트; WACC steps; S11 패키지/게이트).
5. **No new dependencies** — all four are thin React components over the
   existing Onyx token vocabulary; no component library is adopted.
6. **Cleanup rides the same wave**: dead `DataTab.tsx`, `EnginePendingPanel.tsx`,
   and the legacy `styles.css` screen blocks are deleted in the phase that
   lands these primitives.

## Consequences

- Pages shrink from monoliths to compositions; density and feedback become
  uniform without per-page discipline.
- ADR-0086's pattern inventory (P0–P5) is extended by these primitives as
  named slots — new patterns still enter through design-doc revision, and
  design-lint gains a rule against new raw `불러오는 중...` text nodes once the
  primitives land.
