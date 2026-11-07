# ADR-0193: Kill-criteria stage scoping — `evaluable_from`, not-reached display, and mandatory carry

**Status**: Accepted (owner decision, 2026-11-07; risk-officer review recorded in design §12)
**Date**: 2026-11-07
**Deciders**: Owner (decision) and risk-officer (kill-criteria authority); drafted by process-governance-manager
**Related**: ADR-0037 (waivers), ADR-0053 (human decision steps), ADR-0074 (flow.spec SSOT), ADR-0180 (grandfathering precedent), ADR-0192 (S3 fit predicate), design `2026-11-07-kill-criteria-stage-scoping-design`, CHANGELOG 2026-11-06 (AI 1st `not_reached`)

## Context

At the S3 Screening gate, an opportunity's track is undecided until the S4 route decision, so
`OPPORTUNITY_PROCEDURES.screening(null)` (`app/web-next/lib/gate-snapshot.ts:150-154`) evaluates both
`greenfield-screening` and `brownfield-screening`. The opportunity-scope variable source supplies
only `screening.viable_targets`, and only from the S6 longlist. Five enabled criteria therefore always
come out `unassessed`, and each forces a `kill_unassessed` acknowledgement with a reason
(`gate-decision-contract.ts:147`). Their inputs exist only at S5–S7. The acknowledgements are
meaningless, and nothing ensures that the criteria are ever asked again. In effect, kill criteria can
be dropped silently, which Boundary 4 and the risk-officer mandate forbid.

## Decision

1. Each `procedures/_kill-criteria/*.json` entry declares `evaluable_from` (flow stage) and
   `reevaluate_at` (gate id). The registry validator enforces both fields. It cross-checks them
   against the variable sources, and a parity check verifies them against flow.spec. `reevaluate_at`
   must be a single gate id (C-2). The YAML
   `kill_criteria` (condition, action) is unchanged.
2. At a gate snapshot, a criterion whose `evaluable_from` is after the entity's current stage is
   classified `not_reached`. It is shown as information only, it needs no acknowledgement, and it is
   not counted.
3. A triggered result is never scoped away. Triggered criteria keep their full binding and override
   semantics at any stage. An early trigger is flagged `partial_input` so the human sees a possible
   false positive (C-5). `kill_override` remains for triggered results only.
4. Reached criteria stay fail-closed: `unassessed` still requires the `kill_unassessed`
   acknowledgement.
5. Every `not_reached` item is recorded as a carry to `reevaluate_at` from **every** recorded decision
   (GO, conditional GO, HOLD re-entry) (C-4). Later gates on the same entity lineage evaluate carried
   keys. Hard blocks, with no Group IC override (R-5 rejected): `kill_carry_overdue` (carry cannot be
   evaluated); `kill_carry_unassessed` (carried `halt` still unassessed at `reevaluate_at`, C-1);
   `kill_lineage_missing` (null `md_project.source_opportunity_id` at the first project GO, C-3).
   Carries closed by a route change are listed as `out_of_track` with the route decision id, never
   dropped (C-4). S12 criteria leave IC as `open_monitoring` and close only by a recorded human
   decision on the S12 monitoring surface (C-6). Legacy `kill_unassessed` acks are implicit carries
   computed at read time, plus a one-time non-blocking listing for risk-officer (R-4).
6. The snapshot `schema_version` is bumped. `not_reached`, `carried_in`, and `current_stage` are
   inside the canonical hash. Legacy snapshots verify under their own schema version. Recorded
   decisions are never rewritten.
7. Criterion-specific rulings (C-6, Q3): #5 reads `infra.plan_finalized` as of the site-announcement
   date; #35 `evaluable_from` S9; #9 `reevaluate_at` `pre_fs`; partner criteria #6/#10/#11 at S5.
8. Owner decisions (2026-11-07): Q1 — #4–#8 stay on the `screening` gate with carries (no flow.spec
   gate move); Q2 — collapsed "Not reached yet" group on the decision screen.
9. The change applies to new snapshots from the effective date for all entities, including in-flight
   ones. It removes only unanswerable acks and adds carries. No `created_at` cut-off is needed
   (contrast with ADR-0192).

## Consequences

- The S3 Screening GO stops demanding 5 meaningless acknowledgements. The criteria are re-asked at
  `pre_fs` / `target_screening`, where their evidence exists.
- Every deferral is auditable and closes by evaluation. This is stricter than today, where an ack
  closes a criterion without evaluating it.
- New hard blocks (`kill_carry_overdue`, `kill_carry_unassessed`, `kill_lineage_missing`) can stop a GO that today would pass with an ack.
- Registry files (44), the validator, the snapshot schema, the decision contract, `GateSnapshotAck`,
  and i18n all change across three PRs (design §10). `procedures/**` changes trigger a policy impact
  analysis and a `project_policy_pin` check.
- An open spec divergence is recorded and not resolved here: the flow.spec `screening` gate lists
  `deal-shape-chain` criteria that the engine does not evaluate at opportunity Screening (design O-2).

## Alternatives considered

- **Derive the stage automatically from the variable registry.** Rejected as the source of truth: it
  hides a governance choice inside data plumbing. It is kept as a validator cross-check.
- **Filter by track only (drop the other track's criteria while the track is null).** Rejected: the
  track is unknown at S3, so either track's criteria could apply, and filtering would drop them with
  no carry.
- **Move the S5–S7 criteria out of the flow.spec `screening` gate.** Declined by owner (Q1, 2026-11-07).
- **Group IC override of `kill_carry_overdue`.** Rejected by risk-officer (R-5): overdue is a registry defect, not an acceptable business risk.

## Approval

Accepted by the owner on 2026-11-07. The risk-officer (kill-criteria authority) review, with rulings on
R-1..R-5 and conditions C-1..C-7, is recorded in design §12 and incorporated above; AI review alone
could not pass this ADR (kill criteria, gate approvals), and the owner decision is the approval of record.
Implementation is staged in three PRs (design §10): PR-A registry fields + validator + parity check
(data only), PR-B engine (snapshot, classifier, carries, hard blocks, contract), PR-C UI. The rule lives in
`procedures/_kill-criteria/README.md` (registry shape and validation) and
`docs/designs/2026-11-07-kill-criteria-stage-scoping-design.md` (full design of record).

## ADR-0193 amendment note (2026-11-07, §14)

Source: risk-officer ruling on follow-ups, design §14. Registry data and engine only; no DB schema change,
no `flow.spec` change. The owner records the decision; this note records what was implemented.

- **`reevaluate_at` re-scoped to `fs`** (`evaluable_from` unchanged, `evaluable_from_evidence` updated) for
  criteria whose predicate variables come from project-scoped sources, which cannot exist at an
  opportunity gate: #4 `zero_site_clears_infrastructure_minimums`, #5
  `infrastructure_plan_not_finalized_at_site_announcement`, #6 `greenfield-screening` partner dependency
  (the `brownfield-dd` twin stays at `dd`), #8 `preliminary_hhi_flags_certain_block`, #10/#11
  `partner_dd_red_*` (no opportunity-scope copy of partner DD and no proxy from candidate scores), #12
  `wacc_hurdle_still_assumed` (both `*-pre-fs`; the fs WACC block, ADR-0186 D8, re-tests it) and #13
  `certification_transferability_unconfirmed_and_load_bearing` (both `*-pre-fs`; `certification.project_id`
  is `NOT NULL`, so there are no opportunity-scoped rows). The deferral does not cost detection: C-1 still
  hard-blocks a carried `halt` that is still `unassessed` at `fs`, and the carry chain is kept.
- **Engine**: a criterion whose registry `reevaluate_at` is a later gate than the evaluating one classifies
  `not_reached` with a carry even when its stage is reached (`classifyKill`, `deferredToLaterGate`), so
  #10-#13 at the opportunity `pre_fs` gate are never reached-unassessed acknowledgements. A triggered result
  is still never scoped away (it carries `partial_input`). PM decision (2026-11-07): this engine rule is kept in
  preference to moving the `deal-shape-chain` listing to `fs` in flow.spec. The read-time carry derivation for
  legacy schema-v1 acknowledged GOs (and the R-4 listing) applies the same deferral, so a legacy pre_fs GO that
  acknowledged #12/#13 is not silently dropped.
- **Enforce guard** (`carriedWithoutDataSource()`, startup check, `kill_enforce_unsafe`) now also lists
  criteria reached at their own opportunity gate whose variables are not in `OPPORTUNITY_SCOPE_VARS`
  (`kind: reached_at_own_gate`), not only carried ones. Against the real registry the list is now exactly
  #9 `deal-shape-chain:no_viable_deal_shape` (`dealshape.viable_shapes` @ `pre_fs`); the four carried
  offenders are cleared. Enforce stays refused until #9 has an opportunity-scope source.
- **Two filler defects found and fixed because the re-scope makes them reachable at the first project gate**
  (`db/lib/snapshot-filler.ts` 1.10.0): `fin.wacc_source_status` read only the gate-evaluation run's own
  assumptions (that run is created empty), so it was always missing at a project gate; it now falls back to the
  project's confirmed rate state through `resolveWaccConfirmation` (no session stays missing/unassessed, never a
  silent pass). `infra.sites_clearing_minimums` queried non-existent `*_sufficient` columns and would throw as soon
  as one `site_candidate` row existed; it now uses the real four-flag columns. The S1-S12 demo seed
  (`seed-s1-s12-demo.ts` 1.15.1) adds one clearing `site_candidate` so the greenfield demo can pass fs.
- **Open, not implemented here**: #9 source (a deal-shape record keyed at opportunity scope, read directly,
  never derived from scores or drafts; a new table or column needs its own ADR); #5 point-in-time predicate
  (site-announcement event and plan effective date, ADR required; the caveat and `test.todo` stay, §14.3);
  O-4 preliminary market-level HHI source for #8 (may re-point #8 to `target_screening` later, ADR-tracked).
