---
title: "Agent and skill placement realignment (S1–S12) — design"
date: 2026-10-26
status: approved
status_note: Owner decisions 2026-10-26 (D-1..D-7) in ADR-0185, revised after AI-2nd technical review (platform-lead, REVISE, 2 blocking findings addressed). Implementation is gated on a human approving ADR-0185 at PR merge; rows marked UNPINNED need the stated input before implementation. PM defaults (Q2, Q5, Q8, experimental status, step id 6.5) are overridable by the owner at PR review.
author: process-governance-manager
design_of_record:
  - "docs/adr/0185-agent-and-skill-placement-realignment-s1-s12.md"
  - "docs/reports/2026-10-26-flow-agent-skill-audit.md"
lang: en
---

# Agent and skill placement realignment (S1–S12) — design

## Background and scope

ADR-0185 decides the realignment; this document is the concrete change list. Authority order for every row (AGENTS.md section 7): flow.spec governs stage dispatch, procedures govern within-procedure steps, skills govern "how". Where a row touches two authorities, the procedure row lands before the flow.spec row that references it.

Out of scope: changing any activity lead, any gate, any stage/track structure, hiring an agent, deleting a skill, recording any gate verdict. Everything here is a proposal until merged; ADR-0185 itself is approved by a human at merge.

Implementation sequence (each wave independently verifiable): W1 procedures + checklists + human role + runtime registry → W2 skills → W3 prompts → W4 flow.spec + generated artifacts → W5 personas + README. Row IDs below are stable references for the implementer's PR checklist.

## Wave 1 — Procedures, checklists, human-role registry, runtime registry

### W1-A: `procedures/_shared/brownfield-dd/schema.yaml` (version 1.6.1 → 1.7.0)

| Row | Change (before → after) | Acceptance |
|---|---|---|
| P-01 | NEW step `id: 6.5` (kept only if `procedures/_validate.ts` and `graph-map.ts --check` accept fractional ids alongside the existing 2.5/5.5 usage; otherwise renumber and update R-01 `step`) (between antitrust 6 and hr 7): `gate: DD`, `agent_key: region-lead`, `skill_key: regulatory-screening` (D-4: stub filled in, re-owned to `legal-counsel`), `output_type: dd_finding`. Description: region labor-law review per `region-profiles/<ISO>.yaml` labor axis for the target jurisdiction (works council / employee consultation, collective-agreement successorship, employment-transfer regime, mandatory notice periods); its finding feeds step 7 and step 13. Cites `checklists/ma-special-topics-checklist.yaml` new item ma-13 and `brownfield-feasibility-checklist.yaml` bf-01. | Step present; `region-lead` resolves in `agents/`; `_validate.ts` clean; step order places certification (11) LAST among the six |
| P-02 | Step 14 `description`: replace "(steps 6-11, mapped to antitrust/HR/customer/incentive/contingent-liability/certification — certification LAST …)" with "the six M&A validators are steps 6 (antitrust), 6.5 (region-lead labor review), 7 (hr-integration), 8 (customer-retention), 9 (incentive), 11 (certification transferability, LAST); step 10 (contingent liability) is a mandatory DD step outside the six-validator core, standard waiver path". "Declared 6" unchanged. | Wording matches bf-01 exactly (six names); declared stays 6 |
| P-03 | Step 10 `description`: append "Not one of the six M&A validators (D-1, ADR-0185); the covenant-breach kill criterion still applies." Kill criterion `any_of_six_ma_validators_missing_at_dd_exit` unchanged. | No kill criterion removed |
| P-04 | Step 3 `agent_key: technical-dd-agent` unchanged; description narrowed to TRL/production-process/core-technology checklist; the IP/FTO sentence moves to new step below. | Step 3 no longer mentions IP/FTO as its deliverable |
| P-05 | NEW step `id: 3.5`: `gate: DD`, `agent_key: ip-agent`, `skill_key: ip-fto-review` (new skill, W2-C2), `output_type: dd_finding`, `applies_when` on the R&BD flag: `{ op: "in", var: "project.technology_track", values: ["rbd"] }` (UNPINNED: confirm the routing var name behind `technology_track` used by `db/lib/validator-applicability.ts` `TRACK_NONE()`). Content: patent landscape, FTO, target IP valuation per `checklists/rbd-technology-checklist.yaml`. | `_validate.ts` accepts the step-level applies_when; not-applicable for non-R&BD |

### W1-B: `checklists/`

| Row | File | Change | Acceptance |
|---|---|---|---|
| C-01 | `checklists/ma-special-topics-checklist.yaml` (1.4.3 → 1.5.0) | Add item `ma-13`: region-lead labor review (works council, successorship, employment-transfer regime) — `mandatory: true`, `waiver_eligible: false` (counted validator under bf-01). Evaluation-order header comment: antitrust → region labor + hr → customer + incentive → certification LAST. ma-10 and ma-11 get a comment "DD items outside the six-validator core (D-1)"; their `waiver_eligible: true` is unchanged. | Checklist validates; ma-12 remains last in order |
| C-02 | `checklists/brownfield-feasibility-checklist.yaml` | NO change to bf-01 (D-1). | `git diff` empty for bf-01 |
| C-03 | project `CLAUDE.md` | NO change (D-1). | `git diff` empty |

### W1-C: Certification skill bindings (F-3)

| Row | File / step | Before → After |
|---|---|---|
| S-01 | `procedures/_shared/brownfield-pre-fs/schema.yaml` step 3 (v1.4.0 → 1.4.1) | `skill_key: permit-pathway-mapping` → `certification-transferability` (agent `certification-agent` unchanged; judgment stays with `legal-counsel` per agent description) |
| S-02 | `procedures/_shared/greenfield-pre-fs/schema.yaml` step 5 (v1.2.0 → 1.2.1) | `permit-pathway-mapping` → `certification-transferability` (keep "mark not-applicable unless the thesis depends on a certified operation or partner") |
| S-03 | `procedures/_shared/business-unit-establishment-execution/schema.yaml` step 3 (1.0.0 → 1.1.0) | UNPINNED (Q2). Proposed: split into step 3 (permit-holder classification, `skill_key: permit-pathway-mapping`, `output_type` renamed/new `permit_holder_check`) and step 3.5 (certification holder check, `legal-counsel`, `certification-transferability`, `output_type: certification_transferability_check`). Verify consumers of `certification_transferability_check` and `procedures/_output-types.yaml` before renaming any output type. |
| S-04 | `entity-establishment-execution` step 3 | Already `certification-transferability` — no change (listed so the implementer does not re-edit). |

Acceptance for all S-0x: `grep -rn "certification_transferability_check" -B3 procedures/_shared | grep skill_key` shows only `certification-transferability`.

### W1-D: `project-review` rebinding (F-5)

| Row | File / step | Before → After |
|---|---|---|
| S-05 | `portfolio-venture-monitoring` step 2 (1.2.0 → 1.2.1), agent `process-governance-manager` | `skill_key: project-review` → `portfolio-fit-assessment` |
| S-06 | `deal-shape-chain` step 6 (1.0.0 → 1.0.1), agent `partnership-agent` | `project-review` → `partnership-health-scorecard` |
| S-07 | `jv-lifecycle-governance` step 2 (1.1.0 → 1.1.1), agent `partnership-agent` | `project-review` → `partnership-health-scorecard` |

Acceptance: `grep -rn "skill_key: project-review" procedures` returns nothing. The other `project-review` matches (target-identification etc.) are comments only.

### W1-E: Agent wiring

| Row | File / step | Before → After |
|---|---|---|
| A-02a | `greenfield-screening` step 3 (1.3.0 → 1.4.0) | `agent_key: greenfield-agent` → `site-facility-agent` (skill `site-infrastructure-assessment` unchanged) |
| A-02b | `greenfield-pre-fs` step 3 | `greenfield-agent` → `site-facility-agent` (same skill) |
| A-02c | `greenfield-agent` remains lead of the S3/S4 activities; the activity-vs-step divergence is recorded by a spec comment (F-08 dropped, D-6). | Divergence recorded, not hidden |
| A-03 | `brownfield-dd` P-05 above | — |

### W1-F: Human-role registry (A-5, ADR-0053)

| Row | File | Change |
|---|---|---|
| H-01 | `procedures/_human-roles.yaml` | Add `target-selector`: "Person who records the S8 target selection (brownfield-fs-comparative step 2): the selected target id, the rationale, and the selector; agents attach the step-1 comparison and recommendation and never select (boundary #2)". Reference: `docs/designs/2026-09-22-s8-multi-target-feasibility-design.md`, `lib/business-case.ts selectTarget`. Existing keys (confirmed): `entity-ic-reviewer`, `bau-exit-certifier`, `venture-portfolio-ic`, `execution-baseline-confirmer` — none covers target selection, so a new key is required. |
| H-02 | `procedures/_shared/brownfield-fs-comparative/schema.yaml` step 2 (1.0.0 → 1.0.1) | `agent_key: pm` → `target-selector` (`decision_authority: human` already present, satisfying the consistency rule) |

Acceptance: `graph-map.ts --check` and `_validate.ts` accept the key; no `agents/target-selector.md` exists (that absence is the point). Verify no code resolves step 2's agent through `agents/pm.md` (grep `target_selection_record`, `s8_target_select`).

### W1-G: Runtime validator registry (amends ADR-0048; AI-2nd BLOCKING 1 and 2 addressed)

Design: keep `contingent-liability` as a NON-COUNTED row, add `region-labor` as a core row. Seven keys, six core. `declared = 6` and the migration-0016 CHECK stay true; `snapshot-filler.ts` keeps its coverage signal.

| Row | File | Change |
|---|---|---|
| R-01 | `db/lib/validator-applicability.ts` | `MaValidatorKey` += `"region-labor"` (keep `"contingent-liability"`). `MaValidatorApplicability` += `in_core: boolean`; `step` type `6 \| 7 \| 8 \| 9 \| 10 \| 11` gains `6.5`. New row `{ key: "region-labor", procedure: "shared-brownfield-dd", step: 6.5, in_core: true, applies_when: skipOnly(GREENFIELD(), INTERNAL()), rationale }` (D-3). Existing `contingent-liability` row unchanged except `in_core: false`. All other rows `in_core: true`. Update the doc comment "The six no-waiver M&A validators (steps 6-11)". Registry order: antitrust, region-labor, hr-comp, customer, incentive, contingent-liability (non-core), certification (LAST). |
| R-02 | `db/repositories/compliance.repository.ts` | `declared` stays pinned to 6 and is compared against the number of `in_core` rows; the `ev.validators.length !== 6` check and the "duplicate or missing validator keys" message (~lines 81–89) list the six core keys `antitrust, region-labor, hr-comp, customer, incentive, certification` (contingent-liability is accepted as an additional non-core row or omitted — decide with R-03, UNPINNED); the `not_applicable_write_rejected` message (~209) lists the same six plus a note about the non-core row. `not_applicable` writes for `contingent-liability` stay legal and are no longer counted toward the six (they do not change `applicable_count`/`completed_count`). |
| R-03 | `db/lib/validator-completeness.ts` and migration 0016 | `evaluateValidatorCompleteness` returns all registry rows but computes `applicable_count`, `completed_count` and the halt on `in_core` rows only. Check whether SQL constrains the key vocabulary (0016 constrains shape: gate='dd', declared pinned 6, 0..6); if only JSON `validator_rows` carries keys, no migration. UNPINNED. |
| R-03b | `db/lib/snapshot-filler.ts` (~529–560) | NO CHANGE by design: `CONTINGENT_VALIDATOR_KEY = "contingent-liability"` and `contingentCoverageComplete` keep working because the row stays in the registry and in the engine's `validators` output. Add a regression assertion that `validators.find(key==="contingent-liability")` is still returned. |
| R-04 | Tests | Update/extend: `tests/unit/dd-cross-validation.test.ts`, `tests/unit/migration-0016.test.ts`, `tests/unit/rule-assessment.test.ts`, `tests/unit/compliance-not-applicable.test.ts`, `tests/unit/validator-completeness.test.ts`, and any snapshot-filler test covering D-M-RISK-5 zero-EV. New cases: (i) six core rows, declared 6; (ii) `region-labor` skipped only for greenfield+internal; (iii) a `not_applicable` write for `contingent-liability` is accepted but does not change the six-count; (iv) `region-labor` missing at DD exit halts, `contingent-liability` missing does not halt but still yields `status="missing"` to the snapshot filler. |
| R-05 | Pre-merge re-count | Run `SELECT count(*) FROM compliance_check WHERE rule_key LIKE 'ma-validator-%'` and `SELECT count(*) FROM validator_completeness_record` against the target DB (2026-10-26 drafting counts: 0 and 0). Non-zero ⇒ review the core-only counting change against those rows before merge. |
| R-06 | Pre-merge rollout list | List brownfield projects at or entering S9 (`evaluateProcess(...).currentStage = S9`); state the project ids or "none" in the PR's policy-impact note. These are the projects newly required to supply `region-labor`. Not executed in the drafting pass. |

## Wave 2 — Skills (skill-lifecycle-manager; no ADR trigger, covered by ADR-0185 for traceability)

### W2-A: Owner re-assignment (frontmatter `owner:` before → after)

| Skill | Before | After |
|---|---|---|
| waiver-management | process-governance-manager | compliance-officer |
| assumption-audit | process-governance-manager | risk-officer |
| legal-risk-register | process-governance-manager | risk-officer |
| group-level-review | process-governance-manager | group-review-agent |
| company-intelligence | process-governance-manager | market-intelligence-agent |
| market-data-pipeline | process-governance-manager | market-intelligence-agent |
| forward-industry-research | process-governance-manager | market-intelligence-agent |
| value-chain-linkage-analysis | quant-methodologist | market-intelligence-agent |
| value-chain-stage-financials | process-governance-manager | financial-analyst (PM default, owner may override) |
| target-costing-analysis | process-governance-manager | quant-methodologist |
| value-chain-driver-identification | process-governance-manager | quant-methodologist |
| deal-execution-playbook | process-governance-manager | brownfield-agent |
| management-incentive-review | incentive-agent | hr-integration-agent |
| community-partnership-planning | hr-integration-agent | greenfield-agent |
| k-law | strategy-analyst (not in roster) | legal-counsel |
| k-dart | strategy-analyst (not in roster) | financial-analyst |
| k-opendata | hs-classification-specialist (not in roster) | quant-methodologist |
| regulatory-screening | process-governance-manager | legal-counsel (D-4; stub filled in, used by step 6.5) |
| zod-contract-gate | architect (not in roster) | backend-engineer (PM default) |
| design-foundation | architect (not in roster) | design-system-agent (PM default) |
| policy-and-procedure-governance, sample-driven-report-writing | process-governance-manager | unchanged (PGM owns the policy hierarchy; sample-driven-report-writing needs its stub description rewritten) |

Acceptance: every `owner:` resolves to an existing `agents/<key>.md`; add this as a skill-lifecycle check (audit policy 5.3-3).

### W2-B: Stub rewrite (S-4)

For each of the 14 stubs (assumption-audit, company-intelligence, deal-execution-playbook, forward-industry-research, group-level-review, legal-risk-register, policy-and-procedure-governance, market-data-pipeline, regulatory-screening, sample-driven-report-writing, target-costing-analysis, value-chain-stage-financials, value-chain-driver-identification, waiver-management): replace the one-line description with a "Implements step N of `<procedure>`" description, real `metadata.triggers`, and artifact; status stays `experimental` until the skill-existence bar (distinct trigger + owner + non-trivial artifact) is demonstrated. Do not restate procedure steps (boundary 3). `regulatory-screening` must be filled in first because step 6.5 and activity `region-labor-review` depend on it: description "Implements step 6.5 of `brownfield-dd` and the regulatory screens of S7/S9: …", triggers e.g. "regional labor law review", "works council", "employment transfer regime", "regulatory screening"; artifact `dd_finding` from the region profile labor axis; owner `legal-counsel`. Acceptance: no skill description equals "Skill referenced by flow.spec.yaml stage activities".

### W2-C: New skill `partnership-health-scorecard`

```yaml
name: partnership-health-scorecard
scope: co-newbiz
description: >
  Implements step 6 of `deal-shape-chain` (alliance_post_launch_review) and
  step 2 of `jv-lifecycle-governance` (jv_health_scorecard): the per-partnership
  health scorecard across the seven JV dimensions, and the dated post-launch
  review of an alliance against its selection rationale. Does not cover
  partner sourcing (partner-sourcing-strategy), partner screening
  (partner-due-diligence) or JV structuring (jv-structuring).
  Use when: "partnership health scorecard", "alliance post-launch review",
  "JV health review", "partnership monitoring".
version: 1.0.0
status: experimental
owner: partnership-agent
prerequisites: none
metadata:
  type: domain
  triggers: [partnership health scorecard, alliance post-launch review, JV health review, partnership monitoring]
```

Body: inputs (selection rationale from the P3 scorecard, JV agreement terms), method (seven dimensions named in `jv-lifecycle-governance` step 2 — performance, people, partner alignment, decision health, milestones & funding, governance health, value-distribution symmetry — referenced, not restated), artifacts (`jv_health_scorecard`, `alliance_post_launch_review`), proposal-only clause, and an explicit "could not verify" section (review model). Weights and cadence remain a thresholds-meeting item (ADR-0052 question b), not decided here. Existence-bar check: distinct trigger — yes; owner `partnership-agent` exists and its description names the S12 scorecard; non-trivial artifacts — two named output types. No existing skill overlaps (`portfolio-fit-assessment` group-level; `jv-structuring` structuring). Register in `skills/SKILLS.md` and `.claude`/`.gemini` skill mirrors via platform-skill-lifecycle-manager. Acceptance: skill lifecycle validators clean; referenced by S-06/S-07 and W4 row F-12.

### W2-C2: New skill `ip-fto-review` (D-5)

```yaml
name: ip-fto-review
scope: co-newbiz
description: >
  Implements step 3.5 of `brownfield-dd` (R&BD deals only): the patent
  landscape, freedom-to-operate position and target IP valuation finding
  that `rbd-technology-checklist.yaml` requires. Not a TRL, capex or EHS
  review (technical-due-diligence) and not a contract or statute review
  (legal-due-diligence).
  Use when: "freedom to operate", "FTO", "IP landscape", "patent landscape",
  "target IP valuation", "technology license-in IP position".
version: 1.0.0
status: experimental
owner: ip-agent
prerequisites: none
metadata:
  type: domain
  triggers: [freedom to operate, FTO, IP landscape, patent landscape, target IP valuation]
```

Body: inputs (technology description, claimed patents, license terms), method (landscape search scope declared with its limits, claim-to-product mapping, FTO conclusion graded by evidence nature), artifact (`dd_finding`, with `value_impact` or an `assumption_key` so it moves the valuation — `dd-to-valuation-bridge`), proposal-only clause, mandatory "could not verify" section (an FTO conclusion without counsel review is a proposal; statute questions route to `legal-counsel`). Existence bar: distinct trigger — yes; owner `ip-agent` exists and its description names FTO and IP valuation; non-trivial artifact — yes; no overlap with `technical-due-diligence` (TRL/EHS/capex) or `legal-due-diligence`. Starts `experimental` (PM default). Acceptance: skill lifecycle validators clean; referenced by P-05 and F-07; add to `ip-agent` required skills (G-08).

### W2-D: Required-skills edits

| Row | Agent | Change |
|---|---|---|
| S-08 | `financial-analyst` | add `k-dart` to `required_skills` |
| S-09 | `financing-agent` | `required_skills: []` → `[financing-plan-review]` |
| S-10 | k-data connectors | attach `k-kosis`/`k-ecos` to S1 `market-research`, `k-ecos`/`k-krx` to S8 `quant-methods` ONLY after confirming the spec validator accepts `scope: common` skills. UNPINNED: run `tests/unit/process-flow.test.ts` with one skill added first; if rejected, drop S-10 and record. |

## Wave 3 — Prompt catalog (`app/web-next/prompts/prompts.json` SSOT)

### W3-A: Key renames (old → new) and every non-generated reference to update

| Old key | New key | Files |
|---|---|---|
| `s3.opportunity_factors` | `s2.opportunity_factors` | `app/web-next/prompts/prompts.json`, `scripts/co-newbiz/generate-prompt-registry.ts` (key list line ~107), `app/web-next/lib/opportunity-factors.ts` |
| `s4.synergy_fa` | `s3.synergy_fa` | `prompts.json`, `generate-prompt-registry.ts` (~112), `app/web-next/lib/synergy-pipeline.ts` |
| `s4.synergy_synergy` | `s3.synergy_synergy` | `prompts.json`, `generate-prompt-registry.ts` (~113), `app/web-next/lib/synergy-pipeline.ts`, `app/web-next/app/api/synergy/ai-areas/route.ts` |
| `s4.synergy_ic` | `s3.synergy_ic` | `prompts.json`, `generate-prompt-registry.ts` (~114), `synergy-pipeline.ts`, `app/web-next/lib/synergy-rescore.ts`, `app/web-next/lib/pm-router.ts` (line ~62 `catalogAgent("s4.synergy_ic", "risk-officer")`), `app/web-next/app/api/synergy/ai-score-adjustment/route.ts`, `tests/eval/call-sites.yaml` (exempt note text) |
| `s8.deal_structure_recommendation` | `s10.deal_structure_recommendation` | `prompts.json`, `generate-prompt-registry.ts` (~128), `app/web-next/app/api/projects/[id]/deal-structure-recommendation/route.ts` |
| `s11.monitoring_brief` | `s12.monitoring_brief` | `prompts.json`, `generate-prompt-registry.ts` (~130), `app/web-next/app/api/projects/[id]/monitoring-brief/route.ts` |

Regenerated, never hand-edited: `app/web-next/lib/prompts.generated.ts`, `app/web-next/lib/pm-catalog.generated.ts`. Historical records that quote old keys are left as written (`CHANGELOG.md`, `docs/decisions/DEC-20261025-01.md`, `docs/designs/2026-10-18-synergy-4element-design.md`, `docs/designs/2026-10-25-agent-assignment-prompt-standard-design.md`, `docs/reports/2026-10-26-flow-agent-skill-audit.md`); add one note line to the 10-25 prompt-standard design pointing to ADR-0185 for the rename. UNPINNED: grep `tests/` and `app/web-next/messages/` (ko/en catalogs) once more at implementation time for key literals; this pass found only `tests/eval/call-sites.yaml`.

Acceptance: `grep -rn` for each old key in `app/ scripts/ tests/ mcp/` returns nothing; `generate-prompt-registry.ts --check` and `generate-pm-catalog.ts --check` pass.

### W3-B: Activity mappings (`activity` field, format `S<n>.<activity-id>`)

| Prompt key | Before → After |
|---|---|
| `s3.capability_gap_draft` | none → `S3.strategic-fit-screening` |
| `s3.attractiveness_recommendation` | none → `S3.strategic-fit-screening` |
| `s8.business_case_prose` | none → `S8.business-case-modeling` (agent stays null) |
| `s8.business_case_adoption` | none → `S8.valuation` (UNPINNED: audit offers `valuation` or `target-selection`; proposed `valuation` because agent is valuation-agent) |
| `company_profile.competitor_web_search` | none → `S3.our-company-profile` |
| `s12.milestone_suggest` | none → `S12.portfolio-monitoring` |
| `s10.site_regulatory_draft` | stays unmapped (D-6: S10 activity dropped); note the known gap in the PM catalog comment |
| `s3.synergy_*`, `s2.opportunity_factors`, `s10.deal_structure_recommendation`, `s12.monitoring_brief` | activity ids already correct; only the key prefix changes |

Unchanged (legitimately cross-stage): `pm.query_classify`, `pm.flow_suggest`, `committee.position`, `opportunity.gate_brief`, `project.gate_brief`.

### W3-C: Agent rebinds (red-team independence)

| Prompt (new key) | Before → After | Reason |
|---|---|---|
| `s3.synergy_fa` | risk-officer → financial-analyst | Deriving strengths/weaknesses from financial data is analysis; `financial-analyst` already leads S3 `our-company-profile` |
| `s3.capability_gap_draft` | risk-officer → process-governance-manager | A red-team seat must not author the required-capability register it later challenges; PGM leads S3 `strategic-fit-screening` |
| `s3.synergy_synergy`, `s3.synergy_ic` | risk-officer (kept) | `risk-officer` persona assigns the S3 synergy score; the score is its own recommendation, reviewed by a different domain at 2nd stage |

Implementation notes: (a) `pm-router.ts` resolves agents from the catalog via `catalogAgent(key, fallback)`, so the new keys and the fallback arguments must be checked after the rename; (b) after rebind, the 3-stage review's author-domain resolution (`domain:` frontmatter, ADR-0153) changes for these artifacts — confirm `app/web-next/lib/review/domains.ts` still routes the second review to a different domain than the author; (c) DUAL_ASSIGNMENT list in the generator (s11.integrated_insight) is unchanged. Independence check (recorded, ADR-0185 5.5): per `app/web-next/lib/review/domains.ts` (ADR-0153) `financial-analyst`, `risk-officer` and `process-governance-manager` all have `domain: functional`, and `DEFAULT_REVIEWER_DOMAIN.functional = technical` ⇒ the AI-2nd reviewer for `s3.synergy_fa` and `s3.capability_gap_draft` outputs is `platform-lead` both before and after the rebind; no same-domain review is created. Add a unit assertion with `selectReviewer(["financial-analyst"])` → ok, reviewerDomain `technical`. Acceptance: `prompts.json` agent field equals the new owner; generator `--check` passes; no prompt whose agent is `risk-officer` is the author of an artifact `risk-officer` later reviews at S11 `risk-review`.

### W3-D: Wording (F-9)

`s12.milestone_suggest`: remove the sentence defining the two tracks from the system instruction; the user-message template (application code, locate with `grep -rn "milestone_suggest" app/web-next`) carries the track as an evidence-block field using the glossary terms. Category vocabulary unchanged; state in the user-message evidence block that brownfield integration milestones are out of scope (`pmi-agent` owns them via S12 `integration-monitoring`) — PM default for Q5, owner may override. Optional minor: merge the two `s3.synergy_fa` Task imperatives into one action with two outputs. Acceptance: prompt still has exactly the 5 declared section headings (generator hard rule), sentence-length advisory unchanged, JSON output contract unchanged.

## Wave 4 — `process/flow.spec.yaml` (2.10.1 → 2.11.0) and generated artifacts

Version rationale: activities added, no structural change, precedent v2.10.0 (`capability-dd`). Add a `# v2.11.0 — …` header comment citing ADR-0185 and this design, set `meta.version: "2.11.0"`.

### W4-A: New activities

| Row | Stage | Activity id | Agent | Skills | Procedure | Notes |
|---|---|---|---|---|---|---|
| F-01 | S9 | `antitrust-dd` | antitrust-agent | [antitrust-screening] | [brownfield-dd] | step 6 |
| F-02 | S9 | `region-labor-review` | region-lead | [regulatory-screening] | [brownfield-dd] | step 6.5; first S9 activity led by a domain lead; ADR-0185 1.1b |
| F-03 | S9 | `customer-retention-dd` | customer-retention-agent | [customer-attrition-risk] | [brownfield-dd] | step 8 |
| F-04 | S9 | `incentive-dd` | incentive-agent | [incentive-clawback-assessment] | [brownfield-dd] | step 9 |
| F-05 | S9 | `contingent-liability-dd` | valuation-agent | [debt-and-contingent-liability-simulation] | [brownfield-dd] | step 10; comment "not one of the six validators (D-1)" |
| F-06 | S9 | `certification-transferability-dd` | legal-counsel | [certification-transferability] | [brownfield-dd] | step 11; comment "LAST" |
| F-07 | S9 | `ip-fto-dd` | ip-agent | [ip-fto-review] | [brownfield-dd] | step 3.5, R&BD only |
| F-08 | S10 | — | — | — | — | DROPPED (D-6): no S10 `site-facility-assessment` activity; row id retained so later row ids stay stable. `site-facility-agent` stays on `greenfield-screening` step 3 and `greenfield-pre-fs` step 3 only; the activity-vs-step divergence (S3/S4 activities led by `greenfield-agent`) is recorded as a comment on those activities. |
| F-09 | S4 | `wacc-hurdle-confirmation` | valuation-agent | [wacc-input-session] | [greenfield-pre-fs, brownfield-pre-fs] | steps: greenfield-pre-fs 2, brownfield-pre-fs 1 |
| F-10 | S4 | `certification-screen` | certification-agent | [certification-roadmap, certification-transferability] | [greenfield-pre-fs, brownfield-pre-fs] | greenfield 5/5.5, brownfield 3/3.5 |

Each S9 activity inherits S9 `applicableTracks`; because `procedure: [brownfield-dd]` carries `applies_when case_type=brownfield`, greenfield projects skip them (same mechanism as `capability-dd`). Activity count 47 → 56 (+7 S9, +2 S4, +0 S10). Update `completionCriteria` wording only if needed to mention "six validators recorded"; do not weaken any criterion.

### W4-B: Skills lists aligned to hosted steps (P-5)

| Stage.activity | Add |
|---|---|
| S1.market-research | forward-industry-research |
| S7.target-ranking | peer-benchmarking |
| S8.business-case-modeling | target-costing-analysis, financial-statement-analysis |
| S8.quant-methods | proxy-industry-chain, unit-conversion-calibration, value-chain-driver-identification |
| S9.technical-dd | site-visit-protocol |
| S9.hr-dd | management-incentive-review, compensation-harmonization-analysis |
| S9.financing-dd | financing-plan-review |
| S11.risk-review | rag-scoring-framework |
| S11.greenfield-execution-baseline | greenfield-feasibility, talent-pipeline-planning |
| S12.partnership-monitoring | partnership-health-scorecard |

(F-11 = this table.) Acceptance: for every procedure step hosted by an activity, its `skill_key` is in the activity's `skills:` (the new warn check below reports zero for these).

### W4-C: Comment-only intent (A-6)

F-12: comments on `route-strategy` and `target-selection` recording that `pm` leads as gateway assembler (route-strategy: runtime PM prompt `s4.route_recommendation` is the intended synthesis surface; target-selection: PM attaches the comparison to the fs proposal, the person-role `target-selector` records the selection). F-13: comment on S11 `entity-establishment-execution` recording PGM leads as coordinate-and-close (1 of 5 steps).

### W4-D: Validator warn (policy 5.3-2)

F-14: in `procedures/_validate.ts` or `scripts/co-newbiz/generate-spec-activities.ts`, add a WARN (not error) when a procedure step hosted by an activity has a `skill_key` missing from that activity's `skills:`. Acceptance: runs clean at the end of this change; new test case in `tests/unit/process-flow.test.ts` or a validator test.

### W4-E: Generated artifacts (regenerate, never hand-edit)

`docs/process-flow.md` (generate-process-flow), `app/web-next/lib/pm-catalog.generated.ts` (generate-pm-catalog), `app/web-next/lib/prompts.generated.ts` (generate-prompt-registry), spec activities projection (generate-spec-activities), `docs/graph/graph.*` if `graph-map.ts` is part of the audit. Fixtures that pin activity counts or lists (`tests/unit/process-flow.test.ts`, `tests/unit/flows-console-view.test.ts`, `/flows` console geometry machine-check which sizes cards by activity count) must be updated; the flows console renders S9/S4/S10 with more cards — check no card overlaps (`tests/unit/flows-console-view.test.ts` geometry check) and the i18n catalogs for new activity labels (`flows-i18n-resolution.test.ts`).

## Wave 5 — Personas and README (sync script)

Edit `agents/*.md` (SSOT), then run `bun scripts/co-newbiz/sync-agent-personas.ts` to regenerate `.claude/agents/`.

| Row | File | Change |
|---|---|---|
| G-01 | `agents/process-governance-manager.md` | S11: "execute establishment" → "coordinate and close" (PGM owns step 5, gate record; steps 1–3 are `legal-counsel`, 4 `hr-integration-agent`); "Gate Assembly and RAG Grade Proposals" → PGM assembles the gate proposal and runs the kill-criteria check; the RAG-grade proposal is produced by `risk-officer` at `entity-ic-review` step 1 with `rag-scoring-framework` |
| G-02 | `agents/risk-officer.md` | State that it does not draft the S3 required-capability register or derive financial strengths/weaknesses; it challenges them; S3 synergy score stays |
| G-03 | `agents/financial-analyst.md` | Add S3 `s3.synergy_fa` strengths/weaknesses derivation; add `k-dart` to required skills |
| G-04 | `agents/hr-integration-agent.md` | Owns `management-incentive-review` |
| G-05 | `agents/incentive-agent.md` | Scope narrowed to incentives and clawback (exec comp review moves to hr-integration) |
| G-06 | `agents/financing-agent.md` | `required_skills: [financing-plan-review]` |
| G-07 | `agents/region-lead.md` | Legal Basis: registered exception updated to ×2 (EU override and `brownfield-dd` labor-review step 6.5), ADR-0185 1.1b |
| G-08 | `agents/site-facility-agent.md`, `agents/ip-agent.md` | site-facility-agent: dispatched in greenfield-screening/pre-fs step 3 only (no S10 activity). ip-agent: brownfield-dd step 3.5, `required_skills: [ip-fto-review]` |
| G-09 | `agents/README.md` (and `README_ko.md` if kept in parity) | Domain-leads row: "`region-lead` ×2"; docs-writer class note ("two deal procedure steps: `entity-ic-review` 4.6, `group-investment-review` 4.5"); site-facility-agent, ip-agent now step-dispatched; counts refreshed; regenerate any generated README tables (`AGENTS.md` roster domain counts unchanged: no agent added or removed) |

## Acceptance summary (per wave)

| Wave | Gate to pass |
|---|---|
| W1 | `procedures/_validate.ts` 0 errors; `graph-map.ts --check`; bf-01 unchanged; the five validator tests in R-04 green; `snapshot-filler` coverage signal unchanged; six names in step 14 equal bf-01's six; R-05 and R-06 recorded |
| W2 | Skill lifecycle validators; every `owner:` resolves; no stub description left; `partnership-health-scorecard` resolves from procedures |
| W3 | Generators `--check`; no old key remains in code; synergy and capability-gap routes still return proposal-only output (unit tests for `synergy-pipeline`, `synergy-rescore`, `pm-router`) |
| W4 | `process-flow.test.ts` green; `generate-process-flow --check`; `generate-pm-catalog --check`; flows-console tests green with 56 activities |
| W5 | `sync-agent-personas.ts --check`; `agent:verify`; `audit.ts` 0 errors |

## Verification commands

Run from `/Users/techcross/git/ai_workspace/Projects/co-newbiz`:

```
bun test tests/unit/process-flow.test.ts
bun test tests/unit/dd-cross-validation.test.ts tests/unit/migration-0016.test.ts tests/unit/rule-assessment.test.ts tests/unit/compliance-not-applicable.test.ts tests/unit/validator-completeness.test.ts
bun test tests/unit/flows-console-view.test.ts tests/unit/flows-i18n-resolution.test.ts
bun procedures/_validate.ts
bun scripts/co-newbiz/graph-map.ts --check
bun scripts/co-newbiz/generate-spec-activities.ts --check
bun scripts/co-newbiz/generate-process-flow.ts --check
bun scripts/co-newbiz/generate-prompt-registry.ts --check
bun scripts/co-newbiz/generate-pm-catalog.ts --check
bun scripts/co-newbiz/sync-agent-personas.ts --check
bun run agent:verify
bun scripts/audit.ts
bun run test:unit
```

Additional surfaces to examine and verify before merge (AI-2nd review; none examined in the drafting pass):

```
grep -rn "hr-comp\|contingent-liability\|region-labor" app/web-next --include=*.ts --include=*.tsx --include=*.json   # UI components and catalogs rendering validator names
grep -rn "get_project_dd_workspace\|tailor_dd_checklist" mcp app/web-next/lib app/web-next/app/api                      # MCP payloads: validator list shape, six vs seven rows
grep -n "catalogAgent" app/web-next/lib/pm-router.ts                                                                   # fallback agent after prompt-key rename
grep -rn "prompt_key" app/web-next/app/api | grep -i dry                                                                # dry_run_session with an unknown prompt_key must fail closed, not fall back
bun test tests/unit/flows-console-view.test.ts tests/unit/flows-i18n-resolution.test.ts                              # activity-count 56, card geometry, i18n labels for the 9 new activities
node -e "const y=require('js-yaml').load(require('fs').readFileSync('process/flow.spec.yaml','utf8'));const m={};for(const st of y.stages)for(const a of st.activities||[]){(m[a.id]=m[a.id]||[]).push(st.id)};console.log(Object.entries(m).filter(([,v])=>v.length>1))"   # activity-id collision (expect none)
```

Regenerate (write mode) before `--check`: the same generators without `--check`, then `sync-agent-personas.ts`. UNPINNED: `generate-prompt-registry.ts` and `generate-process-flow.ts` `--check` support was taken from the headers of `generate-pm-catalog.ts` / `generate-process-flow.ts` / `generate-spec-activities.ts`; confirm `generate-prompt-registry.ts --check` exists (its header was not fully read), else compare `git diff --exit-code` on the generated file. The `_validate.ts` invocation form (cwd and flags) was not run. `/sync` is the final step and the only commit path (workspace rule).

## Policy impact and `project_policy_pin`

Summarised from ADR-0185: no live pin references `shared-brownfield-dd`, `greenfield-screening`, `greenfield-pre-fs` or any other procedure changed here; the one pinned procedure id in live data is `shared-greenfield-dd` 1.1.0 (one project), which this design does NOT modify. Live pins: 5 rows across 2 projects (workspace-scope overlays and `shared-greenfield-dd`). Zero validator completeness or `ma-validator*` compliance rows exist, so the key swap has no data to migrate. The one real behavioral change is the brownfield S9 tightening (new mandatory region-labor validator, non-waivable) for projects at or entering S9; pre-merge, list brownfield projects with `evaluateProcess(...).currentStage = S9` (not run here) and record the result in the PR. Policy impact analysis document for the lifecycle rule ("`policies/**`, `procedures/**`: run policy impact analysis") is this section plus ADR-0185.

## Addendum 2026-10-26 (owner decisions D-8, D-9, D-10)

- **D-8 overlay**: `ma-13` is A for `m_and_a` and `jv`, N for every other brownfield sub-track. Overlay `brownfield-workspace-scope` 1.2.3 -> 1.3.0; `jv` newly attaches `chk-ma-special-topics-checklist` (ma-01..12 N); `m_and_a` total judgeable 102 -> 103, `jv` 93 -> 94, others unchanged. `checklists/_validate.ts` accepts a binding-item exclusion only with a recorded `owner_exception` (human decision). Tests pinned to the new numbers: `tests/unit/checklist-overlay-brownfield.test.ts`, `tests/unit/brownfield-workspace-scope.test.ts`. Pending app changes (backend-engineer): `library.ts` `BF_SCOPED_EXTRA_ADDITIONS.jv`; `brownfield-subtrack.ts` binding-item handling.
- **D-9 dual assignments**: `s3.synergy_fa`, `s3.attractiveness_recommendation`, `company_profile.competitor_web_search`, `s12.milestone_suggest` (rationale per item in ADR-0185 Decision 8).
- **D-10 MCP scope**: antitrust-dd -> `record_antitrust_screen`; customer-retention-dd -> `record_customer_coc`; incentive-dd -> `record_incentive`; wacc-hurdle-confirmation -> `record_wacc`; human-only exclusions: region-labor-review, certification-screen, certification-transferability-dd, contingent-liability-dd, ip-fto-dd (ADR-0185 Decision 9).
- **Policy impact**: R-05 = 0 validator rows, no migration. R-06 = `DEMO-S1-S12` at S9; `PRJ-T7T81A` at S8 about to enter S9, exposed to the new non-waivable validator. Q11 is thereby answered (list produced from owner-supplied R-06 result, not re-queried by this agent).

## Open questions and UNPINNED items

| # | Status |
|---|---|
| Q1 | RESOLVED (D-3): `region-labor` applies except greenfield+internal |
| Q2 | PM default: split `business-unit-establishment-execution` step 3 (3 permit holder, 3.5 certification); consumers of output type `certification_transferability_check` still to be grepped by the implementer |
| Q3 | RESOLVED (D-4): `regulatory-screening` filled in, owner `legal-counsel` |
| Q4 | RESOLVED (D-6): S10 activity dropped |
| Q5 | PM default: brownfield integration milestones out of scope for `s12.milestone_suggest` |
| Q6 | RESOLVED (D-5): new skill `ip-fto-review`. STILL OPEN: the exact routing var behind the R&BD flag (`technology_track`) for the step-level `applies_when` |
| Q7 | PARTLY RESOLVED: `step` type gains 6.5 (R-01); `snapshot-filler` handled (R-03b). OPEN: whether SQL constrains the key vocabulary (migration 0016); other readers of validator keys (UI, MCP) — see surfaces list |
| Q8 | PM default: zod-contract-gate → backend-engineer, design-foundation → design-system-agent, value-chain-stage-financials → financial-analyst |
| Q9 | OPEN (implementer): test whether the spec validator accepts `scope: common` skills before attaching k-* connectors |
| Q10 | RESOLVED (D-7): `region-lead` ×2 confirmed |
| Q11 | OPEN pre-merge: R-06 list of brownfield projects at or entering S9 (not executed here) |
| Q12 | Separate ticket: trigger-overlap review (audit 5.2) |
| Q13 | OPEN: step id 6.5 survives only if `_validate.ts` and `graph-map.ts --check` pass; else renumber (PM default) |

Target-selection human role: confirmed against `procedures/_human-roles.yaml` (existing keys: `entity-ic-reviewer`, `bau-exit-certifier`, `venture-portfolio-ic`, `execution-baseline-confirmer`); none covers S8 target selection; propose `target-selector` (row H-01).
