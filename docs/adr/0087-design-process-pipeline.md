# ADR-0087: Design process pipeline — tokens-before-screens, design artifacts required at system design phase

**Status**: Accepted
**Date**: 2026-09-01
**Deciders**: user (standing directive), design-system-agent (process owner), platform-lead (review)
**Design of record**: `docs/designs/2026-09-01-design-process-establishment_ko.md`
**Related**: ADR-0082 (CRUD standard), ADR-0083 (visual standard), ADR-0086 (screen patterns)

## Context

Screen patterns (ADR-0086) were established after components were already being built
page-by-page — the reverse of industry-standard design-system sequencing. External
benchmarks (Material Design 3, IBM Carbon, Shopify Polaris, Atlassian, Fowler's
token-as-data architecture) converge on one order: principles → tokens (primitive →
semantic → component) → style guide/color system → iconography → components → screen
patterns → screens. Two structural defects traced to the missing pipeline: semantic-only
CSS classes with no definitions (fixed in ADR-0082) and hand-coded stage headers (fixed in
ADR-0086). Separately, design considerations were not a required artifact of the *design
phase* of system builds — they surfaced during implementation as rework.

## Decision

1. **Seven-phase pipeline adopted as the mandatory order**: ① principles → ② tokens
   (primitive/semantic/component, managed as data — `design-tokens.json` single source
   feeding styles.css) → ③ style guide & color system (functional role palette, WCAG AA
   contrast) → ④ standard icon set & vocabulary table (lucide-react confirmed; one icon per
   domain concept, registered before use) → ⑤ components (token-referencing only) →
   ⑥ screen patterns (ADR-0086) → ⑦ screens (pattern composition + slot fill only).
2. **Design artifacts are a design-phase requirement for system builds**: any design
   document for a new screen/feature must state (a) the pattern used, (b) the tokens and
   components consumed (new ones are approved here, not in implementation), (c) CRUD
   interaction conformance (ADR-0082), (d) icon-vocabulary registration. Reviewed by
   design-system-agent, approved by platform-lead within the existing three-stage review.
3. **Implementation PRs pass design-lint**: hard-coded values outside tokens and header/
   action structures outside the patterns are lint targets (script follows as follow-up work).
4. **Token migration**: existing ad-hoc values in styles.css are inventoried and normalized
   into the token file as the first ② deliverable (follow-up implementation task).

## Consequences

- Design decisions become reviewable data, not scattered CSS — inconsistency is caught at
  the design phase (cheap) instead of the UI audit phase (expensive; three audits were
  needed to reach the current state).
- The pattern inventory (ADR-0086) and icon vocabulary gain a formal registration path,
  preventing silent proliferation.
- Near-term cost: token file extraction and lint scripting are new follow-up tasks;
  until the lint script exists, conformance is enforced by review checklist only.
- **Implemented same day (2026-09-01)**: token single-source at
  `app/web-next/design/design-tokens.json` (3-tier); lint gate at
  `app/web-next/scripts/design-lint.ts` (`bun run lint:design` — rules R1 button sizes,
  R2 hard-coded colors, R3 toolbar bypass, R4 stage h1, R5 window.confirm, R6 delete
  labels; baseline 11 violations fixed to 0); review checklist template at
  `docs/designs/DESIGN-CHECKLIST.md` including the icon vocabulary table.
