---
lang: ko
lang_reason: source-material
---

# Move the deal-shape evaluation ("진출 형태 평가") from S4 to S7

Status: Accepted (owner decision 2026-11-08, chat; option (a) — end of S7; recorded in ADR-0195). Author: process-governance-manager (functional lead). Every verdict below is a proposal to PM and the owner; no gate is decided here.

Anchors: `process/flow.spec.yaml` v2.19.0 (S4 ~L635, S7 ~L833, gates ~L297); `procedures/_shared/brownfield-pre-fs/schema.yaml` v1.5.0 step 2; `procedures/_shared/brownfield-target-screening/schema.yaml` v1.0.0; `procedures/_shared/deal-shape-chain/schema.yaml`; `procedures/_kill-criteria/deal-shape-chain__no_viable_deal_shape.json`; ADR-0187 P2 (M2), ADR-0193, ADR-0194.

## 1. Decision (process side)

1. The flow.spec S4 activity `deal-shape-evaluation` (brownfield-agent) moves to **S7 (대상 선정, brownfield-only, gate `target_screening`)**.
2. **brownfield-pre-fs step 2 does not move with it, and S7 does not host brownfield-pre-fs.** Pre-FS is gate `pre_fs`, which closes before S6/S7 open. A stage activity hosting a step whose `gate:` is an earlier gate breaks the authority layering (AGENTS.md §7): the procedure governs its steps, including the gate each step sits on. The deal-shape work therefore needs a home in the S7 procedure, not a cross-gate host.
3. **Proposed home: a new step in `brownfield-target-screening`** (gate `Target Screening`, agent_key `brownfield-agent`, skill_key `deal-execution-playbook`, output_type `deal_shape_evaluation`): "per Short List candidate (or per opportunity when shapes are candidate-independent), record the viable deal shapes (M&A / JV / strategic investment / minority stake / partnership / R&BD / CVC) with intent and rationale, human-recorded". Number it 3.5 (after ranking, before the step 4 gate record) so the shape is judged against the ranked survivors.
4. **brownfield-pre-fs step 2 keeps the structure hypothesis** (asset vs stock, stake, instrument mix, vehicle) but is rewritten to drop "acquisition shape" from its Pre-FS scope, or — preferred — is reduced to a Pre-FS "deal-structure intent" note and its shape content defers to target-screening step 3.5. Either option keeps one owner per concern. Note: S10 `deal-structure-hypothesis` (deal-structuring step 1) already owns the binding structure; step 2's residual Pre-FS value is thin. Option to be picked by PM; this lead recommends the reduction.
5. **After the move, S4 hosts no brownfield-agent activity for brownfield-pre-fs step 2.** The ADR-0187 M2 check (`activity-agent-in-procedure`, `scripts/co-newbiz/process-ssot-check.ts`) must still pass: route-strategy / route-advisory (pm) keep brownfield-pre-fs through the lead-only allowlist entries; verify the check still finds a host for step 2 (otherwise step 2 becomes an orphan step — finding class M2 — and must be hosted or reduced per item 4).
6. **deal-shape-chain stays listed in S4** on route-strategy / route-advisory. It is the partner-track funnel (P0 scouting → partner DD) that informs the route choice itself (partner vs acquire); moving the S4 activity does not move the funnel. It is also hosted at S8/S10 per the existing comments. Whether kill criterion #9 (which lives in deal-shape-chain) remains evaluable from S4 is the risk-officer's ruling, not this lead's.

## 2. Gate-timing consequence (factual; ruling deferred)

- Today #9 is `evaluable_from: S4`, `reevaluate_at: pre_fs`, listed in the `screening` gate registry, and its data source (ADR-0194) is the opportunity-scope S4 panel.
- If the human-recorded deal-shape rows are created at S7, the data **does not exist at pre_fs** (pre_fs precedes S6/S7). Leaving #9 at pre_fs means it is always unassessed at that gate for brownfield. The consistent options are `evaluable_from: S7` / `reevaluate_at: target_screening` (and add the key to the `target_screening` registry), or keep a track-neutral S4 evaluation separate from the S7 screen. Greenfield never reaches S7, so a track-neutral #9 cannot be fed by an S7-only surface.
- This is handed to the risk-officer (section below). The process change in section 1 is valid under either ruling; only the kill-criterion JSON, the gate registry lists, and the test expectations depend on it.

## 3. Exact edits (not applied; for the implementing dispatch)

| File | Edit |
|---|---|
| `process/flow.spec.yaml` | Bump `version` 2.19.0 → 2.20.0 with header note. Remove S4 `deal-shape-evaluation`; add S7 activity `deal-shape-evaluation` (brownfield-agent, skills [deal-execution-playbook], procedure [brownfield-target-screening]). S7 `outputs` += "딜 형태 평가 (후보별 실행 가능 형태·의도·근거)"; `inputs` += "트랙 결정·Route 유형 (S4)". `requiredArtifacts`: add as a **nonBlockingArtifacts** entry unless risk-officer moves #9 to target_screening, in which case add requiredArtifact + blocker `s7.deal_shape_evaluation` (engine key in `lib/process-blocker-keys.ts`, emitted by `lib/process-flow.ts`, parity via check-engine-spec-parity). Fix the S4 comment at ~L663 and header note ~L90 (historical note stays, add superseding line). Gate registries per risk-officer ruling. |
| `procedures/_shared/brownfield-target-screening/schema.yaml` | v1.0.0 → 1.1.0; add step 3.5 (section 1 item 3); step 4 description adds the deal-shape record to the gate checklist. |
| `procedures/_shared/brownfield-pre-fs/schema.yaml` | v1.5.0 → 1.6.0; rewrite step 2 per section 1 item 4. |
| `procedures/_kill-criteria/deal-shape-chain__no_viable_deal_shape.json` | `evaluable_from` / `reevaluate_at` / `evaluable_from_evidence` / notes "S4 deal-shape screen" — per risk-officer ruling. |
| `procedures/_kill-criteria/README.md`, `procedures/_shared/deal-shape-chain/schema.yaml` | Text references to the S4 screen. |
| `skills/deal-execution-playbook/SKILL.md` (and `brownfield-feasibility` if it names S4 shape work) | Procedure key reference only; no step restatement (boundary #3). |
| `docs/adr/0194-kill-criteria-data-sources.md` | Amendment section (see section 6). |
| UI: `components/stages/route-decision/DealShapePanel.tsx`, `RouteDecisionStage.tsx`, the S7 brownfield target-screening stage component, `components/GateSnapshotAck.tsx` (~L456 doc comment, ~L660 href `/s4#` → `/s7#`), `lib/deal-shape-view.ts` | Relocate the panel (section 5). |
| `app/web-next/locales/ko.json`, `en.json` | Panel/link strings naming S4. |
| `CHANGELOG.md` | Entry. |

## 4. Generators to run and checks

- `bun scripts/co-newbiz/generate-spec-activities.ts` → `app/web-next/lib/spec-activities.generated.ts`
- `bun scripts/co-newbiz/generate-pm-catalog.ts` → `app/web-next/lib/pm-catalog.generated.ts`
- `bun scripts/co-newbiz/generate-process-flow.ts` → generated process-flow markdown (wiki/docs projection)
- `bun scripts/co-newbiz/generate-review-matrix.ts` (if activity list feeds it)
- `bun run governance:generate` (library.generated.ts, wiki projection), then `bun run governance:check`
- `bun scripts/co-newbiz/process-ssot-check.ts` (M2 host check — must stay green, section 1 item 5)
- `bun scripts/audit.ts`; procedure schema validator; policy impact analysis and `project_policy_pin` check for in-flight projects (CLAUDE.md lifecycle rule for `procedures/**`)

## 5. UI note

- `DealShapePanel` moves from the S4 route-decision screen to the **S7 brownfield target-screening screen** (same panel id anchor `DEAL_SHAPE_PANEL_ID`). S4 shows at most a read-only pointer for brownfield ("형태 평가는 S7에서") — no write surface.
- Gate snapshot #9 link (`GateSnapshotAck`, `data-testid="deal-shape-link"`) points to `/deals/{id}/s7#<panel>`. If #9 stays track-neutral at pre_fs (risk-officer option), greenfield opportunities would get a link to a skipped stage — the link must be suppressed for greenfield.
- REST `POST /api/opportunities/{id}/deal-shapes` and MCP `record_deal_shape_evaluation` keep opportunity scope (S1–S7 are opportunity carrier stages per `lib/process-flow.ts` ~L1451); add a server-side guard rejecting writes before S7 is open or when track ≠ brownfield. If per-candidate shapes are wanted, that is a schema change (candidate FK on `opportunity_deal_shape_evaluation`) → ADR + data-architect review; not proposed here.
- Onyx 3.0 conformance and design-lint apply; ux-designer-agent owns placement within the S7 screen.

## 6. ADR trigger

Yes. `procedures/**` changes (two procedure schemas plus a kill-criterion JSON) → ADR required per CLAUDE.md lifecycle rules; a gate-registry / gate-timing change also cannot pass on AI review alone. Proposal: **new ADR (ADR-0195, "Deal-shape evaluation relocated to S7 target screening")** that supersedes ADR-0194 item A's stage placement only, plus a short "Amended by ADR-0195" note in ADR-0194. A new ADR is preferred over an in-place amendment because the change alters a gate binding and a procedure step owner, which ADR-0194 did not decide.

## 7. Test impact

- `tests/unit/kill-criteria-stage-scoping.test.ts` L117 (`evaluable_from: "S4", reevaluate_at: "pre_fs"`) — update per ruling.
- `tests/unit/opportunity-deal-shape.test.ts` — S4 wording and any stage guard; add stage/track guard tests.
- `tests/unit/pm-catalog.test.ts`, `kill-criteria.test.ts`, `kill-criteria-carry.test.ts`, `wave-f8-subtrack-gaps.test.ts`, `brownfield-workspace-scope.test.ts` — re-run; expect generated-artifact and activity-count deltas.
- New/updated render test for the S7 panel and the `/s7#` link in `GateSnapshotAck`; engine-spec parity test if a blocker key is added.

## 8. Divergences recorded

- Pre-move: S4 `deal-shape-evaluation` hosts a Pre-FS step while the shape decision logically depends on known targets (S6/S7) — the owner's move resolves this.
- **Decision (2026-11-08)**: owner chose option (a) — evaluate at the end of S7 after short-list ranking (`brownfield-target-screening` step 3.5), #9 at `target_screening`, brownfield-only. Recorded in ADR-0195.
- Post-move risk: #9 is track-neutral but an S7 surface is brownfield-only; reconciliation routed to risk-officer and PM.

## Risk-officer ruling

Ruling by risk-officer, 2026-11-08, on the owner decision to move the deal-shape evaluation to S7 (brownfield-only, `target_screening` gate). This ruling evaluates and proposes. The registry and ADR changes need a recorded human decision (ADR-0053, ADR-0193/0194 amendment).

### R-1 Track scope: per criterion, not per procedure

- **#9 `no_viable_deal_shape` becomes brownfield-only.** Greenfield has no deal-shape step and, after the move, nowhere to record shapes. So on greenfield the criterion can only ever end `unassessed`, and the acknowledgement it asks for is meaningless. Partnership, JV and CVC are brownfield in this model (Brownfield ≠ M&A), so the partner track loses nothing.
- **#10 `partner_dd_red_financial_distress` and #11 `partner_dd_red_ip_chain` stay track-neutral.** Their source, `partner_dd_finding`, is project-scoped and has no track gate (`/api/projects/{id}/partners/{partnerId}/findings`). A greenfield project can still record partner DD for its S5 *Partner* entry strategy. Making #10/#11 brownfield-only would close a real `halt` as `out_of_track` on greenfield, which is the silent-drop pattern this function exists to block.
- **Rejected mechanisms.**
  - Returning `"brownfield"` for `deal-shape-chain` in `procedureTrack()` is per procedure, so it would also drop #10/#11.
  - Renaming or moving the criterion to a `brownfield-*` procedure changes the criterion key, which orphans the stored acknowledgements, carries and hashed snapshots that are keyed on `deal-shape-chain:no_viable_deal_shape`.
- **Chosen mechanism.** Add an optional registry field `"track": "brownfield"` on #9 only. Add a `criterionTrack(procedure, entry)` function that returns `entry.track ?? procedureTrack(procedure)`, and use it wherever the code now calls `procedureTrack` for a criterion: `classifyKill` and the `outOfTrack` carry closure in `gate-snapshot.ts`. `process-ssot-check` must reject any value outside {greenfield, brownfield} and any value that contradicts a track-prefixed procedure. The registry already owns criterion scope (`evaluable_from`, `reevaluate_at`), so keeping track scope there too keeps policy out of code. The field is a registry schema change, so it needs an ADR (amend ADR-0193). If the owner refuses the schema change, the fallback is a named key allowlist in `gate-kill-scope.ts` (`BROWNFIELD_ONLY_KEYS = ["deal-shape-chain:no_viable_deal_shape"]`). Per-procedure scoping is never acceptable.

### R-2 Stage and gate for #9

- `evaluable_from`: `S4` → `S7`. `reevaluate_at`: `pre_fs` → `target_screening`. A shape count cannot exist at `pre_fs` (S4–S6) once the screen is hosted at S7.
- `db/lib/kill-var-stages.ts`: change `dealshape.viable_shapes` from `"S4"` to `"S7"`.
- `evaluable_from_evidence` and `notes`: rewrite "hosted by S4 route-strategy; single gate pre_fs" as "hosted by S7 deal-shape-evaluation (brownfield); gate target_screening". Keep the ADR-0194 item A data-source text unchanged: live human-written rows only, no LLM or route derivation.
- **Gate listing.** Keep `deal-shape-chain` in `OPPORTUNITY_PROCEDURES.pre_fs`, so #10/#11 still carry to `fs` on both tracks. Add `"deal-shape-chain"` to `OPPORTUNITY_PROCEDURES.target_screening`.
  - At `pre_fs`, #9 classifies `not_reached` (stage is early and its `reevaluate_at` is a later gate) and carries to `target_screening`.
  - On brownfield it is evaluated natively at `target_screening`.
  - On greenfield the carry closes `out_of_track` through R-1, with the route decision id.
  - The implementer must test that `out_of_track` closure takes precedence over `kill_carry_overdue`. Greenfield never records `target_screening`, so its first later gate (`fs`) must close the carry, not flag it as overdue.
- **Spec drift to fix in the same change.** `process/flow.spec.yaml` `gates.screening.killCriteriaRegistry` still lists all three `deal-shape-chain` keys, although the CHANGELOG (2.19.0) says they moved to `pre_fs`. Move #9 to `gates.target_screening` and #10/#11 to `gates.pre_fs`. Also update `kill.scheduled` (the "deal-shape-chain pending for pre_fs at Screening" entry) to name `target_screening` for #9.
- **#10/#11.** Keep `reevaluate_at: fs` (§14 ruling). `evaluable_from` S5 is now earlier than its premise: a named partner after the shape, with a project-scoped source. Move it to `S8`, together with `partner.*_red_count` in `kill-var-stages.ts`. This only affects the label: the existing deferral already classifies them `not_reached` before `fs`.

### R-3 Enforce guard and the ADR-0193/0194 rulings

- **Enforce guard.** At `pre_fs`, #9 has kind `carried`, and at `target_screening` it has kind `reached_at_own_gate`. In both cases its only variable, `dealshape.viable_shapes`, is in `OPPORTUNITY_SCOPE_VARS`, so it adds no offender. #10/#11 are deferred to a project gate and are skipped. `carriedWithoutDataSource()` must stay empty, and the PR must show its output.
- **ADR-0194 item A.** The ruling stands. The data source (`opportunity_deal_shape_evaluation`, opportunity scope) is unchanged, and `target_screening` is still an opportunity gate (the carrier ends at S7).
- **ADR-0193 §14.** The ruling stands. Record this ruling as an amendment note: #9 re-scoped, `track` field introduced.

### R-4 Legacy acknowledgements and silent-drop check

- **Do not rewrite stored snapshots.** They are hash-locked, and the v1/v2 verifiers stay as they are.
- **Brownfield opportunities already past `target_screening`** whose only #9 record is an acknowledged-unassessed entry at `pre_fs` will never be re-evaluated. Run a one-time read-only listing (same pattern as `kill:legacy-ack-listing`) and put it in the PR so a human can review it. This is a historical gap, not a new drop.
- **Live zero-viable greenfield records.** Before merge, query greenfield opportunities that have live `opportunity_deal_shape_evaluation` rows with zero viable shapes, and report the count. `classifyKill` already lets `triggered` win before `out_of_track`, so any such record stays visible as a trigger. The action is `mark_conditional` (RECYCLE), not `halt`.
- **Residual risk: none found for #9.** No `halt` is dropped, because #9's action is `mark_conditional`. Risk only arises if #10/#11 are scoped by procedure, and R-1 forbids that.
- **Kill-criteria status for this change.** #9: unassessed at `pre_fs` until now, reassigned to `target_screening`. #10/#11: unchanged, deferred to `fs`. None triggered by this change.

### R-5 Placement options for #9 (owner question, 2026-11-08)

The owner is weighing three placements, each after the long list is narrowed to the short list. R-1 (brownfield-only, through the per-criterion `track` field) applies to all three. Key: `opportunity_deal_shape_evaluation`, the ADR-0194 item A source, is **opportunity-scoped**, while S8 and S9 are **project-scoped**.

| | (a) S7 end / `target_screening` | (b) S8 / `fs` | (c) S9 / `dd` |
|---|---|---|---|
| `evaluable_from` | S7 | S8 | S9 |
| `reevaluate_at` | target_screening | fs | dd |
| Scope | Opportunity. The source table already matches, so no change. | Project. The snapshot filler must read the opportunity row through `md_project.source_opportunity_id`, or the table must move to project scope (needs an ADR and a schema change). | Project. Same requirement as (b). |
| Gate listing | Add `deal-shape-chain` to `OPPORTUNITY_PROCEDURES.target_screening`. Keep `pre_fs` so #10/#11 still carry to fs. | Add #9 to `projectKillProcedures` for the brownfield fs gate, or reach fs only as a carry from pre_fs. | Brownfield dd procedure set, or carry. |
| Brownfield-only handling | The gate is already brownfield-only. The `track` field closes carries from pre_fs as `out_of_track` on greenfield. | The `track` field is required: fs is a shared gate, so greenfield fs would otherwise list it as unassessed. | Same as (b). |
| Enforce guard | Stays visible. The variable is in `OPPORTUNITY_SCOPE_VARS`, so the result is no offender. | **Blind spot.** `carriedWithoutDataSource()` skips project gates on the assumption that they "always have their data". If the lineage read is missing, #9 sits `unassessed` at fs and the guard does not see it. `kill_carry_unassessed` blocks only halts, and #9 is `mark_conditional`, so nothing blocks it. | Same blind spot as (b). |
| RECYCLE semantics (send the need back to scouting) | Coherent. Recycling happens before FS money is spent. | Late. The tranche is already allocated, and the FS valuation needs a shape (a structure hypothesis) as input. | Too late. DD budget is spent, and DD assumes a chosen structure, so recycling at DD contradicts the funnel. |
| Partial-input exposure | Low. The shape is judged against a ranked short list. | The shape is judged against FS numbers, which is better evidence but circular: FS presumes a shape. | Highest evidence, but the shape no longer gates anything. |

**Recommendation: (a), S7 end / `target_screening`, run after ranking (PGM's brownfield-target-screening step 3.5).** It is the only option where the data scope, the gate scope and the guard's coverage all line up without new plumbing. It keeps the ADR-0194 ruling intact, and it puts the RECYCLE decision before the FS spend.

- Choose (b) only if the owner explicitly wants the shape judged on FS numbers. If so, the same PR must have three preconditions:
  1. a lineage read for `dealshape.viable_shapes` at project scope;
  2. an extension of the enforce guard so that it checks project-gate variables against what the project snapshot actually supplies (closing the blind spot above);
  3. an ADR-0194 amendment.
- **Reject (c):** it defeats the screen's purpose.
- **Under any option:** #9's action stays `mark_conditional`, and its verdict belongs to the human gate.
