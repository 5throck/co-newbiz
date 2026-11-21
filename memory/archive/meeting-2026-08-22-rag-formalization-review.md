# Meeting — RAG Formalization & Classification-Axis Redesign Review (2026-08-22)

## Agenda and Purpose

A six-perspective red-team review of the "judgment-system formalization · classification-axis redesign · workflow gap closure" plan built through Stage 5. The review axes were fixed at five:

1. Where does execution break (unimplementable premises)
2. What does the plan claim to do but actually cannot
3. What is missing (omissions)
4. Where is the ordering wrong (sequencing errors)
5. Are there governance violations

Session composition: risk-officer (red team, solo), process-governance-manager + compliance-officer (governance, joint), data-architect + platform-lead (schema/sequencing, joint), market-intelligence-agent + quant-methodologist (market dimension, joint), brownfield-agent + greenfield-agent (classification practice, joint), legal-counsel (legal/certification boundary, solo). Six perspective groups in total.

The original plan's central claim — that PR-5b could safely skip the six mandatory validators via an `origin='internal'` classification — was the primary target of this review.

---

## Perspective Statements

### 1. risk-officer (red team)

- **F2 (critical)**: `md_project` has no stage column, so code cannot determine "frozen at Screening time." The timing premise of the classification-skip logic does not exist in the schema.
- **F3 (critical)**: The DD-exit cross-validation (`origin` vs `dd_finding.rbd_source`) is blind to exactly the case it must catch — if a deal is misclassified `origin=internal` and its R&BD phase skipped, no `rbd_source` row ever exists, so there is nothing to compare against.
- **F6**: PR-5c (completeness check) has zero production callers today, so this is not "making an existing control classification-dependent" but "creating a control while simultaneously making it classification-dependent" — a top residual risk that must be correct from its very first execution.
- **F7**: If the kill-criteria "declared N / executable M" ratio lives only in a rationale string, regressions cannot be caught. `_validate.ts --strict` must be gated to fail on any drop against baseline, and it must surface in `audit.ts` output too.
- **F8**: Risk vars are missing partner-sourcing failure (`partner_candidate.status`+`dependency_risk`, ADR-0031) — one of risk-officer's own three kill triggers was entirely absent from the original plan.
- **F10**: It is unverified whether `PRAGMA foreign_keys=ON` is actually applied on the boot path.
- **F11**: `_validate.ts`'s referential-integrity warnings are silent without VERBOSE — they should always print.

### 2. process-governance-manager + compliance-officer (governance, joint)

- **Governance #2 (critical)**: `compliance_check.result` has no `not_applicable` value, so validators skipped via classification are recorded as `result='pass'` ("satisfied") — a false statement left in the audit trail.
- **Governance #8**: The `project_policy_pin` backfill was missing from the original plan — without it every existing project (including pilots 011–014) hard-blocks for having no classification.
- **Governance #13**: `case_subtype` logic exists in four mirrored copies (`skills/` + `.claude/` + `.gemini/` + `.agents/`) while the plan only handled the canonical copy — all four need sweeping.
- **Classification write-authority asymmetry agreement (round 1)**: `origin='external'` (only enlarges the validator set) may be written solo with a mandatory rationale. `origin ∈ {internal, hybrid, joint}` (shrinks the validator set) requires two-party approval — demanding at least waiver-grade cost.
- **Strongest dissent raised (PGM)**: There is precedent for D-M3-1~4 being used live while uncalibrated — cited as evidence that documentation alone does not control.
- **compliance-officer rebuttal and alternative**: The control that actually worked in that precedent was not documentation but "the procedure itself, where a human verified every grade directly." Proposal: unverified market/technical/risk rules, even after `enabled=1`, may only emit Amber or Red — never Green (a Green cap / Amber ceiling). Grounding: ADR-0016's overall rule already requires all-six-Green-for-Green, so capping those three dimensions at Amber costs effectively zero.

### 3. data-architect + platform-lead (schema/sequencing, joint)

- **F-17a (critical)**: The plan's rule of "flatten missing condition_expr vars to UNASSESSED" is wrong — Kleene three-valued logic is required (`any_of(TRUE,UNASSESSED)=TRUE`, `at_least(k=2,[TRUE,TRUE,UNASSESSED])=TRUE`, `all_of(FALSE,UNASSESSED)=FALSE`, symmetric `none_of`). Getting it lenient wrong reproduces exactly the false passes the plan tries to block; getting it conservative wrong kills features permanently.
- **F-2**: `rag_rule` has 0 rows and 0 readers — DROP+CREATE redefinition, not an additive migration, is the last safe window for it.
- **F-17b**: `renderKo` produces governance artifacts (reviewer signature targets), so it demands particle selection (Korean euphonic particles) and negation scope — 6 operators × 6 units × N variables; PR-1's estimate must be tripled.
- **F-6**: The claim that an evidence registry "solves the refactor problem" is half true — physical column renames are solved, but renaming registry keys themselves touches every rule file, `applies_when`, and `dimension_input` row; SQL cannot answer reference integrity.
- **F-7/F-8/F-9**: The dynamic-query design (`{kind:"column", table, column, aggregate:"latest"}`) breaks three ways — (a) more than half the tables lack timestamps so "latest" is undefined, (b) string-interpolated identifiers create an injection surface, (c) one query per var per evaluation multiplies N+1. Counter-proposal: a per-run snapshot table (`project_variable_snapshot`) filled once per run.
- **F-15/F-16 (co-cited with compliance-officer #12)**: `dimension_input`'s `project_id TEXT PRIMARY KEY` single-row design destroys classification history — removing precisely the audit trail meant to catch false skips. No `run_id`, so unreproducible.
- **F-18**: If a generic `cmp` predicate cannot reproduce `financialBand()`'s IEEE-754 corrections, parity tests deterministically fail at boundary values — seed mirror rows for `financial`/`regulatory_permit` are deferred.
- **F-12**: `zod` is currently only a transitive dependency — promote to direct.
- **F-3/F-4**: Floating-point money (`REAL`) violations already exist storage-wide, and `dimension_input.value_num` inherits them — full correction out of scope this round, recorded as debt via ADR. `db:export --dialect postgres` does not exist — all portability claims unverified.
- **F-14**: The `dimension_input`+`project_case_classification` schema (PR-4) must ship in the same release window as the routing code (PR-5) that proves its shape.

### 4. market-intelligence-agent + quant-methodologist (market dimension, joint)

- **Market #4 (critical)**: Mapping `value_chain_link.concentration_hhi` to "competitive intensity" is wrong — that indicator measures upstream/downstream bargaining power (industry concentration fore/aft), not horizontal competitive intensity. The two can point in opposite directions, quietly producing mis-verdicts. Split into `market.bargaining_power_hhi` (bargaining power) plus a new `market.competitive_intensity` var.
- **Market #5**: Do not leave right-to-win as a single judgment — decompose into three vars: `customer_overlap` / `tech_overlap` / `brand_transferability`. Schema cost is zero.
- **Missing low-trust exclusion**: Vars derived from `value_chain_link` should be low-trust-excluded under the same `r2 < 0.6` rule as `gradeChain()`, which is currently absent — missing vs low-trust cannot be distinguished.
- **Per-gate reduction verdict needed**: Screening (TAM/growth only, market Amber cap), Pre-FS (TAM/growth sourced), DD (full six axes active, Amber cap lifted) — noted that `docs/rag-framework.md` contains no such prose; demanded it land before PR-6 starts.

### 5. brownfield-agent + greenfield-agent (classification practice, joint)

- **Practice #2 (critical)**: If HHI/monopoly gating switches on `origin`, it turns off regardless of whether the carved-out business unit already competes in external markets. Must be replaced by a fact-based var (`target.has_external_market_presence`), orthogonal to `origin`.
- **Practice (flip 5, critical)**: The three-value `origin` has no place for a true equal-stakes JV — a pure jointly-governed JV with pari passu contributions is neither `internal` nor `external`, and does not fit the plan's `hybrid` (passive minority stake) either. Two structurally opposite deals get mixed into one bucket — a fourth value `joint` is needed.
- **Flip 6 (critical)**: PR-5a's HHI gating design itself is wrong — turning off monopoly review for `origin=internal` means that when an already-competing business unit spins off and combines with a new partner, the gate stays off even though antitrust exposure may have grown. The "quiet false skip" was not a side effect to mitigate; it was built into the gating design itself.
- **#5**: DD cross-validation results must not be always-blocking. Block only when the initial classification lacked rationale/evidence_ref; treat an evidence-backed initial classification honestly overturned by DD as a non-blocking correction (re-classify + trigger re-run of the skipped steps) — DD discovering the hypothesis wrong is normal operation, not a violation.
- **#4**: Real procedure content for cells 9/10 (pure internal ventures) and the internal-origin entity-establishment phase is a new domain — only the first thread presented here; a separate meeting recommended when PR-10 starts.
- **#6c**: The kill-criteria registry needs the same anti-tamper gate as `rag_rule` (`enabled=0`/`governance_doc`) — the plan missed this asymmetry.

### 6. legal-counsel (legal/certification boundary)

- **Flip 7 (high)**: Blocking `transferability_basis='inferred'` only via kill-criterion (gate-time, requires `enabled=1`) lets inferred values circulate freely between write time and gate evaluation. Non-negotiable boundary #5 ("no inference") is not a delayed-enforcement rule — a repository-layer hard block at write time is needed.
- **Legal #1/#6**: Move brownfield-dd step 9's skill_key to `certification-transferability` and that SKILL.md's owner to `legal-counsel` — reclassify from "user decision" item to "confirmed defect."
- **Legal #4**: Entity-establishment, IP assignment, and TUPE phases for internal-origin projects are absent from the workflow.
- **Legal #5**: The kill-criteria override-removal prohibition needs a "legally not applicable" exception path — via a recorded supersession by a higher-level regional regulation, never deletion.
- **Legal #6 (overlaps governance)**: It is unverified whether MNPI/insider-list controls catch the new write paths of `dimension_input` and `deal_structure_hypothesis`.
- **Confirmed fact**: Verified that `legal-counsel` is dispatched by no procedure anywhere. `certification-transferability`'s skill owner is `certification-agent`, yet `legal-counsel.md` declares this judgment its own responsibility — the two agent files contradict.

### Cross-Perspective Convergence (four independent perspectives)

risk-officer, compliance-officer, process-governance-manager, and brownfield-agent each reached the same conclusion independently: when `project_case_classification` says `origin='internal'`, the six mandatory validators are skipped wholesale — yet compared to `waiver` (approver, expiry, history, revocation all retained), this table carries no control beyond a single author. One UPDATE line achieves waiver-equivalent effect without a waiver. The six validators are explicitly no-waiver under ADR-0037, so a bypass looser than waivers would sit right next to the no-waiver rule. This convergence became the grounding of flip 1 (critical).

---

## Synthesis — Seven Flips Against the Original Plan

| # | Severity | Content | Raised by |
|---|---|---|---|
| 1 | Critical (independent 4-perspective convergence) | Classification (`origin='internal'`) acts as a waiver weaker than a waiver — skips the six validators with no control | risk-officer, compliance-officer, PGM, brownfield-agent |
| 2 | Critical | The `enabled=0` anti-tamper device did not actually exist — no write control on `governance_doc`; the DB default is 1 | data-architect/platform-lead |
| 3 | High | PR-4's "honest unassessed" would actually be an unsafe regression — `rankGroupAgenda` treats null as non-Red; UI shows stale confident grades | (schema-review cross-check) |
| 4 | Critical | Mapping `concentration_hhi` to competitive intensity is a mis-mapping | market-intelligence-agent/quant-methodologist |
| 5 | Critical | The three-value `origin` has no place for a true equal-stakes JV | brownfield-agent/greenfield-agent |
| 6 | Critical | PR-5a's HHI gating design itself is wrong | brownfield-agent/greenfield-agent |
| 7 | High | Certification-transferability defense via kill-criterion alone cannot close the write-to-gate gap | legal-counsel |

Each flip mapped to: Decision 5 (full redesign), Decision 1 DDL, mandatory inclusion in PR-4, Decision 6, Decision 5b (four-value origin), Decision 5e (fact-based gating), and PR-3 (write-time hard block) respectively.

---

## Disagreements and Resolutions

### 1. Classification-write approval symmetry (governance round 1)

**Issue**: Require identical approval procedure for all classification changes, or differentiate changes that enlarge the validator set from ones that shrink it?

**Resolution**: Asymmetry adopted. `origin='external'` (enlarges validator set): solo writing + mandatory rationale. `origin ∈ {internal, hybrid, joint}` (shrinks validator set): two-party approval (`approver_role`+`approved_by`+`approved_at`) mandatory — paying at least waiver-grade cost.

### 2. Green cap on uncalibrated thresholds (governance round 1, strongest dissent)

**Issue**: process-governance-manager argued, citing the precedent of D-M3-1~4 used live while uncalibrated, that registration/documentation alone is unsafe. compliance-officer countered that the control that actually worked there was "the procedure itself, where a human verified every grade directly," proposing an Amber ceiling so unverified market/technical/risk rules cannot emit Green until calibration completes.

**Resolution — confirmed as a user decision**: compliance-officer's proposal adopted. Unverified market/technical/risk rules may emit only Amber or Red even after flipping to `enabled=1`, until calibration (reproducing 5–10 historical cases) completes. Grounding: ADR-0016's overall rule already requires all-six-Green-for-Green, so capping those three dimensions at Amber costs effectively zero while preserving useful Red signals.

---

## Action Items

| Action | Grounding decision |
|---|---|
| Author the formal Stage 0.1 design doc (`docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md`) | Meeting synthesis in full; ADR-0032 documents-first principle |
| Stage 0.2 record this meeting transcript in standard form | This document |
| Stage 0.3 draft five ADRs (0046–0050) | Decisions 1/2 (0046), Decision 5b (0047), Flip 1 (0048, amending ADR-0037), PR-4 (0049, amending ADR-0016), ADR-0045 errata (0050) |
| Stage 0.4 land the per-gate reduction subsection in `docs/rag-framework.md` first | Decision 6 |
| Stage 0.5 draft meeting agendas for the three uncalibrated thresholds (`docs/decisions/open/`) | Decision 9 anti-tamper staging step 3 |
| PR-0 findings (`_validate.ts` referential integrity, `graph-map.ts`, FK boot-path verification) | risk-officer F10/F11 |
| PR-1 predicate engine (three-valued logic tables + `renderKo` + zod direct dependency) | Decision 1, F-17a, F-17b, F-12 |
| PR-2 migration (`certification` 5 columns, `rag_rule` DROP+CREATE, `evidence_var`/`rag_rule_variable`) | Decisions 1–2, F-2, F-6~F-9 |
| PR-3 kill-criteria + brownfield-dd step-9 owner transfer + `inferred` write-time hard block | Decision 8, Legal #1/#6, Flip 7 |
| PR-4 classification infrastructure (`dimension_input`+`project_case_classification`+`current_stage_gate`+`compliance_check.result` extension) | Decision 3, Decisions 5b/5c/5d, F-15/F-16, Governance #2 |
| PR-5 full classification routing (5a→5b→5c order, `project_policy_pin` backfill) | Decision 5 in full, Flips 1/5/6, Governance #8 |
| PR-6 market dimension (mapping fix + per-gate reduction + low-trust exclusion + right_to_win decomposition) | Decision 6, Market #4/#5 |
| PR-7 technical + risk (incl. partner sourcing) | Decision 8, risk-officer F8 |
| PR-8 skill-graph hardening (sweep of the four mirrored copies) | Governance #13 |
| PR-9 rule activation (`enabled=1` + Green cap applied) | Decision 9 |
| PR-10 workflow gaps (Strategic Fit/Market DD/Legal DD/Financing/internal-origin entity establishment·IP assignment·TUPE/GF-internal gates) | Legal #4, Practice #4 |
| Apply the `enabled=0` anti-tamper gate to the kill-criteria registry | Practice #6c |
| Verify MNPI/insider-list coverage of new write paths | Legal #6, PR-4 scope |

**Two user confirmations**: (1) Decision 9 (Green cap) adopted. (2) Consolidate `case_subtype` retirement into one ADR, with retroactive `project_policy_pin` handling mandated as a required section of that ADR.

**Follow-up meeting required**: When PR-10 starts, a separate meeting for real procedure content covering cells 9/10 (pure internal ventures) and internal-origin entity-establishment phases.
