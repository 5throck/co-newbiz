---
lang: ko
lang_reason: source-material
---

# ADR-0083: Visual UI standard — toolbar structure, two button sizes, delete hierarchy

**Status**: Accepted — implemented in the same change (`components/layout.tsx`, `app/styles.css`, page refactors)
**Date**: 2026-09-01
**Deciders**: user (standing directive), frontend-engineer (implementation), design-system-agent (review)
**Design of record**: `app/web-next/components/layout.tsx` (`PageHeader`, `SectionToolbar`, `RowActions`), `app/styles.css` (`.section-toolbar`, `.btn-sm`)

## Context

ADR-0082 unified CRUD semantics (labels, confirm flow, edit mode), but visual composition
still varied per page because each page hand-built its headers and action cells. Observed
inconsistencies: the 등록 button sat at the far right on some sections and next to the
search box on others; row-action buttons mixed 2–4 different paddings/font sizes within one
row; the delete button carried the highest visual weight in each row (solid red pill); and
the market header interleaved title, search, create button, and five status chips in an
ad-hoc flex row (with a ResizeObserver hack to align chips to the last button column).

## Decision

1. **Section header is a component, not a layout choice.** `SectionToolbar` fixes the
   structure: title group (icon + h2 + count) on the left, optional filter slot next to it,
   optional summary slot and actions slot on the right. The primary action (등록) always
   renders in the rightmost actions slot at toolbar size. Pages must not build ad-hoc
   `flex … margin-left:auto` header rows.
2. **Exactly two control sizes.** Default (`btn-ghost`/`btn-danger`) for toolbar actions;
   `.btn-sm` (padding 0.3rem 0.75rem, 0.75rem font) for everything inside tables, rows, and
   inline edit strips. Ad-hoc `text-[0.xxrem]` size overrides on buttons are retired; the
   `.sizing-actions-cell` is a right-aligned flex with a fixed 0.5rem gap.
3. **Delete de-emphasized until hover.** `.btn-danger.btn-sm` renders as a low-saturation
   outline; full danger color appears on hover/destructive confirm. A destructive action
   must never be the most visually prominent button in a row.
4. **PageHeader** fixes the h1 + description pattern; page-level heading typography no
   longer varies.
5. The market status-chip alignment ResizeObserver hack was removed — chips live in the
   toolbar's summary slot, so measuring table geometry for header alignment is unnecessary.

## Consequences

- All list surfaces now share one header skeleton and one action-cell skeleton; visual
  drift requires overriding the components rather than accumulating silently.
- Buttons keep their ADR-0082 labels; this ADR governs size, spacing, placement, and
  hierarchy only. Domain verbs (분석/재분석/제외) remain.
- Pages not yet migrated keep compiling but should be converted when touched; the three
  reference implementations are market, opportunities, and our-company.
