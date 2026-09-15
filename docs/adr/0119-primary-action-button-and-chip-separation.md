---
lang: ko
lang_reason: source-material
---

# ADR-0119: Primary action button and chip role separation — amend ADR-0083's two-variant button rule

- Status: Accepted
- Date: 2026-09-12
- Deciders: New Business Review Lead (PM)
- Deciders note: usability review (2026-09-12) found 140+ identical `btn-ghost` buttons per surface and status chips doubling as filters, sort toggles, and score inputs — users cannot tell the one action that advances a stage from the fifteen that do not, nor state from control. ADR-0083's uniformity rule, intended for consistency, produced action-blindness.
- Related: ADR-0083 (visual standard — amended), ADR-0086 (pattern inventory — extended), ADR-0087 (design process), ADR-0120 (deal-centric IA), ADR-0121 (pattern extensions), docs/design-system/design-guide.md gov-des-00 P1 "clarity-first"

## Context

ADR-0083 restricted buttons to exactly two variants (`btn-ghost`, `btn-danger`)
and two sizes, and its reference implementations render every action —
"결정 저장", "선별", deep links, "재생성" — in the same ghost style. On
`/opportunities` a single expanded row exposes up to 7 same-weight controls.
Simultaneously, `.status-chip` (a P5 status surface: color+icon+text) is
routinely rendered as `<button aria-pressed>` for industry filters, sort keys,
and 1–3 scorecard entries, so "what is the state" and "what can I do" share one
visual vocabulary. The 2026-09-12 UI audit ranked "no action hierarchy" and
"chips overloaded as controls" as readability problems #2 and #3.

## Decision

1. **`btn-primary` is added as the single emphasized variant.** Exactly ONE
   primary button per screen (or per self-contained section, where a screen
   hosts parallel stage tasks): the action that records the stage's purpose —
   결정 저장 (S4), 평가 저장 (S5), 승격 (PromotionPanel), 기준선 확정 (charter),
   게이트 기록 submit, 케이스 채택. Everything else remains `btn-ghost`;
   `btn-danger` semantics are unchanged. Primary is visually distinct via the
   semantic primary background/foreground pair (WCAG AA in both themes) and
   inherits the existing two-size scale.
2. **Chips are split by role.** `span.status-chip` becomes read-only state
   display only — no `onClick`, no `aria-pressed`, enforced by design-lint.
   Interactive filter/sort/score controls move to a new `button.control-chip`
   with a distinct treatment (border + selected-primary fill) and the full
   state matrix from the ui-ux-design-intelligence checklist
   (default/hover/active/focus-visible/disabled).
3. **Mechanical enforcement.** `design-lint.ts` (both copies) gains rules:
   (a) at most one `btn-primary` per top-level section, (b) `status-chip` on a
   `button` element is a violation, (c) `control-chip` may not appear inside a
   status context. Token registry (`design/design-tokens.json` v1.2.0) is the
   declaration of record; styles.css gains `btn-primary` and `control-chip`
   classes with dark-theme parity.
4. **Migration is part of each phase, not a big bang** — pages adopt the new
   vocabulary as they are reworked under the deal-workspace program
   (ADR-0120); pre-existing violations are swept in Phase 6.

## Consequences

- Every stage surface gains one visually dominant next action, directly
  answering the "다음 단계가 무엇인가" wayfinding need (ADR-0120 overview).
- State vs control is distinguishable at a glance; scorecard chips keep
  keyboard accessibility from the control-chip state matrix.
- ADR-0083's two-size rule is unchanged; its two-variant rule is superseded as
  stated here. Reference implementations for the new vocabulary:
  `/route-decision`, PromotionPanel, charter page.
