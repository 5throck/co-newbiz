---
lang: ko
lang_reason: source-material
---

# ADR-0082: Unified CRUD interaction pattern for web surfaces

**Status**: Accepted — implemented in the same change (`components/crud.tsx`, page refactors)
**Date**: 2026-09-01
**Deciders**: user (standing directive), frontend-engineer (implementation), platform-lead (review)
**Design of record**: `app/web-next/components/crud.tsx`, `app/web-next/app/styles.css` (`.sizing-new-form`, `.sizing-new-input`, `.btn-danger`, `.row-edit-cell`)

## Context

An audit of the web surfaces (market, opportunities, our-company, synergy, brownfield,
greenfield, admin) found five different create-form styles, four delete-confirm styles
(`window.confirm`, required-text input, none), and inconsistent button labels and styles
(6 create labels, 4 delete labels — 삭제/제거/✕/기각 — and mixed `btn-ghost`/`btn-premium`/
undefined `btn-primary`). The shared components in `components/ui/` were never imported, and
`sizing-new-form`/`sizing-new-input` classes had no CSS definitions at all. The result was
unpredictable interaction: the same mental action (add/edit/remove a record) required
re-learning on every page.

## Decision

One CRUD interaction model, implemented once in `components/crud.tsx` and applied to all pages:

1. **Create** — a toggle button `＋ ~ 등록` in the section header opens an inline form
   (`.sizing-new-form`); the submit button is uniformly `등록`, the secondary is `취소`.
   The synergy page's registration modal is retained as a recorded exception (its form
   carries multi-section data density an inline strip cannot hold), but uses the same
   labels and button styles.
2. **Edit** — row-inline edit mode only: the row's `수정` action converts the cell/row to an
   input with `저장`/`취소` (Enter saves, Escape cancels). Standardized in `RowEdit`.
   No modal-vs-inline split: one rule, one muscle memory.
3. **Delete** — label is uniformly `삭제` (제거/✕/기각 as delete labels are retired),
   styled `btn-danger`, always the last action in a row, and confirmed through the shared
   `ConfirmDialog` (portal, target name in the title, consequence sentence in the body)
   via the `useConfirm()` hook. `window.confirm` is no longer used anywhere.
4. **Button vocabulary** — two visual variants: `btn-ghost` (default actions) and
   `btn-danger` (destructive). `btn-premium` remains admin-console-only presentation, not a
   CRUD semantic. Domain verbs that are not CRUD (분석/재분석/제외/평가 저장) keep their
   domain labels — the standard governs create/edit/delete of records only.
5. CSS for `.sizing-new-form`, `.sizing-new-input(-sm)`, `.btn-danger`, `.row-edit-cell` is
   now defined in `styles.css`; previously semantic-only classes gained real rendering.

## Consequences

- Every list/table surface now behaves identically for add → edit → remove; training and
  review cost drop, and future pages get the pattern for free by importing `components/crud.tsx`.
- The unused `components/ui/` prototypes (Button, DataTable, Badge, Card) remain unused and
  are candidates for deletion in a later cleanup; this ADR does not adopt them.
- `ConfirmDialog` blocks on explicit confirm/cancel and is rendered via portal, so no page
  may rely on synchronous `window.confirm` return values — delete handlers must pass their
  continuation into `confirm()`.
- Draft-line removal inside unsubmitted forms (e.g. greenfield input rows, marked ✕) is
  client-state editing, not record deletion, and stays outside the confirm rule.
