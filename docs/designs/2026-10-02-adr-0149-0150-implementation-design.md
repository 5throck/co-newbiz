---
spec_id: 2026-10-02-adr-0149-0150-implementation-design
title: "ADR-0149 / ADR-0150 implementation design"
author_agent: platform-lead
status: approved
created: "2026-10-02"
related_adrs: ["0149", "0150"]
lang: en
---

# ADR-0149 / ADR-0150 Implementation Design

## 1. Purpose

Implement the two ADRs the human reviewer accepted on 2026-10-02:

- **ADR-0149** — separate the gate-ladder stage ids from the S1-S12 business stage ids (Option A: rename `process/stages.yaml` ids to G1-G8).
- **ADR-0150** — S12 lifecycle completion criteria mapped to portfolio transitions (six criteria, immediate application to in-flight projects).

This is the Row 0 design document. No implementation exists yet; the execution plan in §9 sequences the work.

## 2. Acceptance Records (verbatim decisions, 2026-10-02)

1. "ADR-0149 accepted; Option A (gate ladder in process/stages.yaml renamed S1-G8: ids G1-G8). The gate ladder keeps its gate meaning; the S1-S12 business stages in process/flow.spec.yaml are unchanged and become the only meaning of S-ids."
2. "ADR-0149 open point G3 owner_agent TODO: assign `pm` (consistent with flow.spec Pre-FS ownership: route-strategy/deal-shape activities)."
3. "ADR-0150 accepted; the six S12 completion criteria adopted as written."
4. "ADR-0150 migration decision: IMMEDIATE full application — all in-flight (project_policy_pin-pinned) projects evaluate against the new criteria from now on; no cutoff." Plus: "ADR-0150 criterion 6 data owners: group-review-agent records the captured learning; risk-officer feeds it back into S1/S2 base rates."

Open decisions: **none**. All four items are recorded above.

## 3. Scope — files per row

| Row | Files |
|---|---|
| 1 (ADR-0149 governance) | `process/stages.yaml` (ids S1→G1 .. S8→G8; G3 `owner_agent: pm`), `process/stage-aliases.yaml` (alias targets S1-S8 → G1-G8; alias keys unchanged), `docs/adr/0149-*.md` (status → Accepted) |
| 2 (validator/tests/DEG) | `procedures/_validate.ts` (closed-registry check, both directions, G prefix), `tests/unit/stage-aliases-registry.test.ts` (expected ids; new no-collision test), `scripts/co-newbiz/graph.ts` (stage-axis adapter: G-to-DEG mapping at the export surface) |
| 3 (ADR-0150 governance + policy impact) | `procedures/_shared/portfolio-venture-monitoring/schema.yaml` (six S12 completion criteria; criterion 6 data owners), `process/flow.spec.yaml` S12 entry (completion criteria), `docs/adr/0150-*.md` (status → Accepted; migration decision recorded), policy-impact records for the files in §6 |
| 4 (web predicate) | `app/web-next/lib/process-flow.ts` S12 predicate (criteria 1-6) |
| 5 (docs regeneration) | generated docs: `graft build`, skill-graph regen if stage ids appear in graph output, `scripts/SCRIPTS.md` only if script surface changed (it does not; rows 2-4 edit existing scripts only — regen run is still a no-op check) |
| N | `/sync` |

Files NOT changed: `app/web-next` stage routes and `StageId` type (S1-S12 business stages, untouched), DB migrations (no schema change needed — see §7), `docs/designs/2026-10-01-s1-s12-process-alignment-design.md`.

## 4. ADR-0149: gate-ladder rename

### 4.1 Rename mechanics

`process/stages.yaml`: ids S1-S8 → G1-G8, in order. Titles, purposes, criteria, `owner_agent` values unchanged, except G3 `owner_agent` becomes `pm` (decision 2). `order` values unchanged (1-8), so the DEG-P-01 distinctness check and `stage_follows` edge generation are unaffected.

`process/stage-aliases.yaml`: every `stage:` target changes S<n> → G<n>. Alias keys (`gate:` values: "Screening", "Target Screening", ...) are unchanged — they are the SSOT consumers and no procedure edits its `gate:` value.

### 4.2 DEG export compatibility (ADR-0083)

The DEG stage export is implemented in `scripts/co-newbiz/graph.ts` (stage axis adapter, `loadStageAliases()` at ~line 315, consumed at ~line 635): it reads `process/stages.yaml` and `process/stage-aliases.yaml` and emits stage nodes as `stage.co-newbiz.<id>`, plus `stage_follows` and `in_stage` edges, under `graph_profile: "deg/v1"`.

**Approach: explicit G-to-DEG mapping at the export surface.** The graph generator adds a module-level `GATE_ID_TO_DEG` map (`G1`→`S1` ... `G8`→`S8`) applied when emitting DEG stage nodes and edges, so external DEG consumers keep reading the legacy `stage.co-newbiz.S<n>` ids and nothing downstream breaks. External ids are unchanged everywhere a consumer reads gate slugs (the alias keys in `stage-aliases.yaml`) or the legacy DEG stage id; only the internal registry ids in `stages.yaml`, the validator, and the unit test use the G prefix. The map carries a comment naming ADR-0149 and the acceptance date; it is removed only if ADR-0083 is later amended to accept G ids on the wire.

### 4.3 Validator and test changes

- `procedures/_validate.ts`: the closed-registry check between `stage-aliases.yaml` `stage:` targets and `stages.yaml` ids switches its expected prefix to `G` for the gate axis. Any hard-coded `S` pattern for this axis changes to a pattern over the declared id set (G1-G8), keeping the check closed-registry rather than prefix-shaped where possible.
- `tests/unit/stage-aliases-registry.test.ts`: expected ids become G1-G8. New test: **no id string appears in both `stages.yaml` and `flow.spec.yaml`** (the ADR's acceptance criterion — no id resolves to two stage meanings).

## 5. ADR-0150: S12 completion criteria

### 5.1 Criteria and existing data

All six criteria are satisfiable from existing tables — no migration:

| # | Criterion | Data source (existing) |
|---|---|---|
| 1 | Periodic scorecard review per period | `venture_scorecard` rows (db/migrations/0024); per-cycle existence check |
| 2 | Human transition decision with rationale per review | `venture_transition_decision` (0071): `decided_by` CHECK-pinned to human role `venture-portfolio-ic`, `rationale` CHECK <> '' |
| 3 | Continue decision records next tranche condition | `next_tranche_released` / `held_evidence_incomplete` rows; condition recorded in the row's rationale/learning_capture fields |
| 4 | Expansion decision records core-business hand-off | `graduate_to_core` row with hand-off note |
| 5 | Exit decision records divest/wind-down plan | `reduce_or_divest` row with plan note |
| 6 | Kill decision records captured learning, feeds S1/S2 base rates | `kill_with_learning_captured` row; `learning_capture` column already REQUIRED via the route for this decision. Data owners: **group-review-agent records** the captured learning; **risk-officer feeds it back** into S1/S2 base rates |

### 5.2 Web predicate change (`app/web-next/lib/process-flow.ts`)

The registered `S12` predicate (currently: latest fresh scorecard cycle only) extends to evaluate criteria 1-6:

- 1 — keep the existing `MAX(review_cycle)` freshness check (`isFreshReviewCycle`).
- 2 — for the latest review cycle, a `venture_transition_decision` row exists whose latest row (by `decided_at, id`) has a human `decided_by` and non-empty `rationale`.
- 3-5 — conditional on the decision vocabulary: `next_tranche_released`/`held_evidence_incomplete` must record a next-tranche condition; `graduate_to_core` a hand-off; `reduce_or_divest` a divest/wind-down plan. Missing condition text blocks with a named blocker.
- 6 — a `kill_with_learning_captured` latest decision requires non-empty `learning_capture`.

The predicate stays read-only over existing repositories; blockers/missing arrays name the unmet criterion, matching the file's existing fail-closed pattern. No UI change beyond the completion list text the predicate already renders.

### 5.3 Governance files

- `process/flow.spec.yaml` S12 entry: completion criteria list updated to the six criteria.
- `procedures/_shared/portfolio-venture-monitoring/schema.yaml`: steps/steps text amended so the procedure produces the records criteria 1-6 require; criterion 6 data ownership (group-review-agent records, risk-officer feeds back to S1/S2 base rates) written into the procedure.

## 6. Policy impact (ADR-0150)

1. Affected governance files (grep result: references to S12 / post-close / portfolio monitoring):
   - `procedures/_shared/portfolio-venture-monitoring/schema.yaml`
   - `procedures/_shared/jv-lifecycle-governance/schema.yaml`
   - `procedures/_shared/pmi-integration-execution/schema.yaml`
   - `procedures/_human-roles.yaml`, `procedures/_kill-criteria/pmi-integration-execution__*.json`
   - `policies/**`: policy scan runs at implementation; the group policy's §2.8 pin clause governs application.
2. Run policy impact analysis on each file above.
3. Query `project_policy_pin` for every in-flight project; record which projects pin the current version.
4. **Migration decision (recorded, overriding the ADR's open choice)**: IMMEDIATE full application — all in-flight (pinned) projects evaluate against the new criteria from now on; no cutoff. This decision is a recorded human decision and is written into the ADR-0150 status amendment and the policy-change record.

## 7. Risks

| Risk | Mitigation |
|---|---|
| DEG export consumers break on G ids | Explicit G-to-DEG map at the `graph.ts` export surface; legacy `stage.co-newbiz.S<n>` ids preserved on the wire (§4.2) |
| Missed hard-coded S-id reference in gate-axis code | No-collision test plus grep sweep of `procedures/_validate.ts` and graph adapter during Row 2 |
| Mid-deal criteria change harms in-flight projects | Immediate application is a recorded human decision; `project_policy_pin` query output is archived in the policy-change record before the switch |
| Predicate too strict, S12 never completes | Criteria 1-6 map onto already-recorded rows; blocker strings name the exact missing record so operators can complete it |
| G3 owner `pm` drifts from actual flow-spec ownership | Decision 2 states the rationale (Pre-FS route-strategy ownership in flow.spec); recorded in `stages.yaml` note |

## 8. Accessibility / Preview note

No new UI. The only rendered surface touched is the S12 completion list text in `app/web-next`, which inherits existing components (Onyx 3.0) — no new interaction, color, or layout. **Exemption claimed for ADR-0070 preview verification** (text-only change inside an existing rendered component); ADR-0065 accessibility baseline is met by reuse of existing audited components. Verification: the S12 screen renders the updated blocker/missing strings correctly under the existing breakpoints.

## 9. Execution plan

PM running on: GLM-5.3-Flash[1m]

| # | Task | Agent | Tier | Model | Spec |
|---|------|-------|------|-------|------|
| 0 | Create design doc → `docs/designs/2026-10-02-adr-0149-0150-implementation-design.md` + registry entry | platform-lead | High | opus | NEW |
| 1 | ADR-0149 governance files: `stages.yaml` G1-G8 + G3 owner `pm`, `stage-aliases.yaml` targets, ADR-0149 status Accepted | process-governance-manager | High | opus | 2026-10-02-adr-0149-0150-implementation-design |
| 2 | Validator, unit tests (incl. no-collision test), DEG G-to-DEG mapping in `graph.ts` | backend-engineer | Medium | sonnet | 2026-10-02-adr-0149-0150-implementation-design |
| 3 | ADR-0150 governance files + policy impact: flow-spec S12 entry, portfolio-venture-monitoring procedure, ADR-0150 status Accepted + migration decision, `project_policy_pin` query and policy-change record | process-governance-manager | High | opus | 2026-10-02-adr-0149-0150-implementation-design |
| 4 | S12 predicate (criteria 1-6) in `app/web-next/lib/process-flow.ts` | backend-engineer | Medium | sonnet | 2026-10-02-adr-0149-0150-implementation-design |
| 5 | Docs regeneration: graft build, generated-docs check, README regeneration if roster/stage text changed | docs-writer | Medium | sonnet | 2026-10-02-adr-0149-0150-implementation-design |
| N | `/sync "docs(process): implement ADR-0149 gate-id rename and ADR-0150 S12 completion criteria"` | pm | Medium | sonnet | |

**Execution Order**: Sequential (rows 1-2 must land before 4; 3 before 4's predicate text freezes against procedure wording).

## 10. Verification plan

1. `bun run procedures:lint` — validator accepts G1-G8 in both directions; fails on any residual S-id alias target.
2. `bun run checklists:lint`.
3. `bun run test:unit` — including the updated `stage-aliases-registry.test.ts` and the new no-collision test (no id in both `stages.yaml` and `flow.spec.yaml`).
4. `bun run validate:language`.
5. Skill-graph regeneration run (`scripts/generate-skill-graph.ts`) — confirms no gate-id drift in generated output; regen if stage ids appear.
6. No-collision test passes (part of step 3, listed separately because it is the ADR-0149 acceptance criterion).
7. S12 predicate: unit test that each criterion's missing record produces a named blocker, and that a fully recorded cycle completes S12.

## 11. PR plan

Single PR. All rows land in one branch; `/sync` opens it. No parallel-branch conflicts expected.
