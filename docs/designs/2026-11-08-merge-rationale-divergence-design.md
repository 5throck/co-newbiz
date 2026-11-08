---
lang: ko
lang_reason: source-material
---

# Gate decision form: one field for the rationale and the AI-divergence reason

Status: accepted (owner decision 2026-11-08). Pattern: existing gate decision form (`GateDecisionPanel`), no new screen. Components: `GateDecisionPanel`, `GateAckBlock` (divergence textarea kept for the proposal confirm page). No new tokens or components; two new locale keys in `components.gateSnapshot`.

## 1. Problem

On the gate decision form the person sees two near-identical free-text fields when their decision differs from the AI recommendation: "근거 *" and "AI 권고({ai})와 결정이 다른 이유는 무엇입니까? *". They are asked to write the same reasoning twice.

## 2. Decision

Show ONE visible field. When the decision differs from the AI recommendation, its label becomes:

| situation | label (ko) | label (en) |
|---|---|---|
| no AI recommendation, or decision equals it | 근거 * (unchanged) | Evidence * (unchanged) |
| differs, GO (server requires a divergence reason) | 근거 — AI 권고({ai})와 다른 이유를 포함해 주세요 * | Evidence - include why this differs from the AI recommendation ({ai}) * |
| differs, HOLD/KILL (server: optional) | 근거 — AI 권고({ai})와 다른 이유가 있다면 함께 적어 주세요 * | Evidence - add why this differs from the AI recommendation ({ai}), if so * |

The `*` always refers to the rationale itself, which is required for every decision.

## 3. Server contract (unchanged, ADR-0186 D9)

- Request still carries `rationale` and `divergence_reason`, stored in separate columns; KPIs G2/G3 (`lib/gate-integrity-kpis.ts`) read the same data.
- When the decision differs from the AI recommendation the client sends the trimmed field text as BOTH `rationale` and `divergence_reason` (GO: required by the server; HOLD/KILL: optional, sent anyway so the differing reason is recorded).
- A GO against an AI hold/kill is answered `422 divergence_reason_required` or `422 rationale_insufficient` (`details.field = "divergence_reason"`); both are mapped onto the merged field (inline `role="alert"` message, `aria-invalid`, `aria-describedby`).
- History display (`divergenceRecorded`) is unchanged.

## 4. Scope boundary

- `/proposals/[id]/confirm` has NO pair: its rationale is the agent's read-only proposal text, and the divergence reason is the only human-written reason on that page. It keeps the existing `GateAckBlock` divergence textarea, so `divergenceLabelRequired/Optional` stay.
- `GateAckBlock` is called by the gate decision form with `divergence={null}`; the divergence textarea renders only on the confirm page.

## 5. Accessibility (WCAG AA, both themes)

- One programmatic label per field (the visible label text); the server problem is a separate `role="alert"` paragraph linked by `aria-describedby`, not part of the label.
- Problem text carries the `✕` glyph plus red token color, never color alone.
- Keyboard order unchanged: gate, decision, rationale, conditional fields, acknowledgements, submit. Same field element across label changes, so changing the decision does not move focus or discard typed text.
- Label wraps within the existing `flex-wrap` row down to 375px.

## 6. Preview Verification

Not run in this change (no servers). Manual check for the verifier: on a deal with an AI brief recommending HOLD or KILL, select GO. The rationale label shows the "다른 이유를 포함해 주세요" wording and no second textarea appears. Submit a too-short text: the 422 message appears under the same field. Select HOLD against an AI GO recommendation: optional wording shown. Light and dark, ko and en, 375px.

## 7. Success criterion (measurable)

1. Exactly one free-text reasoning field is rendered on the gate decision form in every decision/AI combination.
2. The POST body carries identical `rationale` and `divergence_reason` whenever the decision differs from the AI recommendation, and no `divergence_reason` otherwise (unit-tested).
3. `divergence_reason_required` and `rationale_insufficient` (field `divergence_reason`) set the problem on the merged field (unit-tested); gate-integrity API tests and i18n audits pass unchanged.
