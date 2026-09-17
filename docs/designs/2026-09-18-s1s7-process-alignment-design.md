---
lang: ko
lang_reason: source-material
---

# S1~S7 Spec–Engine Alignment and Screen Quality Batch

- Spec ID: `2026-09-18-s1s7-process-alignment`
- Date: 2026-09-18
- Status: implemented
- Origin: 2026-09-17 live GUI review (품평회) of the S1–S7 screens against
  `process/flow.spec.yaml` v2.4.0, plus user decisions recorded the same week:
  S1 competitive structure becomes a hard gate; S3 strategic-fit wording is
  aligned to the implemented structure; S4 "alternatives considered" becomes
  completion-checked; the S7 committee records under `target_screening`.

## Problem

Four spec-vs-engine misalignments and five screen-quality findings:

1. **S1 competitive structure is soft** — spec completionCriteria requires the
   latest completed matrix to carry 경쟁 구조, but the engine only adds an
   advisory blocker (`process-flow.ts:155-171`) and never blocks completion.
   User decision: harden it.
2. **S3 "전략적 적합성 판단" wording drift** — the dedicated fit-verdict UI was
   removed 2026-09-15 as a duplicate layer; the spec still reads as if a
   structured Go/Hold/Kill verdict artifact exists. User decision: align the
   spec wording to the implemented structure (rationale + deterministic
   recommendation + screening gate record); no structural change.
3. **S4 "검토한 대안" not checked** — requiredArtifacts lists it, the S5
   predicate already checks the same field for `greenfield_assessment`, but the
   S4 predicate never reads `route_decision.alternatives_considered`.
4. **S7 committee gate-key mismatch** — the committee panel convenes under
   `gates=["screening"]` while the human decision below records
   `target_screening` (`brownfield/page.tsx:1320-1334`); `gate_evaluation`
   CHECK and the committee-sessions allow-list do not accept `target_screening`.
5. **Screen quality**: the S3 screening gate panel is buried at the bottom of
   the "우선 시너지 영역" tab; synergy list rows are only enterable via the
   linked-opportunity button; the login button has no button styling; three
   long sections never collapse; `.toast-region` intercepts pointer events.

## Requirements (ASD-STE100)

- R1: S1 completion fails when the latest completed matrix has no competitive
  structure. The guidance blocker text stays.
- R2: flow.spec v2.4.1 S3 completionCriteria states the implemented surface:
  rationale recorded + deterministic Go/Hold/Kill recommendation presented +
  screening gate recorded by a person. requiredArtifacts labels unchanged.
- R3: S4 completion fails when the latest route_decision has an empty
  `alternatives_considered`. The decision form marks the field required for a
  final decision; draft saves stay allowed.
- R4: S7 committee sessions store `gate='target_screening'`; historical rows of
  that committee migrate. The route committee default stays `pre_fs`.
- R5: The GateDecisionPanel (screening) renders on every tab of the S3 analysis
  detail when the analysis has a linked opportunity.
- R6: Clicking anywhere on a synergy list row opens the analysis detail;
  inner action buttons keep working (stopPropagation), keyboard operable.
- R7: The login submit button uses `btn-primary` (ADR-0119).
- R8: Default-collapsed sections use the existing native `<details>` pattern
  (CommitteePanel history precedent): brownfield pre-check table collapses by
  default once review is complete; the S4 signal table collapses with a count
  summary; the synergy 출처·노트 tab collapses by default. Documented
  always-open areas (synergy score confirm editor, brownfield candidate form)
  stay open.
- R9: `.toast-region` gets `pointer-events: none` with `auto` on children.
- R10: Version plumbing follows the spec bump: regenerate
  `docs/process-flow.md`, refresh the ADDENDUM predicate table, bump
  `spec-activities.generated.ts` SPEC_VERSION, refresh the `stage-meta.ts`
  header comment.

## Design

### Engine changes (`app/web-next/lib/process-flow.ts`)

- S1 predicate: keep the LLM-matrix lookup; when `!hasCompetitive`, push
  `missing.push("경쟁 구조")` in addition to the existing guidance blocker, so
  `complete` turns false. Comment records that the transition-period soft mode
  (introduced with v2.4.0) ended with this change.
- `latestRouteDecision` SELECT adds `alternatives_considered`; the S4 predicate
  pushes blocker+missing `검토한 대안` when the trimmed value is empty. Mirrors
  the S5 precedent (`process-flow.ts:237`).
- No STAGES mirror changes: requiredArtifacts/objective labels are untouched.

### Gate key migration

- New migration `0111_gate_evaluation_target_screening.sql`: rebuild
  `gate_evaluation` with `target_screening` added to the CHECK
  (`@notransaction` table-rebuild pattern of 0062), plus a data fix that
  re-points historical evaluations joined to committee sessions of key
  `target-longlist-shortlist-committee` from `screening` to `target_screening`.
- `lib/committee-session.ts`: widen the `ConveneOpts.gate` type; the
  `applies_to === "brownfield_target"` default becomes `target_screening`.
- `app/api/opportunities/[id]/committee-sessions/route.ts` allow-list adds
  `target_screening`. `CommitteePanel` prop type widens. The brownfield page
  passes `gates={["target_screening"]}`. gate-decisions and gate-brief already
  support the key (no change); provenance joins are id-based (no change).

### Spec + generated plumbing

- `flow.spec.yaml`: version 2.4.1 with a changelog comment; S3
  completionCriteria line replaced; S1 unchanged in wording (the hard gate is
  an engine alignment, the spec already required it).
- `scripts/co-newbiz/generate-process-flow.ts` ADDENDUM predicate table rows
  for S1/S3/S4 refreshed with the new line ranges and date.
- `lib/spec-activities.generated.ts` SPEC_VERSION → "2.4.1" (hand-maintained
  projection; no generator exists).
- `lib/stage-meta.ts` header comment → v2.4.1.

### UI changes

- `synergy/page.tsx`: move the GateDecisionPanel block (currently inside the
  shortlist tab pane, L1119-1135) to the detail shell below the tab strip so it
  renders on every tab when `opportunityId` is set; `onRecorded`
  (go+screening → advanceToRouteDecision) and the S4 direct link stay.
- `synergy/page.tsx` list: `<tr onClick={() => openDetail(a)}>` + Enter/Space
  keydown + `tabIndex={0}`; the 기회/재분석/삭제 buttons stopPropagation. The
  company cell stays a non-clickable group label (intentional, L353-355).
- `login/page.tsx`: submit button gets `className="btn-primary"`.
- Collapses per R8 — native `<details>` with count-in-summary summaries, no new
  abstraction. `styles.css`: `.toast-region { pointer-events: none }` and
  `.toast-region > * { pointer-events: auto }`.

### Design-checklist conformance (UI parts)

- Patterns: P2 Report (existing stage screens, no new screen). Components
  reused: SectionToolbar, StageFrame, GateDecisionPanel, CommitteePanel,
  native `<details>`, `btn-primary`, ConfirmDialog flows untouched. No new
  tokens, no new icons, no CRUD-form changes beyond marking 검토한 대안 as
  required. design-lint R1-R6: no text-sized buttons, no hardcoded colors, no
  `<h1>` outside StageFrame, no window.confirm, deletion labels unchanged.

## Out of scope (deferred)

- Sidebar S6/S7 split (navigation.test href-uniqueness + pageToRoute
  constraints make anchors costly vs. the value; the stepper already
  distinguishes S6/S7).
- `/deals/[id]/[stage]` non-S4 stubs — ADR-0120 Wave 2 track.
- Playwright locator click timeouts: root-cause candidates recorded here
  (dev-server HMR recompile windows per `lib/api.ts:56-66`; infinite CSS
  animations `styles.css:2356 login-hero-pan`, `:3315 skeleton-shine`;
  3-4s polling re-renders in market/synergy/our-company). Reproduce against a
  production build before any product change. R9 removes one real intercept
  risk (toasts over bottom-right controls).
- Test account `ppqc-reviewer` (created for the review session) — deactivate
  via admin console.

## Test plan

- New unit test: S1 predicate hard-gates on missing competitive structure;
  S4 predicate fails on empty alternatives and passes when set.
- Seed updates: `tests/unit/project-promotion.test.ts`,
  `tests/unit/ic-package.test.ts` route_decision rows gain
  `alternatives_considered`.
- `committee-boundary.test.ts`: route committee default stays `pre_fs`;
  add a brownfield default assertion (`target_screening`).
- Full gates: `bun run test:unit`, `bun run db:migrate` + `db:integrity`,
  `bun run design:lint`, `bun scripts/co-newbiz/generate-process-flow.ts --check`.
