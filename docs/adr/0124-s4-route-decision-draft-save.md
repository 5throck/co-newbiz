---
lang: ko
lang_reason: source-material
---

# ADR-0124: S4 route decision — separate "저장" (draft) from "결정" (finalize)

- Status: Accepted
- Date: 2026-09-13
- Deciders: PM (dispatch), backend-engineer (schema/API), frontend-engineer (S4 UI)
- Related: ADR-0052/ADR-0104 (S4 track/route decision framework), ADR-0014 (additive-only migration discipline), ADR-0012 (append-only audit precedent)

## Context

The S4 진출방식 결정 screen was rebuilt to the v5 baseline mockup structure
(4 tabs: 채점 / 위원회 심의 / 의사결정 / 결정 이력, plus an always-visible LLM
추천 panel). Both the 채점 and 의사결정 tabs previously shared a single
"결정 저장" action: clicking it immediately created an immutable
`route_decision` row via `POST /api/opportunities/{id}/route-decision`,
requiring the full completion criteria (intent, all 5 criteria scored with
evidence, non-empty rationale) to succeed at all.

The user requested the "저장" and "결정" actions be separated in both tabs —
an analyst filling in scores over multiple sessions had no way to persist
partial work; every save attempt either satisfied the full validation or
was rejected outright, and reloading the page or switching to another deal
lost all unsaved input.

## Decision

1. **`route_decision` gains a `status` column** (`draft` | `final`, default
   `final` for backward compatibility with every existing row — this
   migration does not change the meaning of any row that existed before it).
   `rationale` becomes nullable (a draft may not have one yet); the
   completion-criteria validation still applies only at finalize time. At
   most one open draft exists per opportunity (`idx_route_decision_one_draft`
   partial unique index) — "저장" upserts into it rather than accumulating
   rows.
2. **New endpoint** `PUT /api/opportunities/{id}/route-decision/draft` —
   accepts the same shape as the existing POST body but with no required
   fields (only enum values are validated when present). Upserts the
   opportunity's single draft row and replaces its `route_decision_score`
   child rows with whichever criteria currently have both a score and a
   non-empty evidence note (partial score sets are allowed in a draft;
   `route_decision_score.intent` is `NOT NULL`, so scores are only persisted
   once `intent` has been chosen — never fabricated).
3. **Existing endpoint** `POST /api/opportunities/{id}/route-decision`
   (unchanged request/response contract, unchanged full-validation rules) is
   now the "결정" action. Before inserting, it looks for an open draft for
   the opportunity — if found, it updates that row in place (id preserved,
   status flips to `final`, `decided_by`/`decided_at` set to the finalizing
   actor/time) instead of inserting a second row; if no draft exists, it
   inserts directly as before (an analyst can still finalize without ever
   clicking "저장" first).
4. **`GET`** the same route now also returns the opportunity's current draft
   (if any) alongside the `final`-only decision history, so reopening the S4
   screen — from any device or session — restores the in-progress draft
   into the form.
5. **UI**: both the 채점 tab and the 의사결정 tab get an explicit "저장"
   button (calls the draft endpoint, always enabled — a draft has no
   completion requirement) next to the existing "결정 저장" button (calls
   finalize, gated by the same `canSubmit` rule as before). A small
   "초안 저장됨" indicator reflects the draft's last-saved time.

## Consequences

- `route_decision` history (결정 이력 tab) only ever lists `status='final'`
  rows — drafts never appear as if they were recorded decisions.
- The finalize endpoint's validation is unchanged, so no existing caller or
  test relying on its current behavior needs updating; only the row it
  writes into may now be an UPDATE of a pre-existing draft rather than
  always an INSERT.
- A draft is opportunity-scoped, not user-scoped — any analyst+ who reopens
  the screen sees and can continue the same in-progress draft (matches the
  existing collaborative-editing precedent elsewhere in the app; there is no
  per-user draft isolation).
- The migration is a table rebuild (SQLite cannot relax a `NOT NULL`
  constraint in place) but is additive in effect: every pre-existing row's
  `status` becomes `final`, preserving its original meaning exactly.
