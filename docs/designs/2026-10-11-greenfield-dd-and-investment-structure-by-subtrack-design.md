# Greenfield S9 Plan Verification and S10 Investment Structure by Sub-Track

- Date: 2026-10-11
- Status: Draft (Row 0 Design Gate)
- Owner: process-governance-manager (functional domain lead)
- ADR: ADR-0160 (Proposed) — `docs/adr/0160-greenfield-dd-and-structure-by-subtrack.md`
- Related: ADR-0045 (four structuring axes), ADR-0047 (entity establishment, origin), ADR-0052 (TRL/MRL evidence matrix), ADR-0074 (flow.spec SSOT), ADR-0099 (custom checklist items), ADR-0104 (seven DD domains), ADR-0157 (optional per-target DD), Wave F-8 (sub-track DD checklists, `WAVE_F_PREDICATE_DATE = 2026-10-08`)

## 1. Problem (user-verified)

1. **S9 is site-centric for every greenfield project.** `procedures/_shared/greenfield-dd` (mandatory, gate DD) prescribes a site visit (technical-dd + site-selection checklists), talent pipeline (ss-07), community acceptance (ss-08), the DD-to-valuation bridge and the gate pass; its kill criteria are `wastewater_capacity_insufficient_and_no_mitigation` and `dd_finding_with_value_impact_not_in_valuation_bridge`. A greenfield `existing_business_rbd` project has no new site, so site, wastewater and community items do not apply, and the S9 stage label (Korean wording meaning "due diligence / verification") reads like target-company DD.
2. **S10 is brownfield-centric.** The hypothesis inputs are `asset_or_stock`, `stake_type` (full/majority/minority/joint_control) and `instrument_mix` (primary/secondary/mixed); the activity agent is `brownfield-agent`; the procedure list is `[deal-structuring, brownfield-fs, deal-shape-chain]`. None of this describes how a new business is founded and funded.

## 2. Verified facts

### 2.1 Sub-track vocabulary (code and migrations)

| Value | Track | Source | Meaning |
|---|---|---|---|
| (null) | greenfield | 0043 `sub_track` nullable | Plain new establishment — new site / new plant (the case `greenfield-dd` was written for) |
| `existing_business_rbd` | greenfield | 0043 CHECK; `lib/labels.ts` GF_SUB (Korean label meaning "existing business R&BD expansion", marked INTERIM-WORDING Q1) | Expand an existing business through R&BD; no new site by default |
| `intra_venture` | greenfield | 0043 CHECK; GF_SUB (Korean label meaning "in-house venture (CVC)") | Internal venture / spin-off entity (ADR-0047 origin internal/joint) |
| `m_and_a`, `jv`, `strategic_investment`, `minority_investment`, `partnership`, `rbd`, `corporate_venture` | brownfield | 0049 / 0088 CHECK; BF_SUB | Brownfield routes |

**Correction to the dispatch brief:** there is no `new_site` value and `partnership` is a *brownfield* sub-track. The greenfield sub-track set is exactly {null, `existing_business_rbd`, `intra_venture`}. The database CHECK does not bind sub-track to track (0049 widened one list for both), so a greenfield row could in principle carry a brownfield value; the selection logic must treat any non-greenfield value on a greenfield route as "unknown" (fall back to the site-based default and surface a warning) rather than guess.

### 2.2 Existing selection machinery

- `lib/library.ts` `SUB_TRACK_DD_CHECKLISTS` already maps `existing_business_rbd -> [chk-rbd-technology-checklist]`, but `lib/dd-checklist-tailor.ts` `subTrackChecklistIds()` returns `[]` unless `route.track === "brownfield"`. The greenfield mapping is dead today.
- Grandfathering precedent: `subTrackChecklistIds()` returns `[]` for projects whose earliest `project_policy_pin.pinned_at` (or `created_at`) is before `WAVE_F_PREDICATE_DATE`. This design reuses the same pattern with a new cut-off constant.
- Item states: `STATE_STATUSES = pending | pass | fail | na | waived`. `ddCompletionSummary` counts unwaived mandatory `fail` as unmet; binding items (mandatory and `waiver_eligible: false`) count `na`/`waived` as unmet. "Not applicable" therefore already exists as `na`; this design requires a reason on every `na` for items the selection drops (see 4.4).
- S10 hypothesis columns (`db/repositories/deal-structure-hypothesis.repository.ts`): `asset_or_stock`, `stake_type`, `instrument_mix`, `vehicle` — all nullable. `vehicle` already includes `direct | spc | holdco | internal_venture_spinoff | jv`.

## 3. Current-state matrix (stage x track x sub-track)

| Stage | brownfield (all) | greenfield null (new site) | greenfield `existing_business_rbd` | greenfield `intra_venture` |
|---|---|---|---|---|
| S9 procedure | `brownfield-dd` + per-sub-track checklists (Wave F-8) — fits | `greenfield-dd` — fits | `greenfield-dd` — site steps 1-3 and wastewater kill do not apply; rbd-technology mapped but never selected | `greenfield-dd` — site steps do not apply unless a site is built; no venture/entity-readiness items |
| S9 label | target DD — fits | reads as target DD — misleading | misleading | misleading |
| S10 inputs | asset/stock, stake, instrument, vehicle — fits | M&A fields shown and meaningless; no capex tranches, funding sources, lease vs build | same; no staged-funding (rbd-15 real options) link | same; no entity formation vehicle link (ef-01, ef-03) |
| S10 agent / procedures | brownfield-agent; deal-structuring, brownfield-fs, deal-shape-chain — fits | wrong agent and procedures | wrong | wrong |
| S11 wording | "acquisition closing" — fits | output names both establishment and closing; investment-structuring agent is brownfield-agent | same | entity-establishment-execution applies (origin internal/joint) — fits |

## 4. Target state — S9

### 4.1 Procedure decision

Keep one procedure id `greenfield-dd` (gate `dd`, `applicability: mandatory`) and make its steps **sub-track-aware with `applies_when`** rather than creating three new procedure ids. Justification: the gate, the waiver path, the bridge rule and the governance owner are identical; only the evidence steps differ. One id keeps `project_policy_pin`, skills (`skills/*` reference procedure keys, not steps) and flow.spec activity lists stable. The procedure version bumps (minor) and step `applies_when` is validated by `_validate.ts`.

| Step | Content | null (new site) | `existing_business_rbd` | `intra_venture` |
|---|---|---|---|---|
| 1 | Site visit — technical-dd + site-selection checklists (unchanged text) | applies | applies only if `site_required = true` (see 4.3) | applies only if `site_required = true` |
| 2 | Talent pipeline / ramp-up (ss-07) | applies | replaced by step 2b | replaced by step 2b |
| 2b (new) | Core-team and capability readiness — R&BD team, key-person dependency (reuses `org-readiness-assessment` skill) | n/a | applies | applies |
| 3 | Community acceptance (ss-08) | applies | site-conditional | site-conditional |
| 3b (new) | Technology and market plan verification — rbd-technology-checklist (TRL/MRL rows rbd-08..rbd-14 at FS/DD row, FTO rbd-03, originator relationship rbd-05, obsolescence rbd-07), plus market-dd checklist | n/a (optional if technology-led) | applies | applies |
| 3c (new) | Entity readiness for the venture vehicle — entity-formation-checklist ef-01, ef-03, ef-07 (pre-formation IP) as plan-verification evidence (execution remains S11) | n/a | n/a | applies |
| 4 | DD-to-valuation bridge (every value_impact finding lands in the bridge) | applies | applies | applies |
| 5 | Gate pass record (stage-gate-governance) | applies | applies | applies |

### 4.2 Checklist selection per sub-track (S9 workspace)

The seven shared domains (ADR-0104) remain for all tracks. Additional greenfield checklists:

| Sub-track | Extra checklists | Site checklists |
|---|---|---|
| null | none new (current behaviour) | technical-dd, site-selection — unchanged |
| `existing_business_rbd` | `chk-rbd-technology-checklist` (existing mapping, activated) | only when `site_required` |
| `intra_venture` | `chk-rbd-technology-checklist`, `chk-entity-formation-checklist` (items ef-01, ef-03, ef-07 only, read as plan evidence) | only when `site_required` |

New checklist item ids: **none required.** All items exist (rbd-01..rbd-15, ef-01..ef-12, ss-01..ss-08, tdd-01..tdd-08). If the human prefers a distinct "core-team readiness" checklist item for step 2b, Row 1 adds `gf-13` to `greenfield-feasibility-checklist.yaml` (open question Q4).

### 4.3 Site applicability flag

Site steps are not removed for non-site sub-tracks; they become conditional on a recorded, human-confirmed fact "this plan needs a new or expanded site" (`site_required`). Default by sub-track: null -> true; `existing_business_rbd` and `intra_venture` -> false. Storage without a migration: a `process_run.meta_json` key on the S9 run (`s9_scope.site_required`, with `rationale`, `confirmed_by`, `confirmed_at`), same pattern as ADR-0159 item 5. If later reporting needs it as a column, that is a separate ADR.

### 4.4 Controls that do not weaken

- **Gate `dd` unchanged**; completion criterion unchanged ("every applicable item judged, zero mandatory unmet").
- **No silent drops.** For a project that already had site items instantiated, a sub-track-driven non-applicability is recorded as `status = na` with a mandatory reason string (API rejects `na` without `reason` for items whose applicability came from the sub-track rule). For new projects, items never instantiated are listed in an "excluded by sub-track rule" panel with the rule id and the `site_required` decision, so the reviewer sees what was excluded and why.
- **Binding items stay binding**: `na`/`waived` on mandatory non-waivable items still counts as unmet (existing logic).
- **Kill criteria:**
  - `greenfield-dd__dd_finding_with_value_impact_not_in_valuation_bridge` — applies to **all** greenfield sub-tracks (unchanged).
  - `greenfield-dd__wastewater_capacity_insufficient_and_no_mitigation` — gains `applies_when: site_required == true`. It is not deleted.
  - New kill criteria: none. (rbd-technology already carries the TRL evidence-quality rule rbd-14; legal-counsel to confirm in Row 4 whether an FTO-blocked kill criterion is needed — Q6.)

### 4.5 Wording (proposal only — glossary owns final terms)

S9 stage name stays the stage id; the greenfield-facing display label changes from the "due diligence / verification" wording to a "plan verification" wording, chosen via `lib/labels.ts` track-aware stage label (brownfield keeps the current label). Candidate Korean phrasings are listed as open question Q1 for the human and glossary-curator; this design does not coin the term.

## 5. Target state — S10

### 5.1 Procedure decision

Add **sub-track-aware greenfield steps inside `deal-structuring`** (procedure version minor bump) instead of a new `greenfield-deal-structuring` id. Justification: S10 has no gate; the completion predicate (four-axis review with evidence reference; sources = uses > 0) is track-neutral and must stay one rule; `deal-structuring` already names the five vehicles including `internal_venture_spinoff` and `jv`. A new id would duplicate steps 2-3 (four axes, financing plan). Greenfield steps carry `applies_when: track == greenfield`; brownfield steps carry `applies_when: track == brownfield`; shared steps carry none.

| Step | Track | Content | Owner agent | Skills |
|---|---|---|---|---|
| 1 (existing) | brownfield | Asset/stock, stake, instrument mix, vehicle | brownfield-agent | investment-vehicle-structuring |
| 1g (new) | greenfield | Establishment vehicle: direct (in-house unit), SPC, subsidiary (holdco/direct-owned), internal venture spin-off, JV; links to entity-formation ef-01/ef-03 when an entity is created | greenfield-agent | investment-vehicle-structuring, jv-structuring (JV only) |
| 1g-2 (new) | greenfield | Capital contribution and funding sources: equity, project finance, government funds and subsidies, lease versus build for site and equipment (site-facility-agent input when `site_required`) | financing-agent | financing-plan-review |
| 1g-3 (new) | greenfield | Phased capex tranches and release conditions (milestone-gated, links rbd-15 staged funding for R&BD sub-tracks) | greenfield-agent with valuation-agent | investment-feasibility-modeling |
| 1g-4 (new) | greenfield | Tax and regional incentives, with clawback conditions | incentive-agent | regional-incentive-sourcing, incentive-clawback-assessment |
| 2 (existing) | both | ADR-0045 four axes (tax structure, liability isolation, leverage, exit) with evidence reference | track lead | investment-vehicle-structuring |
| 3 (existing) | both | Sources and uses balance; covenant headroom (fin-03) | financing-agent (greenfield) / valuation-agent (brownfield, unchanged) | financing-plan-review |

flow.spec S10 activities: `deal-structure-hypothesis` gets `agent` per track. flow.spec has one `agent` per activity, so Row 1 adds a sibling activity `establishment-structure-hypothesis` (agent `greenfield-agent`, procedure `[deal-structuring, greenfield-fs]`, `applicableTracks: [greenfield]`) and narrows `deal-structure-hypothesis` to `applicableTracks: [brownfield]` — **only if** the flow.spec schema supports activity-level `applicableTracks`; otherwise Row 1 proposes the schema addition (projection test change) and stops for approval. `financing-plan` keeps `valuation-agent` and adds `financing-agent` as reviewer comment only (no schema change).

### 5.2 Inputs hidden or replaced for greenfield

| Brownfield input | Greenfield treatment |
|---|---|
| `asset_or_stock` | hidden; stored null |
| `stake_type` | hidden except vehicle = jv (then shown as "our share in JV": majority/minority/joint_control) |
| `instrument_mix` | hidden; replaced by funding-source mix recorded in the financing plan sources rows |
| `vehicle` | shown with greenfield wording; same enum |
| procedures `brownfield-fs`, `deal-shape-chain` | replaced by `greenfield-fs` |

### 5.3 DB

**No migration.** Greenfield-only fields (tranches, release conditions, lease-vs-build choice) are recorded as financing-plan source/use rows and the four-axis evidence artifact, plus a `notes_json`-style payload only if the hypothesis table already has a free JSON column; if it does not, Row 2 stores them in the S10 `process_run.meta_json` (`s10_greenfield`). If the human wants them as typed columns, that is a schema change requiring its own ADR (Q7).

### 5.4 S11 follow-ups (no change in this design)

- S11 `investment-structuring` activity agent is `brownfield-agent` for all tracks — should become track-aware.
- S11 objective and outputs mix "entity establishment or acquisition closing"; greenfield null/`existing_business_rbd` has neither a new entity (unless vehicle requires one) nor a closing — wording needed for "investment execution start".
- `financing-plan-checklist` fin-04..fin-08 (funds-flow, certain funds, escrow, reverse-termination fee) are closing-specific; greenfield should mark them `na` with reason by rule.
Filed as follow-up tickets by PM after this design is approved.

## 6. flow.spec change

- `meta.version` 2.6.0 -> **2.7.0** (minor: activity/procedure list change, no stage add/remove), header changelog comment added.
- S9: `objective` text gains the sub-track sentence; `technical-dd` activity skills add `org-readiness-assessment`; activity procedure lists unchanged (`greenfield-dd` kept).
- S10: new `establishment-structure-hypothesis` activity (greenfield), `deal-structure-hypothesis` narrowed to brownfield, procedure list for greenfield `[deal-structuring, greenfield-fs]`.
- Mirrored projections regenerated in the same PR: `docs/process-flow.md` (generate-process-flow.ts), `app/web-next/lib/process-flow.ts`, `app/web-next/lib/library.generated.ts`, stage aliases in `scripts/co-newbiz/graph.ts`, `docs/governance/process-map.md` DD and structuring rows.

## 7. System changes (Rows 2-3)

- `subTrackChecklistIds()`: allow greenfield; new map `GF_SUB_TRACK_DD_CHECKLISTS` in `lib/library.ts` (brownfield map and code path byte-identical); new cut-off constant `GF_SUBTRACK_PREDICATE_DATE` (merge date).
- Site applicability: `site_required` read/write via S9 run meta, human-only write (cookie + CSRF, `HUMAN_ONLY_ROUTES`), agents read only.
- `dd-checklist/state` API: reject `na` without `reason` when the item is sub-track-excluded.
- `DdStage.tsx`: track-aware label; "excluded by sub-track rule" panel; `site_required` control with rationale.
- `DealStructureStage.tsx` + deal-structure route/repository: track-aware form; server validation rejects `asset_or_stock` / `instrument_mix` on greenfield; brownfield validation unchanged (snapshot test asserts identical behaviour).
- MCP: `tailor_dd_checklist`, `record_deal_structure` descriptions updated; scope unchanged.

## 8. Policy impact analysis (in-flight projects)

- Mechanism: `project_policy_pin` (migration 0015) records the governance document versions a project is judged against; `subTrackChecklistIds()` already grandfathers by the earliest pin date.
- Rule: projects whose earliest pin predates the merge of this change keep the current selection (site-centric `greenfield-dd` v-current) **unless** a human opts the project in through a recorded pin migration (`migration_note`). Opt-in never deletes item state: existing site rows stay, and become `na` with reason only by a human action.
- Existing DD state is never invalidated; no completed S9 is reopened; no gate result changes retroactively.
- In-flight greenfield projects: **could not be enumerated in this Row** (local `db/data/co-newbiz.db` is empty; the running container DB was not accessible to this agent). Known from ADR-0159: `01M1MXQN21DP8KYHNW3GDSE4PW` (greenfield, currently S8; sub-track to confirm — the triggering project is `existing_business_rbd`). Row 2 must run, read-only, `SELECT m.id, m.name, r.sub_track, MIN(pp.pinned_at) FROM route_decision r JOIN md_project m ON m.source_opportunity_id = r.opportunity_id LEFT JOIN project_policy_pin pp ON pp.project_id = m.id WHERE r.track = 'greenfield' AND r.is_current = 1 GROUP BY m.id` and attach the result to the PR before the ADR can be accepted.

## 9. Review model

- AI 1st (deterministic): `procedures/_validate.ts`, kill-criteria JSON schema, flow.spec projection tests, checklist id reference lint, glossary lint.
- AI 2nd (cross-domain): risk-officer (kill-criteria scoping, optimism risk of lighter procedure), legal-counsel (wastewater kill scoping and FTO), platform-lead or auditor (brownfield byte-identity).
- Human final: required. Procedure, checklist applicability and kill-criteria changes cannot pass on AI review alone. Review output split into verified / could not verify / needs judgement.

## 10. Glossary and skills

- Glossary: new term for the greenfield S9 label (pending Q1); `existing_business_rbd` label still INTERIM-WORDING Q1.
- Skills referencing procedure keys: `site-visit-protocol`, `talent-pipeline-planning`, `community-partnership-planning`, `dd-to-valuation-bridge`, `stage-gate-governance`, `investment-vehicle-structuring`, `financing-plan-review`, `greenfield-feasibility` — keys unchanged, so no skill restates steps. No new skill: the skill-existence bar is not met (no distinct trigger and artifact beyond existing skills).

## 11. Tests

- `_validate.ts`: `applies_when` on steps and kill criteria; reject unknown sub-track values.
- Selection unit tests: matrix of {null, existing_business_rbd, intra_venture, brownfield sub-tracks} x {pinned before / after cut-off} x `site_required`.
- `na` without reason rejected; binding items still unmet with `na`.
- Brownfield regression snapshot for `subTrackChecklistIds`, `ddCompletionSummary`, deal-structure validation.
- flow.spec projection tests for 2.7.0.

## 12. Accessibility and preview

- Excluded-items panel: a list with text reasons, not colour; status announced via text labels (Onyx 3.0, design:lint).
- `site_required` control: labelled radio group with required rationale field and visible error text.
- S10 hidden fields are not rendered (not `display:none` with stale values); JV share field announced when it appears.
- Preview: one greenfield `existing_business_rbd` project, one null-sub-track greenfield, one brownfield M&A project, each in S9 and S10, desktop and mobile.

## 13. Non-goals

No change to S11 behaviour, brownfield procedures, the dd gate, RAG capping, waiver mechanism, DB schema, or human approval authority.

## 14. Rollback

Revert the PR; flow.spec returns to 2.6.0; selection falls back to the current track guard. Because no item state is deleted and the cut-off grandfathers older projects, rollback leaves no orphan state except `na` reasons and `s9_scope`/`s10_greenfield` meta keys, which are ignored by the old code.

## 15. Open questions for the human

1. Wording for the greenfield S9 label ("plan verification" family) and for the greenfield S10 label — glossary-curator proposes candidates; human chooses.
2. Confirm the greenfield sub-track list is {none, existing_business_rbd, intra_venture}; should a brownfield-only value on a greenfield route be blocked at route decision (separate ticket)?
3. Does the null sub-track (new site) keep `greenfield-dd` byte-identical in behaviour? (Design says yes.)
4. Add checklist item `gf-13` for core-team readiness, or rely on the `org-readiness-assessment` skill artifact?
5. Default `site_required` for `existing_business_rbd` = false — acceptable, or must the human always choose explicitly?
6. Is an FTO-blocked kill criterion needed for R&BD sub-tracks (legal-counsel)?
7. Typed columns for capex tranches / funding sources (needs a separate schema ADR) or meta + financing rows (no migration)?
8. Opt-in of in-flight greenfield projects: allow per-project human opt-in, or grandfather all without exception?

## 16. Task split

| Row | Task | Agent |
|---|---|---|
| 1 | `greenfield-dd` and `deal-structuring` step `applies_when`, wastewater kill scoping, flow.spec 2.7.0, process-map, ADR-0160 final text | process-governance-manager |
| 2 | Selection logic, cut-off, `site_required` human-only route, `na` reason validation, S10 server validation, projections, in-flight project query | backend-engineer |
| 3 | DdStage and DealStructureStage per track, labels | frontend-engineer |
| 4 | Cross review: risk-officer (kill criteria, lighter-procedure risk), legal-counsel (kill-criteria and FTO), auditor (brownfield byte-identity) | risk-officer, legal-counsel, auditor |
| 5 | /sync | pm |
