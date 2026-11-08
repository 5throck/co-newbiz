---
lang: ko
lang_reason: source-material
---

# Attractiveness re-evaluation stays open for "selected" opportunities until S4 is confirmed

Status: accepted (owner decision 2026-11-08). Pattern: existing per-row control, no new screen. Components: `AttractivenessReEvaluateToggle`, `AttractivenessEditor`, `AttractivenessReEvaluate` (unchanged markup). No new tokens, components, or locale keys.

## 1. Decision

Re-evaluating the attractiveness score is available when the viewer can write and the opportunity is in one of these states:

| status | project_id | S4 route decision | re-evaluate |
|---|---|---|---|
| identified | any | any | first evaluation (always-open editor, unchanged) |
| assessed | any | any | yes (unchanged) |
| selected | none | not confirmed | yes (new) |
| selected | none | confirmed | no (hidden, as before) |
| selected | set | any | no |
| dropped | any | any | no |

No `canAct` (read-only role): never shown.

## 2. S4-confirmed signal

"S4 confirmed" = the opportunity has a current final route decision: a `route_decision` row with `is_current = 1` (ADR-0135; drafts are never current). The opportunity list endpoint already returns `route_decided`, but it is `EXISTS` over any row including drafts, so it is not authoritative. A new additive field `route_confirmed` (0/1, `is_current = 1`) is returned by `GET /api/opportunities` and `GET /api/opportunities/{id}`, which the funnel (S2) and the detail page already fetch. No extra request is added to either screen.

## 3. Server rules (verified, unchanged)

`PUT /api/opportunities/{id}` has no status gate for `attractiveness_score`; only `dropped` is rejected, and only as a status transition (typed closure). A selected opportunity accepts a score update with no server change.

## 4. Consequence to keep visible in code

A re-scored selected opportunity changes the inputs of the S4 route recommendation, so it is only allowed before the route is decided. After S4 confirmation the score is frozen from this surface.

## 5. Accessibility (WCAG AA, both themes)

- Same toggle (`aria-expanded`, `aria-controls`, `sr-only` row name) and editor (labelled number input, `role="alert"` errors, `role="status"` busy text) as for assessed rows; no markup change, so keyboard order, focus return on close, and 375px wrapping are inherited.
- State is carried by the visible status chip and text, not color.
- When hidden (selected after S4, with project, dropped) nothing is rendered; no disabled-looking control is left behind.

## 6. Preview Verification

Not run in this change (no servers). Manual check for the verifier: on `/deals/[id]/s2` and `/opportunities/[id]` with an analyst session, a selected opportunity with no route decision shows "재평가"/"Re-evaluate" and saves a score; after S4 final decision or promotion to a project the control disappears; a draft-only route decision keeps it visible. Light and dark, ko and en, 375px.

## 7. Success criterion (measurable)

1. `canReEvaluateAttractiveness` returns true exactly for the table in section 1 (unit-tested, 8+ cases).
2. A selected opportunity with a draft-only route decision shows the control; with a final current decision it does not (API test on `route_confirmed`).
3. No new network request on either screen; design-lint and existing tests pass.
