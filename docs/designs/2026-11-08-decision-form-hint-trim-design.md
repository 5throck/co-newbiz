---
lang: ko
lang_reason: source-material
---

# Gate decision form: trim two hint lines

Status: accepted (owner decision 2026-11-08). Pattern: existing gate decision form, no new screen, component, token, or API. Components touched: `GateSnapshotAck`, `GateDecisionPanel`. The quoted Korean strings are the removed UI copy (source material).

## 1. Decision

| Surface | Before | After |
|---|---|---|
| `GateSnapshotAck`, GO selected, no acknowledgement items and not hard-blocked | Muted line "이 GO에는 따로 확인할 항목이 없습니다." | Nothing rendered for the section (no empty-state line) |
| `GateDecisionPanel`, record button, rationale empty | Visible caption "근거를 입력하면 결정을 기록할 수 있습니다." beside the button | Button stays disabled; the reason is exposed only to assistive technology |

Other submit reasons stay visible text exactly as before: recording in progress, gate locked by sequence, KILL needing a learning, HOLD needing the missing-artifact list.

## 2. Implementation

- `GateSnapshotAck`: the `isGo && required.length === 0 && !hardBlocked` paragraph is deleted. Locale key `components.gateSnapshot.noAckNeeded` is removed from ko and en (no other consumer, no test reference).
- `GateDecisionPanel`: `rationaleMissing` (not saving, not gate-locked, rationale empty) switches the existing `${formId}-reason` span to `sr-only`. The button keeps `disabled` and `aria-describedby` pointing at that span, so screen readers still announce the reason. Locale key `theDecisionCanBeRecorded` is retained because the sr-only span still renders it.
- Wiki rows in `docs/wiki/ko/33-*` and `81-*` updated to match.

## 3. Accessibility and design-system check

- No Onyx 3.0 rule in `docs/design-system/` or `design-lint` (R1-R10) requires a disabled control's reason to be visible text; `ui-spec.md` uses "disabled with a visible reason" as a per-screen convention only. The `sr-only` pattern already has precedent in the design system (table captions, actions column header).
- Trade-off: sighted users get no on-screen hint for why the button is disabled. The empty required-evidence field (marked `*`) is the cue the owner accepted. Not color-only: nothing relies on color.
- Screen readers: the disabled button is described by the sr-only reason, preserving the WCAG name/description expectation.

## 4. Acceptance

- GO with zero acknowledgement items shows no extra line in the snapshot section.
- With empty rationale the record button is disabled, `aria-describedby` resolves to an `sr-only` element carrying the reason, and no such text is visible.
- Remaining submit reasons are visible as before.
