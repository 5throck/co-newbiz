# ADR-0185: Agent and skill placement realignment (S1–S12)

- Status: Proposed (2026-10-26) — a human approves this ADR at PR merge. An ADR changing procedures, checklists, the human-role registry, and a gate-bearing validator set cannot pass on AI review alone (project CLAUDE.md, Review Model).
- Date: 2026-10-26
- Review: AI-2nd technical review (platform-lead, 2026-10-26): REVISE, with 2 blocking findings → addressed in this revision (decision 1.2 and the Consequences/impact sections). Human approval at merge is still required.
- Decider: human owner (decisions 2026-10-26 in chat, recorded below as D-1 and D-2). Drafted by process-governance-manager on PM dispatch (Row 0, Design Gate).
- Design-of-record: [docs/designs/2026-10-26-placement-realignment-design.md](../designs/2026-10-26-placement-realignment-design.md)
- Source audit: [docs/reports/2026-10-26-flow-agent-skill-audit.md](../reports/2026-10-26-flow-agent-skill-audit.md)
- Related: ADR-0020 (procedure references and overrides), ADR-0037 / ADR-0048 (mandatory validators, applicable-validator registry, `not_applicable` result), ADR-0047 (applies_when), ADR-0053 (human decision step marking and the human-role registry), ADR-0074 (flow.spec SSOT), ADR-0161 (retroactive-application precedent), ADR-0167 (business-unit establishment), ADR-0180/0181/0182 (entry market / synergy), DEC-20261025-01, DEC-20261025-02, DEC-20261025-05 (agent assignment and prompt standard). Does not supersede any ADR; ADR-0048 is amended in one respect (validator key set, decision 1.2).

## Context

An audit of all 47 S1–S12 flow activities, 24 shared procedures, 41 agents, 105 skills and 39 runtime prompts (2026-10-26) found that no agent lead needs replacing, but placement metadata has drifted from how the work is actually run. Findings, with the audit's severity:

| ID | Severity | Finding |
|---|---|---|
| F-1 | HIGH | The "six mandatory M&A validators" are defined three ways. Project CLAUDE.md and `checklists/brownfield-feasibility-checklist.yaml` bf-01 (non-waivable) name region-lead labor review as the sixth; `procedures/_shared/brownfield-dd` step 14 and `checklists/ma-special-topics-checklist.yaml` name contingent liability instead. No `brownfield-dd` step is owned by `region-lead`, so bf-01 demands a validator the procedure never runs, while the procedure enforces one bf-01 does not list. |
| F-2 | HIGH | Five validator-carrying agents run `brownfield-dd` steps with no S9 flow activity (antitrust step 6, customer-retention step 8, incentive step 9, contingent liability step 10, certification step 11), so the stepper, activity cards and PM catalog hide them. A visibility and routing gap, not an enforcement gap (step 14 enforces). |
| F-3 | HIGH | `certification_transferability_check` steps in `brownfield-pre-fs` (3), `greenfield-pre-fs` (5) and `business-unit-establishment-execution` (3) bind the permit skill `permit-pathway-mapping`, violating boundary 5 (permits and certifications are managed separately) and the no-inference rule. |
| F-4 | MEDIUM | 14 one-line experimental stub skills, all owned by `process-governance-manager`, plus several mis-owned domain skills and five skills naming an owner absent from the roster. |
| F-5 | MEDIUM | The repository-review skill `project-review` is bound to three deal procedure steps that produce deal artifacts. |
| F-6 | MEDIUM | Flow `skills:` lists lag the procedure steps they host (22 procedure-only skills). |
| F-7 | MEDIUM | `k-dart`, `k-ecos`, `k-kosis`, `k-krx`, `k-opendata` attached nowhere. |
| F-8 | LOW-MEDIUM | Prompt catalog drift: 6 stage prompts without an `activity` mapping; five stage-prefix mismatches in keys. |
| F-9 | LOW | `s12.milestone_suggest` embeds a stipulated track definition in an instruction. |
| F-10 / F-11 | LOW | `agents/README.md` class table stale; PGM persona claims RAG-grade proposal that the procedure gives to `risk-officer`. |

Additional findings from this design pass (not in the audit):

- **F-1 has a runtime consequence.** `db/lib/validator-applicability.ts` (`MA_VALIDATOR_APPLICABILITY`, `MaValidatorKey`) and `db/repositories/compliance.repository.ts` hard-code the six keys `antitrust, hr-comp, customer, incentive, contingent-liability, certification`, each mapped to a `brownfield-dd` step (6, 7, 8, 9, 10, 11), and pin `declared = 6`. Making region-lead labor review the sixth validator therefore changes code, not only YAML.
- **R-4 independence**: `risk-officer` (the red team, which holds no authorship) is the bound agent of prompt `s3.capability_gap_draft`, which drafts the required-capability register that `risk-officer` later challenges, and of `s4.synergy_fa`, which derives target strengths and weaknesses from financial data (analysis, not red-team work).

## Owner decisions (2026-10-26, authoritative)

- **D-1 (F-1)**: Keep CLAUDE.md and bf-01 as written. The six validators are exactly **antitrust, customer-retention, incentive, hr-integration, certification transferability, region-lead labor review**. Add a region-lead labor-review step to `brownfield-dd`. Contingent liability stays as an existing DD step but is **not** counted among the six; reconcile `brownfield-dd` step 14 and `ma-special-topics-checklist` wording accordingly.
- **D-2**: Proceed with all audit proposals: ADR-batch items, recorded-decision items, skill-lifecycle items, persona-sync items.
- **D-3 (Q1)**: `region-labor` applies to all deals except greenfield + internal build (same skip family as hr-comp).
- **D-4 (Q3)**: Step 6.5 reuses `regulatory-screening`: fill in the stub, re-own to `legal-counsel`. No new labor skill.
- **D-5 (Q6)**: Create new skill `ip-fto-review` (owner `ip-agent`; IP landscape / freedom-to-operate), gated on an R&BD applicability flag.
- **D-6 (Q4)**: DROP the S10 `site-facility-assessment` activity. `site-facility-agent` is wired only into `greenfield-screening` step 3 and `greenfield-pre-fs` step 3.
- **D-7 (Q10)**: The `region-lead` ×2 exception to ADR-0013 is confirmed (follows from D-1).
- **D-8 (2026-10-26, overlay)**: `ma-13` (region-lead labor review, non-waivable) in `checklists/_overlays/brownfield-workspace-scope.yaml` is mandatory (A) for `m_and_a` and `jv` only and not applicable (N) for every other brownfield sub-track.
- **D-9 (2026-10-26, dual assignments)**: four prompts are sanctioned dual assignments (prompt agent differs from the activity lead); see Decision 8.
- **D-10 (2026-10-26, MCP scope)**: MCP coverage for the nine new activities; see Decision 9.
- **PM defaults (owner may override at PR review):** Q2 split `business-unit-establishment-execution` step 3; Q5 brownfield integration milestones are out of scope for `s12.milestone_suggest` (`pmi-agent` owns them); Q8 owners `zod-contract-gate` → `backend-engineer`, `design-foundation` → `design-system-agent`, `value-chain-stage-financials` → `financial-analyst`; `partnership-health-scorecard` and `ip-fto-review` start `experimental`; step id 6.5 kept only if `_validate.ts` and `graph-map.ts --check` pass, else renumber.

## Decision

### 1. Procedures and checklists (ADR-governed)

1.1 **Six-validator definition (F-1, D-1).** `brownfield-dd` gains a new region-lead labor-review step (design doc row P-01). Step 14's declared set becomes antitrust (6), region-lead labor (new), hr-integration (7), customer-retention (8), incentive (9), certification (11, still LAST). Step 10 (contingent liability) remains a mandatory DD step with its own kill criterion (`covenant_breach_with_coc_acceleration_under_downside`) but is not a counted validator. `ma-special-topics-checklist.yaml` is reworded so that ma-10/ma-11 are explicitly "DD items outside the six-validator core, standard waiver path as today", and a region-lead labor-review item is added; bf-01 is unchanged.

1.1b **Registered exception to ADR-0013 (domain leads are not dispatched as procedure steps).** `agents/README.md` records `region-lead` as dispatched in exactly one step (the EU `brownfield-screening` override, step 2.5). A `brownfield-dd` step owned by `region-lead` makes that two. D-1 requires it (bf-01 names a region-lead validator and no non-lead agent may author a lead's profile-driven labor review), so this ADR extends the registered exception from "×1 via the EU override" to "×2: EU override and the `brownfield-dd` labor-review validator", and updates the `agents/README.md` Domain-leads row and the `region-lead` persona Legal Basis section accordingly. The lead still does not dispatch anyone: PM dispatches the step (PM Gateway unchanged). If the owner would rather keep leads out of steps entirely, the alternative is a non-lead executing agent reading `region-profiles/` (see Open items 5); that departs from the literal bf-01 wording "region-lead labor review" and is not chosen here.

1.2 **Runtime registry (amends ADR-0048; revised after AI-2nd BLOCKING 1).** `MA_VALIDATOR_APPLICABILITY` gains an explicit core flag: each row carries `in_core: boolean`. **`contingent-liability` stays in the registry as a non-counted row (`in_core: false`, step 10, same applicability as today)**, and **`region-labor` is added as a core row (`in_core: true`, step 6.5)**. "Declared" counts core rows only, so `declared = 6` and the migration-0016 CHECK (declared pinned to 6, 0..6) stay true. Reason: `db/lib/snapshot-filler.ts` (`CONTINGENT_VALIDATOR_KEY`, `contingentCoverageComplete`, ~lines 529–560) reads the contingent-liability row's completeness status to turn a zero-row expected value into a present 0.0 (D-M-RISK-5); keeping the row, with its rule key `ma-validator-contingent-liability` and its not_applicable semantics, leaves that coverage signal unchanged. Consequences encoded in the amendment: (a) `MaValidatorKey` gains `"region-labor"` and keeps `"contingent-liability"` (seven keys, six core); (b) `MaValidatorApplicability.step` type gains `6.5`; (c) the completeness engine, `completeness_record` writer and kill criterion `any_of_six_ma_validators_missing_at_dd_exit` evaluate core rows only; the non-core row is still evaluated and reported (status feeds the snapshot) but its absence does not halt DD exit; (d) `not_applicable` writes for `contingent-liability` remain legal but are **no longer counted toward the six** (they do not alter `applicable_count`/`completed_count`); (e) `region-labor` applicability = skip only when greenfield AND internal (D-3), i.e. `skipOnly(GREENFIELD(), INTERNAL())`; (f) rule-key convention `ma-validator-<key>` retained; the rejection messages in `compliance.repository.ts` list the six core keys plus a note that `contingent-liability` is a non-core row.

1.3 **Certification skill binding (F-3).** Re-point the three `certification_transferability_check` steps from `permit-pathway-mapping` to `certification-transferability` (permit-holder classification in `business-unit-establishment-execution` is split into its own step so the permit work keeps its skill).

1.4 **Deal-artifact skill binding (F-5).** `portfolio-venture-monitoring` step 2 → `portfolio-fit-assessment`; `deal-shape-chain` step 6 and `jv-lifecycle-governance` step 2 → new skill `partnership-health-scorecard` (decision 4.2).

1.5 **Agent wiring.** `greenfield-screening` step 3 and `greenfield-pre-fs` step 3 → `site-facility-agent` (A-2); `brownfield-dd` gains an R&BD-only IP/FTO step 3.5 owned by `ip-agent` with new skill `ip-fto-review` (gated on the R&BD applicability flag) and step 3 is narrowed to the technology/TRL part (A-3).

1.6 **Human-role registry (ADR-0053, A-5).** Register `target-selector` in `procedures/_human-roles.yaml` and use it as `agent_key` of `brownfield-fs-comparative` step 2. `pm` stays the assembler of the fs-gate proposal through flow activity `target-selection` (unchanged lead).

### 2. flow.spec (DEC-class metadata change; version 2.10.1 → 2.11.0)

Adds activities only and aligns metadata; no stage, gate, track or transition structure changes (precedent: v2.10.0 `capability-dd`).

- **S9** (procedure `[brownfield-dd]` only): `antitrust-dd`, `customer-retention-dd`, `incentive-dd`, `contingent-liability-dd`, `certification-transferability-dd`, `region-labor-review`, and `ip-fto-dd` (R&BD only).
- **S4**: `wacc-hurdle-confirmation`, `certification-screen`.
- No S10 activity is added (D-6); activity count 47 → 56.
- `skills:` lists aligned to the union of hosted procedure steps (P-5 list in the design doc); comment-only intent notes for `route-strategy` and `target-selection` (A-6).
- A validator warning that a hosted step's skill is absent from its activity `skills:` list (audit policy 5.3-2), added to `procedures/_validate.ts` or `generate-spec-activities.ts` as warn-only.

### 3. Skills (skill-lifecycle only, no ADR trigger)

Re-own the stubs and mis-owned skills (S-3), rewrite the 14 stub descriptions with real triggers or keep them `experimental` until the existence bar is met (S-4), add `k-dart` to `financial-analyst` and `financing-plan-review` to `financing-agent` required skills (S-5/S-6). Attach `k-kosis`/`k-ecos`/`k-krx` to activities only after the spec validator is confirmed to accept `scope: common` skills (S-5, unverified).

### 4. New skills

`ip-fto-review` (D-5): owner `ip-agent`; trigger "freedom to operate", "IP landscape", "patent FTO"; artifacts: FTO position and patent-landscape finding as a `dd_finding` for the R&BD-gated `brownfield-dd` step 3.5; distinct from `technical-due-diligence` (TRL/EHS/capex) and `legal-due-diligence`; starts `experimental`.

`partnership-health-scorecard`, owner `partnership-agent`, meeting the skill-existence bar: distinct trigger ("partnership health scorecard", "alliance post-launch review", "JV health review"), existing owner, non-trivial artifacts `jv_health_scorecard` and `alliance_post_launch_review`. Starts `experimental`. Replaces the misbound `project-review`; no other skill covers it. No new agent is hired (a visibility gap is closed by adding an activity, not an agent).

### 5. Prompt catalog

5.1 **Key renames** (stage prefix = hosting stage): `s3.opportunity_factors` → `s2.opportunity_factors`; `s4.synergy_fa|synergy|ic` → `s3.synergy_fa|synergy|ic`; `s8.deal_structure_recommendation` → `s10.deal_structure_recommendation`; `s11.monitoring_brief` → `s12.monitoring_brief`. All callers, the generator key list, tests and generated registries are updated in the same change.
5.2 **Activity mappings** for the six stage prompts (F-8) plus the new S4/S10 activities.
5.3 **Rebinds and red-team independence**: `s4.synergy_fa` (renamed `s3.synergy_fa`) → `financial-analyst`; `s3.capability_gap_draft` → `process-governance-manager`. `risk-officer` keeps `s3.synergy_synergy` / `s3.synergy_ic` (its persona assigns the S3 synergy score) and no longer drafts the register it challenges or derives financial strengths. Where `risk-officer` receives a drafted artifact it reviews, it reviews as a different seat from the author.
5.4 **Wording** (F-9): move the track definition out of `s12.milestone_suggest`'s instruction into the user-message evidence block, and state that brownfield integration milestones are out of scope for this prompt (`pmi-agent` owns them) — PM default, owner may override.
5.5 **Independence check (recorded).** `s3.synergy_fa` moves from `risk-officer` to `financial-analyst`. Checked against `app/web-next/lib/review/domains.ts` (ADR-0153): `financial-analyst`, `risk-officer` and `process-governance-manager` all carry `domain: functional`; `DEFAULT_REVIEWER_DOMAIN.functional = technical`, so the AI-2nd reviewer for these artifacts is `platform-lead` (technical) before and after the rebind. The rebind therefore does not create a same-domain review. It restores authorship separation (author ≠ challenger seat) rather than domain separation.

### 6. Personas (generated, sync script)

Edit `agents/*.md` and run `sync-agent-personas.ts`: PGM persona ("coordinate and close" for S11; gate assembly clarified — RAG proposal is `risk-officer` at `entity-ic-review` step 1, PGM owns kill-criteria check and gate record); `risk-officer` and `financial-analyst` scope sentences; `hr-integration-agent` (owns `management-incentive-review`); `incentive-agent` scope; README class table (F-10).

### 7. Overlay amendment: ma-13 scope by sub-track (human-approved count change; D-8)

`checklists/_overlays/brownfield-workspace-scope.yaml` 1.2.3 -> **1.3.0** (decision record `ADR-0185`, owner decision 2026-10-26, `approval_2026_10_26` recorded on `chk-ma-special-topics-checklist`).

- `m_and_a`: baseline, `ma-13` unscoped (A). `jv`: now attaches `chk-ma-special-topics-checklist` with `ma-01..ma-12` excluded (N, reason recorded) so only `ma-13` (A) applies.
- `strategic_investment`, `minority_investment`, `corporate_venture`: `ma-13` excluded (N) with a user-facing `na_reason`.
- **Validator amendment** (`checklists/_validate.ts`): the "binding items can never be scoped out" guard stays the rule. An exclusion entry may carry `owner_exception: {decision, approved_by: user, approved_at}`; only then is a binding extra item (mandatory, `waiver_eligible: false`) allowed in `excluded`. Without it the guard still errors (existing test "binding items must be A" unchanged). This is the only path by which a binding item leaves a sub-track and it requires a recorded human decision.
- Counts (declared in `expected_counts`, recomputed by the validator):

| Sub-track | A | R | X | N | workspace judgeable | extras judgeable | total judgeable | change |
|---|---|---|---|---|---|---|---|---|
| m_and_a | 77 | 0 | 0 | 0 | 77 | 26 | 103 | extras +1 (ma-13), total 102 -> 103 |
| jv | 57 | 18 | 0 | 2 | 75 | 19 | 94 | extras +1 (ma-13), total 93 -> 94 |
| strategic_investment | 56 | 15 | 0 | 6 | 71 | 5 | 76 | none (ma-13 N) |
| minority_investment | 56 | 15 | 0 | 6 | 71 | 19 | 90 | none (ma-13 N) |
| partnership | 22 | 30 | 2 | 23 | 52 | 26 | 78 | none |
| rbd | 75 | 2 | 0 | 0 | 77 | 15 | 92 | none |
| corporate_venture | 56 | 15 | 0 | 6 | 71 | 4 | 75 | none |

- **Required follow-up outside governance authority (backend-engineer):** (a) `BF_SCOPED_EXTRA_ADDITIONS` in `app/web-next/lib/library.ts` must add `jv: ["chk-ma-special-topics-checklist"]` (overlay `attached_to` mirrors it); (b) `app/web-next/lib/brownfield-subtrack.ts` (`resolveExtraItem`, fail-closed branches around lines 269 and 301) currently treats any binding item as always applicable; it must honor an exclusion carrying `owner_exception`. Until then four tests in `tests/unit/brownfield-workspace-scope.test.ts` ((a) counts, (c) opt-in preview, (f) fail-closed) show the strategic/CVC/minority sub-tracks with one extra judgeable `ma-13`, contradicting the approved numbers above.

### 8. Sanctioned dual assignments (prompt agent differs from activity lead; D-9)

This is the gate-moment decision record `generate-pm-catalog.ts` asks for. Each is an owner-sanctioned exception to "prompt agent = activity lead"; the activity lead keeps accountability for the activity output, the prompt agent supplies a bounded draft.

| Prompt | Prompt agent | Activity | Activity lead | Rationale |
|---|---|---|---|---|
| `s3.synergy_fa` | financial-analyst | S3.synergy-analysis | risk-officer | Red-team independence (R-4): the financial derivation must not be authored by the challenger; `risk-officer` leads and challenges, `financial-analyst` drafts the financial basis. |
| `s3.attractiveness_recommendation` | risk-officer | S3.strategic-fit-screening | process-governance-manager | The recommended attractiveness is an independent red-team view on the screen the PGM assembles; PGM assembles, never authors the grade. |
| `company_profile.competitor_web_search` | market-intelligence-agent | S3.our-company-profile | financial-analyst | Competitor evidence gathering is market-intelligence work; the profile and its qualitative assessment remain the lead's (DEC-20261025-05 §13.3). |
| `s12.milestone_suggest` | process-governance-manager | S12.portfolio-monitoring | group-review-agent | Milestone suggestions are a process-spine concern (stage/milestone structure); portfolio monitoring and the scorecard cycle stay with `group-review-agent`. Brownfield integration milestones remain out of scope (`pmi-agent`). |

### 9. MCP tool scope for the nine new activities (D-10; MCP tool scope change)

| Activity | MCP tool | Mapping |
|---|---|---|
| antitrust-dd | `record_antitrust_screen` | covered |
| customer-retention-dd | `record_customer_coc` | covered |
| incentive-dd | `record_incentive` | covered |
| wacc-hurdle-confirmation | `record_wacc` | covered |
| region-labor-review | none | human-only exclusion: the non-waivable ma-13 conclusion is a region-lead/human-reviewed finding on a regional legal position; no agent-writable record tool by design |
| certification-screen | none | human-only exclusion: certification conclusions are confirmed against the certifying body and counsel; inference is disallowed |
| certification-transferability-dd | none | human-only exclusion: transferability on change of control is confirmed against the body's own rules (bf-03, ma-12); never inferred by an agent |
| contingent-liability-dd | none | human-only exclusion: the amounts/distributions feed the Monte Carlo and valuation inputs and need human sign-off; not in the six-validator core (in_core: false) |
| ip-fto-dd | none | human-only exclusion: freedom-to-operate is a legal-judgement output requiring counsel confirmation |

Implemented by `backend-engineer` in the shared MCP registry; governance records the mapping and the exclusion reasons here. No new write capability beyond the four existing record tools; permissions remain the calling user's (non-negotiable boundary 1).

## Consequences

- bf-01, project CLAUDE.md and `brownfield-dd` step 14 finally state one definition. A project can no longer be blocked by an item no step produces.
- `region-lead` gains its first `brownfield-dd` step; the EU works-council override (screening step 2.5) is unchanged and remains an input to hr-integration.
- ADR-0048 registry change touches `db/lib/validator-applicability.ts`, `db/lib/validator-completeness.ts` (core-only counting), `db/repositories/compliance.repository.ts` (messages, core-only declared), and — for verification only — `db/lib/snapshot-filler.ts` (unchanged by design). Tests: `dd-cross-validation`, `migration-0016`, `rule-assessment`, `compliance-not-applicable`, `validator-completeness`. `declared = 6` and the migration-0016 CHECK are unchanged; no migration is expected.
- Surfaces not yet examined, now on the verification list: UI components rendering validator names, MCP payloads (`get_project_dd_workspace`, `tailor_dd_checklist`), the `pm-router` `catalogAgent` fallback after the rename, `dry_run_session` with an unknown `prompt_key`, the flows-console activity-count test, i18n labels for the new activities, and an activity-id collision grep.
- The stepper and PM catalog show 9 more activities; activity count goes 47 → 56 (fixtures that pin counts must be updated).
- Prompt key renames change `prompts.generated.ts` and `pm-catalog.generated.ts`; any persisted audit or eval records keyed by old prompt keys remain readable as history only. `tests/eval/call-sites.yaml` exempt notes and the `pm-router.ts` `catalogAgent("s4.synergy_ic", ...)` lookup must follow the rename or routing silently falls back to the default.
- Red-team independence is restored: the register author, the financial analysis author and the challenger are three different seats.
- Cost: one ADR-batch PR is large. The design doc splits it into independently verifiable rows (procedures, registry, flow.spec, prompts, skills, personas) so the PR can be sequenced.

## Policy impact analysis and `project_policy_pin` check

**Mechanism (inspected).** `project_policy_pin` (`app/web-next/prisma/schema.prisma`, model `project_policy_pin`) pins a `policy_doc_id` + `pinned_version` per project (one live row per project and doc, `superseded_by IS NULL`). Writers are `app/web-next/lib/brownfield-subtrack.ts` and `greenfield-subtrack.ts`, which pin workspace-scope overlays (`ovl-brownfield-workspace-scope`, `ovl-greenfield-workspace-scope`) and, for greenfield DD, the procedure id `shared-greenfield-dd`. The pin's other consumer is `projectGrandfathered()` in `app/web-next/lib/process-flow.ts`, which uses the earliest `pinned_at` to decide whether Wave-F predicate tightenings apply (tightening never retroactively un-completes in-flight work, ADR-0151/0161 precedent). `process_run.spec_version` links runs to the flow.spec version (definition/execution separation, ADR-0074).

**Live data (queried read-only, `db/data/co-newbiz.sqlite`, 2026-10-26).** 31 projects; 5 pin rows across 2 projects: `ovl-brownfield-workspace-scope` 1.0.0 (superseded) and 1.2.3 (live) on one project; `ovl-greenfield-workspace-scope` 1.0.0 (superseded) and 1.1.0 (live) and `shared-greenfield-dd` 1.1.0 (live) on another. `validator_completeness_record` has 0 rows and `compliance_check` has 0 `ma-validator*` rows.

**Impact.**

| Change | Pinned? | Impact on in-flight projects |
|---|---|---|
| `brownfield-dd` new step, step 14 wording, `ma-special-topics` reword | No pin on `shared-brownfield-dd` | Applies to every brownfield project at S9 from the change date. No stored completeness record exists, so no record is invalidated. The first completeness write will use the new key set. A brownfield project already past S9 is unaffected. A brownfield project currently inside S9 must also supply the region-labor validator before DD exit; this is the intended tightening (bf-01 already demanded it). Treat as a **tightening**: apply to projects entering or still inside S9; do not reopen completed S9 (ADR-0151 precedent). |
| `greenfield-screening` / `greenfield-pre-fs` agent and skill re-points | No pin on these | Metadata only (who/skill), no new required deliverable. No effect. |
| `shared-greenfield-dd` | **Pinned 1.1.0 on one project** | **Not modified by this ADR** (greenfield-dd is untouched; the A-2 wiring is limited to `greenfield-screening` and `greenfield-pre-fs`). If the owner later wants `greenfield-dd` changed, a pin check on that project is required first. |
| `brownfield-fs-comparative` step 2 `agent_key` pm → `target-selector` | No pin | Person-role replaces AI key; `decision_authority: human` unchanged; `lib/business-case.ts selectTarget` is the writer and takes `selectedBy`, so runtime unaffected. Verify no code resolves the step's agent through `agents/pm.md`. |
| flow.spec 2.10.1 → 2.11.0 | Not pinned; runs record `spec_version` | Past runs keep their recorded version. New activities are metadata; completion criteria are unchanged, so no stage becomes "incomplete". |
| `MA_VALIDATOR_APPLICABILITY` (`region-labor` added as core, `contingent-liability` kept non-core) | n/a (code) | Snapshot coverage signal unchanged. No live records at 2026-10-26 (re-count pre-merge, below). |

**Pre-merge checks (required).** (1) Re-count `compliance_check` rows with `rule_key LIKE 'ma-validator-%'` and `validator_completeness_record` rows (2026-10-26: 0 and 0); any non-zero count must be reviewed for the core-only counting change. (2) List brownfield projects at or entering S9 (`evaluateProcess(...).currentStage = S9`) and record the list, or "none", in the PR; these are the projects newly required to supply the region-labor validator. I could not execute this check in the drafting pass.

**Not verifiable by me.** I did not run the application, so the S9 project list is a pre-merge check, not a finding (`md_project` has a `track` column; S9 position comes from `evaluateProcess`). The `compliance-officer` should confirm the "tightening applies to still-in-S9 projects" reading.

**Addendum 2026-10-26 (policy-impact note for Decision 7 and the new non-waivable validator).**

- **R-05 result**: 0 `ma-validator-%` compliance rows and 0 `validator_completeness_record` rows. No stored validator record exists, so no migration or re-evaluation is needed for the core-only counting change or for `region-labor`.
- **R-06 result**: the S9 exposure list is two projects. `DEMO-S1-S12` is a demo project already at S9. `PRJ-T7T81A` is at S8 and about to enter S9; it will be the first live project exposed to the new non-waivable `region-labor` validator (and to `ma-13` if its sub-track is `m_and_a` or `jv`). `compliance-officer` should confirm before it enters S9 that its region profile labor axis is populated. No overlay pin change is required for either project beyond the existing live pin; the overlay 1.3.0 bump takes effect for projects whose pin is moved, and the pin on the one project holding 1.2.3 is unchanged (human-initiated re-pin only).
- Overlay 1.3.0 changes counts only for `m_and_a` (+1) and `jv` (+1); the other five sub-tracks are numerically unchanged.

## Alternatives considered

- **Amend bf-01 and CLAUDE.md to name contingent liability as the sixth validator and keep region labor as an hr input (audit option B). Rejected by the owner (D-1).** It would have needed no new procedure step and no runtime registry change (the code already encodes contingent liability), and it was the cheaper path. The owner chose to keep bf-01 and CLAUDE.md as written (owner rationale not recorded beyond D-1; the audit could not establish whether design v1.0 §6.7 / meeting M5 D-M5-4 intentionally narrowed labor review to an hr input). Amending a non-waivable checklist item to match a procedure would also have inverted the authority layering for the sake of convenience. The cost of the chosen path is the registry change in 1.2.
- **Count seven validators (add region labor, keep contingent liability as counted).** Rejected: contradicts D-1 and every authority that says "six"; `declared = 6` is also pinned in `compliance.repository.ts` and migration 0016.
- **Replace the `contingent-liability` registry key with `region-labor` (first draft of 1.2).** Rejected after AI-2nd review: `snapshot-filler.ts` consumes the contingent-liability row for the D-M-RISK-5 zero-EV coverage signal, so deleting it would silently change risk snapshots. Chosen instead: keep it as a non-core row.
- **Add an S10 `site-facility-assessment` activity.** Dropped by the owner (D-6): no hosting procedure step exists and the agent is wired only where steps already are.
- **Hire new agents (tax owner, IP-FTO reviewer, certification validator).** Rejected: every gap is closed by wiring an existing agent; no failure evidence for a tax-axis hire.
- **Change the lead of `entity-establishment-execution` or `route-strategy`.** Rejected: leads are defensible or documented; persona wording and spec comments fix the drift instead.
- **Leave prompt keys with legacy prefixes and fix only the PM catalog mapping.** Rejected: the key is surfaced to humans in the catalog and routers, and a wrong stage prefix is a defect that recurs on every new prompt.
- **Delete the stub skills.** Rejected: nothing meets the deprecation bar; stubs are re-owned and rewritten, never hard-deleted (audit policy 5.3-4).

## Open items

Resolved by the owner: Q1 (D-3), Q3 (D-4), Q6 (D-5), Q4 (D-6), Q10 (D-7). PM defaults awaiting override at PR review: BU-establishment step 3 split; brownfield integration milestones out of scope for `s12.milestone_suggest`; Q8 owners; both new skills start `experimental`; step id 6.5 conditional on `_validate.ts` and `graph-map.ts --check`. Still open: the exact R&BD applicability flag variable for step 3.5 (implementer to confirm the routing var behind `technology_track`); a skill for `ip-fto-review` is specified in the design doc.
