---
lang: en
lang_reason: Code-adjacent decision record; docs are English-only zone
---

# ADR-0205: Brownfield S6 completion requires a human-recorded Pre-FS GO

**Status**: Accepted (2026-11-21; owner approved the direction in chat, plan `agile-jingling-pillow`)
**Date**: 2026-11-21
**Deciders**: Owner (chat, 2026-11-21); drafted by process-governance-manager under PM dispatch. PM runs spec-register.
**Spec**: `s67-completion-visibility` — design [`docs/designs/2026-11-21-s67-completion-visibility-design.md`](../designs/2026-11-21-s67-completion-visibility-design.md) Amendment 2
**Amends**: `process/flow.spec.yaml` S6 (new blocker and completion criterion; `meta.version` 2.21.3 → 2.22.0); ADR-0186 Wave C-3 `pre_fs` prerequisite (brownfield branch only)
**Related**: ADR-0074 (flow.spec SSOT), ADR-0094 (S5–S7 completion, opportunity-keyed gates), ADR-0149 (gate-ladder vs. S1-S12 stage ids), ADR-0186 (gate integrity, GO prerequisites), ADR-0187 (process SSOT, engine-spec parity), ADR-0202 (unreviewed AI verdicts block the S6-consuming gates)

## Context

The `/deals/{id}/s6` and `/s7` routes render the same `BrownfieldStage` body, so the Pre-FS gate panel, the
9-item pre-check checklist and the S7→S8 promotion all appear on both stages. The opportunity-scope `pre_fs`
gate is the stop-loss judgment on whether screening is worth FS resources, yet S7 opens as soon as the three
S6 data blockers (`target_universe`, `longlist_attributes`, `longlist_coverage`) clear. No person has to say GO
first. The gate can be recorded after S7 work has already started, which inverts gate-before-advance.

Making S6 depend on the GO creates a cycle with the existing prerequisite: `gateGoPrerequisiteGaps`
(`app/web-next/lib/process-flow.ts`, case `"pre_fs"`) refuses a brownfield GO until S6 is complete. If S6 needs
the GO and the GO needs S6, no GO can ever be recorded.

## Decision

1. **New S6 completion blocker `s6.pre_fs_go` (brownfield).** S6 is complete only when the three data blockers
   are clear AND the latest opportunity-scope `pre_fs` decision is `go`. `flow.spec.yaml` S6 gains
   `{ key: s6.pre_fs_go, artifacts: [], criteria: [3] }` and the completion criterion
   at index 3, stating that a `pre_fs` gate GO decision has been recorded (its exact Korean wording lives in
   `process/flow.spec.yaml`); `meta.version` moves 2.21.3 → 2.22.0. The blocker is always the last entry
   and is evaluated in every non-exempt S6 branch, including the no-Universe early return, so `blockers[]` and
   `missing[]` stay index-aligned. S7 stays locked until the GO exists.
2. **Gate approval stays human-only (non-negotiable boundary 2).** Only a person with gate rights records the
   `pre_fs` decision. Agents may draft and propose (`propose_gate_decision`, ADR-0118), never record. The
   ADR-0202 rule still applies: unreviewed `ai_draft` verdicts block the GO.
3. **Circularity resolution.** For brownfield, `gateGoPrerequisiteGaps` case `"pre_fs"` replaces "S6 complete"
   with "S6 data blockers clear". The S6 predicate splits into a data-only helper (`target_universe`,
   `longlist_attributes`, `longlist_coverage`) and the full predicate (data + `s6.pre_fs_go`). The prerequisite
   uses the data-only helper. The S4 prerequisite and the ADR-0202 AI-draft-review gap are unchanged. The
   greenfield path (`S5`) is unchanged.
4. **Latest decision wins.** A HOLD recorded after a GO revokes it: `s6.pre_fs_go` reopens, S6 regresses to
   incomplete and S7 relocks. S7 work already recorded is kept, only locked. A KILL terminates the process
   through the existing terminated rule. The Pre-FS confirm step warns before a HOLD revokes a GO.
5. **Grandfathering.** Opportunities that exist on the release date of this change are exempt and never get
   `s6.pre_fs_go`. Exemption is by opportunity `created_at` before a new cut-off constant set to the release
   date, kept with the other cut-offs in `lib/wave-f-date.ts`. `WAVE_F_PREDICATE_DATE` (2026-10-08) is not reused.
   The engine marks the exemption explicitly: each process API `stages[]` entry gains an additive
   `exempt: string[]` of blocker keys skipped by grandfathering (`["s6.pre_fs_go"]` or `[]`). Existing consumers
   are unaffected, and the UI renders "exempt" rather than a false "met".
6. **UI scoping (stage-scoped panels).** The `pre_fs` panel is S6-only and renders at the bottom of the S6 body,
   after the Long List. It is absent on S7: no recording panel and no notice. The pre-check checklist,
   committee, S7 decision tabs and `PromotionPanel` are S7-only. `S6CriteriaPanel` gains a fourth row for
   `s6.pre_fs_go`.

## Alternatives considered

- **Reuse the Wave F cut-off (2026-10-08) for grandfathering**: rejected. That date is past, so deals
  created after it that are already at S7 or later without a `pre_fs` GO would regress and relock S7 mid-review.
- **Keep the Pre-FS panel on S7**: rejected. Recording the gate on the stage it unlocks contradicts
  gate-before-advance. It also leaves the same gate recordable from two routes.
- **Client-side exemption check** (compare `created_at` to the cut-off in the browser): rejected as the
  primary mechanism. Exemption must have one source of truth in the engine, and the client cannot tell
  "met" from "exempt" using `missing[]` alone. The design keeps it only as a degraded fallback, which must
  render "exempt" and never "met".

## Consequences

- **Policy impact on in-flight work**: grandfathering exempts every opportunity that exists at release, so no
  S6/S7 deal regresses. Projects already promoted to S8+ are unaffected: S6 is an opportunity-level stage
  completed before promotion. Their `project_policy_pin` rows are unchanged and need no re-pin. The rule binds
  only opportunities created on or after the cut-off.
- **Process SSOT**: `process/stages.yaml`, `docs/process-flow.md` and `app/web-next/lib/library.generated.ts`
  regenerate from `flow.spec.yaml` via `scripts/co-newbiz/generate-process-flow.ts`. `process-ssot-check` must
  stay green (ADR-0187 engine-spec parity). The new blocker key registers in `lib/process-blocker-keys.ts` with
  ko/en catalog entries (`processBlockers.s6_pre_fs_go`).
- **Tests and seeds**: every fixture or demo seed that completes a non-exempt brownfield S6 must insert a
  `pre_fs` GO. New regression tests cover four cases: S6 incomplete without GO and complete with GO; HOLD after
  GO regresses S6; a grandfathered deal is unaffected; and a GO is accepted when only the data blockers are
  clear (the circularity case).
- **Process API**: `stages[].exempt` is additive and optional for consumers, so no envelope version bump is needed.
- **Human accountability unchanged**: the change adds a human decision point and removes no existing one. HOLD
  and KILL are never blocked.
