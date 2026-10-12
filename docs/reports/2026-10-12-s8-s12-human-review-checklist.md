# S8-S12 Human Review Checklist (ADR-0159..0164, migrations 0135..0139)

- Date: 2026-10-12
- Audience: the human reviewer (account techcross). This is a decision sheet, not an approval record. Nothing below is approved until a box is ticked by a person and recorded in the repository.
- Built from: `docs/adr/0159`..`0164`, `docs/decisions/DEC-20261012-01.md` and `-02.md`, `docs/designs/2026-10-11-*` and `2026-10-12-*`, `git log origin/main`, PR bodies #511-#514, and a grep of `app/web-next`, `db/migrations`, `checklists/_overlays`.
- Convention: "unverified" marks a statement I could not confirm from the repository. File:line references are at the time of writing (working tree on `main`; the working tree has uncommitted edits in `app/web-next/lib/execution-baseline-view.ts` and `components/stages/ExecutionBaselinePanel.tsx`, so counts for those two files may differ from `origin/main`).
- Disclaimer: AI output is decision support. Gate approval, ADR acceptance and investment decisions belong to a human.

## 0. Merged state on origin/main (last 15 commits, summarised)

| PR | Merge | Content | CI |
|---|---|---|---|
| #511 | `3c99ae5b` (feature `f7c4c4d8`) | ADR-0159, ADR-0160 (addenda b, c, d), ADR-0162 draft, ADR-0161 draft; migrations 0135-0138; S8 goals; greenfield S9/S10; DD scoping overlays | PR body says CI skipped (billing), verified locally |
| #512 | `67d39049` (feature `efa0e682`) | ADR-0161 procedures, flow.spec v2.8.0, execution-baseline / policy-migration / post-management routes | same |
| #513 | `136ac00a` (feature `6f25ab0b`) | ADR-0159..0162 flipped to Accepted; ADR-0163 runner fix; migration 0139 + ADR-0164 (Proposed); table sizing batch 2 | same; scenarios, build and a production migration dry-run were stated as not run |
| #514 | `f35ab935` (feature `8048bde0`) | table sizing rollout complete, design-lint rule R10 | same; browser scenarios not run |

Earlier merges (#508-#510) are out of scope here. Everything above is already on `main`: code and migrations are live in the repository whatever the ADR status says. Rejecting an ADR therefore means a revert PR, not "not merging".

## 1. ADR acceptance table

Status as recorded in each file, checked at the line given. Tick one box per row. "Accept" here means: you confirm the ADR header status and, where a header and an addendum disagree, you choose which one is true.

| ADR | Title | Header status (file:line) | Status words elsewhere in the same file | Inconsistency |
|---|---|---|---|---|
| 0159 | Project-level business goals above group/affiliate standards (S8) | Accepted (`0159...md:3`) | none | none found. Also Accepted in `docs/adr/README.md:159` |
| 0160 | Greenfield S9 plan verification and S10 establishment structure by sub-track | Accepted (`0160...md:3`); line 5 says addenda accepted with it | "Status stays Proposed" at lines 51, 68, 83, 90 (addenda a-d) | YES: header Accepted vs four addenda saying Proposed. Line 90 also says "the ADR as a whole still needs the human final approval above", which conflicts with line 3. Overlay `checklists/_overlays/greenfield-workspace-scope.yaml:15` still says `status: proposed` |
| 0161 | Greenfield execution (S11) and post-management (S12) by track | Accepted (`0161...md:3`); line 6 says addenda accepted with it | "Status stays Proposed" at lines 56, 68, 80 (Row 1, Row 2, Row 2 review fixes). `DEC-20261012-02.md:26`: "ADR-0161 remains Proposed" | YES: header Accepted vs three addenda and the decision record saying Proposed. PR #512 body also says Proposed. The Row 2 addendum (about line 68-76) still states "no migration was added" and `run_required`, which ADR-0164 / migration 0139 later changed |
| 0162 | Brownfield S9 workspace items scoped per sub-track | Accepted (`0162...md:3`); line 5 says addenda accepted with it | Section title "Decision (proposed)" at line 14; implementation addendum "status stays Proposed" at line 39; `DEC-20261012-01.md:24`: "ADR-0162 remain Proposed"; overlay `brownfield-workspace-scope.yaml:17` `status: proposed` | YES: same pattern |
| 0163 | Migration runner executes statements one by one, stop-on-error | Accepted (`0163...md:3`), no Deciders line | none | The acceptance was written by the implementing agent, not by you (PR #513 body: "marked Accepted by the implementing agent - confirm or revert"). `docs/adr/README.md:163` says Accepted without a date |
| 0164 | venture_scorecard unique key gains review_cycle | Proposed (`0164...md:3`), "Decider: Human reviewer (pending)" | none | Migration 0139 is already on `main` (commit `6f25ab0b`) while the ADR is Proposed. ADR-0161 text and DEC-02 still describe the old `run_required` behaviour |

Other consistency notes:

- `docs/designs/2026-10-11-greenfield-investment-execution-and-post-management-design.md` frontmatter says `status: draft` and section 15 title says O1-O4 are "still open", while ADR-0161 is Accepted and encodes answers (see section 5). The two 2026-10-12 designs say `Status: Draft (Row 0 Design Gate)`.
- The ADR-0161 design (section 4 / impact table, about line 302) calls PRJ-DSE4PW "S9"; ADR-0160 "Policy impact" says "currently at S8". Actual current stage: unverified (I did not query the database).
- PR #511 body asks you to accept "ADR-0161 (draft)" and migrations 0135-0138; PR #513 later recorded the acceptances from chat. I found no repository record of acceptance of migration 0139, ADR-0163 or ADR-0164 by a human.

### 1.1 Per-ADR decision sheet

#### ADR-0159 - project business goals (migration 0135)
- Governs: analyst-set deal goals in S8; resolution project > affiliate > group; goals are reference evidence only, never gate-blocking.
- On main: migration 0135 (`project_business_goal`), route `POST /api/projects/{id}/business-goals`, goals panel, adopt-without-goals acknowledgement stored in `process_run.meta_json`.
- Accept means: goals feature stays; reject means: revert code, then `DROP TABLE project_business_goal` and two indexes (header of 0135); no backfill either way.
- Confirm:
  - [ ] Analyst+ (not lead-only) may write goals (open question in the ADR; design doc lists it).
  - [ ] Adoption without goals is a confirmation, not a block.
  - [ ] Goals never change RAG or ranking automatically.
- Decision: [ ] Keep Accepted  [ ] Revert to Proposed  [ ] Reject

#### ADR-0160 - greenfield S9/S10 by sub-track (migrations 0136, 0137, 0138)
- Governs: sub-track conditional steps in `greenfield-dd` 1.1.0 and `deal-structuring` 1.1.0; `site_required`; `capex_tranche`; per-sub-track S9 workspace overlay (addendum b); custom DD items on seven domains (addendum c); single-person site confirmation (addendum d); flow.spec v2.7.0.
- On main: migrations 0136, 0137, 0138; routes `greenfield-scope`, `greenfield-scope/workspace-opt-in`, `capex-tranches`, `dd-checklist/custom`; overlay `checklists/_overlays/greenfield-workspace-scope.yaml`; cut-off constants (section 7).
- Accept means: the above stays live; reject means: revert the PR, run the manual rollback SQL in the migration headers (0136 only legal while no `dimension_input` references the two var_keys; 0137 only while no row uses the four new domains), or restore the pre-migration backup (ADR-0014).
- Confirm:
  - [ ] Header Accepted is intended to cover addenda a-d, including the weakened two-person review (section 3).
  - [ ] The overlay files stay `status: proposed` or are set to approved (the loader fails closed per row, so the file-level status may not matter at runtime: unverified).
  - [ ] Item-level counts: judgeable null 56, `existing_business_rbd` 60 (+3 conditional), `intra_venture` 55 (+3 conditional) after the risk-officer changes (section 4).
  - [ ] Grandfathering: projects older than the cut-off keep the old view until a human opt-in.
- Decision: [ ] Keep Accepted  [ ] Revert to Proposed  [ ] Reject

#### ADR-0161 - greenfield S11/S12 by track (no migration)
- Governs: new procedure `greenfield-execution-baseline` v1.0.0; `portfolio-venture-monitoring` 1.2.0; `pmi-integration-execution` 1.1.0 (step 6); `jv-lifecycle-governance` 1.1.0; `entity-ic-review` 1.3.0; `entity-formation-checklist` 1.1.0 (gx-01..gx-03); flow.spec v2.8.0; retroactive application to in-flight projects.
- On main: routes `execution-baseline`, `policy-migration`, `post-management`, `post-management/scorecard`; PMI write guards (403 `not_applicable_track`); `lib/project-track.ts`; `lib/greenfield-execution.ts`.
- Accept means: S11 for greenfield becomes blocking on a confirmed baseline unless the project's policy-migration snapshot lists S11 as already completed; reject means: revert spec to v2.7.0 and procedure versions (ADR text); policy-migration audit entries stay (append-only) with a reversal entry.
- Confirm:
  - [ ] Retroactive application and its cut-off date (section 5).
  - [ ] Only the project lead may confirm the baseline and record the policy migration (section 3).
  - [ ] The Row 4 cross review (risk-officer, legal-counsel, security-engineer, auditor) is complete: unverified; the addenda say "still pending" and I found no record of completion apart from the Row 2 review fixes.
  - [ ] gx-03 is binding and not waivable.
- Decision: [ ] Keep Accepted  [ ] Revert to Proposed  [ ] Reject

#### ADR-0162 - brownfield S9 workspace scope (no migration)
- Governs: overlay `checklists/_overlays/brownfield-workspace-scope.yaml` 1.1.0; m_and_a is the byte-identical baseline; opt-in attaches sub-track extra checklists; cut-off `BF_WORKSPACE_SCOPE_DATE`.
- On main: `lib/brownfield-subtrack.ts`, route `brownfield-scope/workspace-opt-in`, scoped `ddCompletionSummary`.
- Accept means: non-m_and_a brownfield sub-tracks judge fewer items after opt-in; reject means: revert code and overlay; nothing is deleted from item state.
- Confirm:
  - [ ] Judgeable counts with extras: m_and_a 102, jv 93, strategic_investment 71, minority_investment 87, partnership 78, rbd 92, corporate_venture 71.
  - [ ] The recorded-not-decided point: the ADR-0048 registry declares six M&A validators for every brownfield sub-track while their checklists attach only for m_and_a (design F7, Q5).
  - [ ] The 14 changed cells (section 4).
- Decision: [ ] Keep Accepted  [ ] Revert to Proposed  [ ] Reject

#### ADR-0163 - migration runner stop-on-error (no schema change)
- Governs: `db/migrate.ts` now splits each migration into statements and stops on the first error; previously a failure in a non-final statement was silently ignored, so the CHECK-guarded assertions in 0132 and 0137 never aborted.
- On main: `splitSqlStatements`, `tests/unit/migration-runner.test.ts` (11 tests per ADR).
- Accept means: guard assertions in migration headers are load-bearing from now on; reject means: revert `db/migrate.ts` (and the guards in 0132/0137 become vacuous again).
- Confirm:
  - [ ] The agent-written Accepted status is yours to keep.
  - [ ] A production-database migration dry-run is still outstanding (PR #513 says none was run): unverified whether it has been run since.
  - [ ] The tokenizer is SQLite-dialect only (ADR text) and an unmodelled syntax would fail at migration time.
- Decision: [ ] Keep Accepted  [ ] Revert to Proposed  [ ] Reject

#### ADR-0164 - scorecard cycle in the unique key (migration 0139)
- Governs: `venture_scorecard` key becomes `(run_id, source_procedure, review_cycle, section, measure_key)`; later quarters land on the same run; `run_required` remains only when the project has no run.
- On main: migration 0139 already applied by the merge; route behaviour changed accordingly.
- Accept means: keep. Reject means: the manual rollback in the 0139 header, which refuses to run once any measure has more than one cycle on the same run (history is never deleted), so rollback becomes impractical after the first repeated quarter is recorded.
- Confirm:
  - [ ] You want repeat quarters to share one run (alternative: keep requiring a new analysis run per quarter).
  - [ ] Row count growth of about 4x per year of quarterly cycles is acceptable.
  - [ ] ADR-0161 / DEC-02 wording about `run_required` should be updated.
- Decision: [ ] Accept  [ ] Keep Proposed (decide before more cycles are recorded)  [ ] Reject (revert before any repeat quarter exists)

## 2. Migrations 0135-0139

| No | File | What | Reversible | Risk | Data touched |
|---|---|---|---|---|---|
| 0135 | `0135_project_business_goal.sql` | New table `project_business_goal` + 2 indexes | Yes (`@reversible: true`, DROP in header) | Low: additive | None existing; new table empty |
| 0136 | `0136_greenfield_subtrack_vars.sql` | Seeds routing vars `project.sub_track`, `project.site_required` in `evidence_var`; new table `capex_tranche` + 2 indexes | Yes, manual; DELETE of seeds legal only while no `dimension_input` / `rag_rule_variable` row references them | Low-medium: new routing vars drive `greenfield-dd` step predicates (fail-closed: unassessed means every step applies) | Two seed rows; new table empty |
| 0137 | `0137_dd_custom_item_domains.sql` | Rebuild of `project_checklist_item_custom` to widen the `domain` CHECK to seven domains | Yes, reverse rebuild SQL in header, guard aborts if new-domain rows exist | Medium: table rebuild; before ADR-0163 its row-count guard could not abort (now it can) | All rows of `project_checklist_item_custom` copied verbatim |
| 0138 | `0138_site_required_no_evidence_ref.sql` | `UPDATE evidence_var SET requires_evidence_ref = 0` for `project.site_required` | Yes (one-line UPDATE back); rows written meanwhile keep `evidence_ref = ''` | Medium (governance, not technical): removes the evidence citation requirement | One seed row |
| 0139 | `0139_scorecard_review_cycle_key.sql` | Rebuild of `venture_scorecard` with a wider UNIQUE key | Yes while no group holds more than one cycle; otherwise only by backup restore | Medium: table rebuild of human-recorded monitoring history; collisions impossible by construction (old key is a subset) | All rows of `venture_scorecard` copied verbatim |

Confirm points:
- [ ] A production-database dry-run or backup (ADR-0014, `scripts/co-newbiz/restore.ts`) exists before the next deploy. Whether this was done: unverified.
- [ ] Migrations 0135-0138 are accepted (PR #511 asked; the acceptance record is the chat only).
- [ ] Migration 0139 acceptance: see ADR-0164.
- [ ] The runner change (ADR-0163) was verified against all 139 migrations by a byte-identical `sqlite_master` dump (per PR #513 and ADR text); I did not re-run it: unverified.

## 3. Human-only routes and who may call them

All routes below are POST, cookie session plus CSRF, no bearer / OAuth / agent callers, project visibility, and are listed in `scripts/co-newbiz/mcp-coverage.exclusions.yaml`. The role floor read from each route file is "viewer is refused, so analyst or above". Admin has no deal-content access (ADR-0146).

| Route | Added by | Role floor | Extra restriction |
|---|---|---|---|
| `POST /api/projects/{id}/business-goals` | ADR-0159 | analyst+ | actions create / supersede / retire; audit entry on every write |
| `POST .../greenfield-scope` | ADR-0160 | analyst+ | `site_required` + mandatory rationale; single-person confirmation |
| `POST .../greenfield-scope/workspace-opt-in` | ADR-0160 b | analyst+ | `migration_note` required; GET preview |
| `POST .../brownfield-scope/workspace-opt-in` | ADR-0162 | analyst+ | `migration_note` required; GET preview; attaches extra checklists |
| `POST .../capex-tranches` | ADR-0160 | analyst+ | release is two-person: approver must differ from creator, requester and any editor since the request; pending release locks edits |
| `POST .../dd-checklist/custom` | ADR-0160 c | analyst+ | custom item needs a separate human review (self-review blocked) |
| `POST .../execution-baseline` | ADR-0161 | analyst+ for `record_entries`; **project lead only for `confirm`** (403 `lead_required`) | confirm needs rationale, required sections, every open finding acknowledged |
| `POST .../policy-migration` | ADR-0161 | **project lead only** (403 `lead_required`) | one entry per project; no re-pin |
| `POST .../post-management/scorecard` | ADR-0161 | analyst+ | greenfield only (brownfield 409); `venture_class` override needs a note |

Confirm points:
- [ ] Single-person `site_required` confirmation (ADR-0160 addendum d, migration 0138): one analyst can now remove the site steps (1, 3) and site checklist items from S9 scope, with no second reviewer and no evidence citation. Mitigations in the ADR: human-only route, mandatory rationale, audit entry `dimension_input_single_person_confirmation`, supersede history, wastewater kill criterion still tied to `site_required == true`. Decision: [ ] keep as is  [ ] restore two-person review (revert 0138 and the code path `assertWithSinglePersonConfirmation`)  [ ] restore evidence reference only.
- [ ] Lead-only confirmation: no "process owner" role exists in `procedures/_human-roles.yaml` or the auth roles, so the project lead was used as the nearest role (PR #512). The design recommended "process owner (compliance-officer operated)". Decide whether to keep the lead or create a role.
- [ ] Is "analyst+" acceptable for goals, tranche creation, scorecard cycles and opt-ins, or should any be lead-only?
- [ ] The custom DD item review route's exact role floor: unverified (not read).
- [ ] The MCP read tool `get_execution_baseline` from the design was not added (ADR-0161 Row 2 addendum). Agents cannot read the execution baseline through MCP. Needed? [ ] yes  [ ] no

## 4. Governance rows pending your decision

Source: `DEC-20261012-01.md` ("user decision pending" sections) and the overlay files. Each row carries an old approval record dated before the change, so the validator and loader treat it as approved (fail closed otherwise). Your decision is to confirm or reverse each.

### 4.1 Greenfield and binding-item rows (risk-officer review)

| Row | Sub-track(s) | Before | Current | Reason | Decision |
|---|---|---|---|---|---|
| fin-09 Certainty of funds before IC (binding: mandatory, not waivable) | all three greenfield; brownfield jv, strategic_investment, minority_investment, partnership, corporate_venture | R | A | Binding items must be A in every column; the validator now rejects any other code on a binding item | [ ] confirm A  [ ] reverse |
| ldd-06 Top-20 contract change-of-control scan | existing_business_rbd, intra_venture | N | R | Own exclusivity / non-compete / MFN commitments may block the new business; moving contracts or IP into a new entity may need consent | [ ] confirm  [ ] reverse |
| ldd-07 Asset vs share transfer | intra_venture | N | R | The earlier reason "no transfer transaction" was wrong for this sub-track | [ ] confirm  [ ] reverse |
| tdd-05 Remaining useful life of equipment | intra_venture | N | R | Applies to equipment the parent contributes | [ ] confirm  [ ] reverse |
| mdd-09 Expansion revenue breadth | none, intra_venture | N | R | Concentration on anchor customers; judged with cdd-01 | [ ] confirm  [ ] reverse |

Resulting greenfield counts (A/R/X/N/C, judgeable): none 14/42/2/19/0 (56); existing_business_rbd 13/47/1/13/3 (60 +3); intra_venture 11/44/4/15/3 (55 +3). Brownfield A/R: jv 57/18; strategic_investment, minority_investment, corporate_venture 56/15; partnership 22/30. Note: `0160...md:70` and `0162...md:` item 4 both carry these figures; the overlay `expected_counts` are recomputed by the validator (not re-run by me: unverified).

### 4.2 The 14 brownfield cells changed after the legal-counsel review

| Item | Sub-tracks | Old | Now | Reading |
|---|---|---|---|---|
| fin-06 Certain-funds structure | strategic_investment, minority_investment, corporate_venture (3 cells) | N | R | applies when a secondary (existing-share) purchase is included |
| fin-08 Reverse termination fee | same 3 cells | N | R | same |
| hdd-09 Employment succession regime | same 3 cells | N | R | applies when a business unit or staff transfers (including contribution in kind) |
| ldd-22 Business-transfer employee succession | same 3 cells | N | R | same |
| hdd-08 EU works council | partnership (1 cell) | N | R | European counterparty or reorganisation of own-site staff |
| hdd-10 Culture gap | minority_investment (1 cell) | N | R | board nomination or veto right |

Total 3+3+3+3+1+1 = 14 cells. Count deltas (judgeable with extras): strategic_investment 67 -> 71; minority_investment 82 -> 87 (workspace 66 -> 71); partnership 77 -> 78; corporate_venture 67 -> 71.

- [ ] Confirm all 14 cells  [ ] Reverse the following: ____________
- Left for you by the record: jv hdd-09 and ldd-22 are R (staff transferred into the JV) while the review asked for A. [ ] keep R  [ ] set A
- Left for you: partnership ldd-18 (personal data) is R, review asked A. [ ] keep R  [ ] set A
- Reason/reading changes without code change (brownfield ldd-06 partnership competitor information exchange; greenfield ldd-22 pointer to ef-08; Korean term fixes in six checklists): [ ] acknowledged.
- Greenfield ldd-15 (none) is replaced by gf-04; whether lr-01 should be a second pointer is open: [ ] add  [ ] leave.
- Supreme Court case number cited in `checklists/legal-dd-checklist.yaml` (ldd-22): could not be verified, kept with a "citation to be verified by counsel" mark. [ ] counsel to verify before the citation stays  [ ] remove the citation. Verification status: unverified.

### 4.3 Items the DEC record lists as pending (cross-check)

- [ ] DEC-20261012-01 pending list = fin-09, ldd-06, ldd-07, tdd-05, mdd-09, the six legal-review changes (14 cells), merger-control/FDI finding. All appear in 4.1, 4.2 and section 5. No other pending item is listed in DEC-20261012-02 (its four open items are all marked resolved there).
- Overlay files carry `status: proposed` (greenfield `:15`, brownfield `:17`). [ ] set to approved/accepted after your decision  [ ] leave.

## 5. Open decisions

### 5.1 Merger-control / FDI items for minority-type brownfield sub-tracks (risk-officer finding 1, HIGH)
- State: ma-01..03 (antitrust) and min-05 are not attached for strategic_investment, corporate_venture, minority_investment, so merger-control and foreign-investment screening are silently dropped for those sub-tracks. Not implemented (PR #511 notes, DEC-01 last paragraph before "Not yet reviewed").
- Recommendation in the record (not an approval): attach ma-01..03 and min-05 for opt-in projects of these sub-tracks, with "not applicable by threshold" allowed.
- [ ] Attach ma-01..03 and min-05 as recommended  [ ] Attach a subset: ______  [ ] Do not attach (accept the gap, record why)  [ ] Defer

### 5.2 policy_migration full-note retention
- State: the audit entry stores only a summary of at most 120 characters and a hash; the full migration note is not kept (ADR-0161 R10; PR #512 note flags it as a limitation). The policy migration has no ledger row.
- Recommendation in the record: none explicit; the task brief suggests an append-only `process_run` row. 
- [ ] Add an append-only `process_run` row (needs code, possibly an ADR addendum)  [ ] Keep summary + hash only  [ ] Other: ______

### 5.3 venture_class override
- State: default `venture_class` is driving (new site), enabling (`existing_business_rbd`), emergent (`intra_venture`) (Q7). A person may override with a note up to 2000 characters; audit `venture_scorecard.venture_class_override` carries before/after/note.
- [ ] Keep the free override with a note  [ ] Restrict to lead  [ ] Require a second person  [ ] Remove the override

### 5.4 ADR-0161 questions O1..O4 and where they stand
The design (section 15) still labels them open; ADR-0161 and PR #512 encode the following. Decide whether each encoding is your answer.

| # | Question | Design recommendation | What the code/ADR does | Your answer |
|---|---|---|---|---|
| O1 | Who may record the per-project policy migration entry | Process owner (compliance-officer operated) | Project lead only (`project_member.project_role = 'lead'`), because no process-owner role exists | [ ] lead  [ ] process owner (new role)  [ ] other |
| O2 | Tolerance for reconciling `capex_tranche` sum vs S8 capex | Exact match, any difference is a finding | Exact match; planned and released tranches only, withheld excluded; non-KRW tranche or null unit is a finding | [ ] exact  [ ] tolerance: ____ |
| O3 | Track-scoped co-owner via procedure layer vs two activity ids for `investment-structuring` | Keep one id | One id; greenfield-agent owner with financing-agent co-review via `entity-ic-review` 1.3.0 step 3.1 (Q6) | [ ] keep  [ ] split |
| O4 | Populate the S12 post-close step for DEMO-S1-S12 with demo data | No; leave recommended and empty | Not populated as far as the ADR states; the demo database content itself: unverified | [ ] leave empty  [ ] populate |

### 5.5 PMI kickoff 400 to 403 change
- State: for a non-applicable track, writes to `pmi/kickoff`, `pmi/synergy-certifications[/:id]` and `pmi/key-talent[/:id]` return 403 `not_applicable_track`; the kickoff error was 400 `not_applicable` before (review fix R2). Reads unchanged. m_and_a unaffected.
- [ ] Accept as a deliberate API change  [ ] Restore 400 for the kickoff route. Any external client depending on 400: unverified.

### 5.6 Retroactive application and its cut-off (greenfield S11)
- State: ADR-0161 decision 8: predicates apply to in-flight projects without re-pinning; one lead-recorded `policy_migration` entry per project; new steps are recommended (not blocking) for stages already completed, blocking for stages not yet reached; S12 never blocking; nothing reopened. Cut-off `GX_EXECUTION_BASELINE_DATE = "2026-10-12"` (`app/web-next/lib/greenfield-execution.ts:40`).
- "Already completed" now means: every other S11 criterion holds and the project's `policy_migration` snapshot lists S11. IC GO dates before 2026-10-12 no longer count as evidence (review fix R1). A project that completes S11 after the rule needs a confirmed baseline.
- Whether the constant `GX_EXECUTION_BASELINE_DATE` is still consulted after review fix R1 (versus only the migration snapshot): unverified; check before relying on it.
- [ ] Keep retroactive application (your Q2 choice)  [ ] Change to "from next policy pin"  [ ] Keep, but cut-off date other than 2026-10-12: ______
- [ ] Run the read-only impact query `inFlightAdr0161Counts()` against the live copy before accepting: unverified whether it has been run on live data.

## 6. INTERIM-WORDING inventory (`app/web-next`)

Grep of the string `INTERIM-WORDING` in `app/web-next` (excluding `node_modules` and `.next`): **248 marker lines in 27 files** (working tree; two files have uncommitted edits). The glossary review is pending (PR #511 notes).

| Area | Files (count of markers) | Subtotal |
|---|---|---|
| Labels and shared copy | `lib/labels.ts` (45) | 45 |
| Greenfield S9/S10 views | `lib/greenfield-dd-view.ts` (38), `lib/greenfield-structure-view.ts` (5), `components/stages/GreenfieldScopePanel.tsx` (12), `components/stages/CapexTrancheTable.tsx` (5) | 60 |
| Brownfield S9 views | `lib/brownfield-dd-view.ts` (25), `components/stages/BrownfieldScopePanel.tsx` (6) | 31 |
| S11/S12 execution and post-management | `lib/execution-baseline-view.ts` (23), `components/stages/ExecutionBaselinePanel.tsx` (5), `components/stages/PolicyMigrationPanel.tsx` (3), `lib/post-management-view.ts` (7), `components/stages/PostManagementPanel.tsx` (1), `components/stages/BaselineConfirmDialog.tsx` (1) | 40 |
| S8 goals and business case | `lib/business-goals-view.ts` (18), `components/business-case/GoalsPanel.tsx` (13), `components/business-case/GoalAttainment.tsx` (1), `components/stages/BusinessCaseStage.tsx` (4), `components/TargetCheckPanel.tsx` (2) | 38 |
| DD stage and our-company | `components/stages/DdStage.tsx` (8), `components/stages/our-company/constants.ts` (9) | 17 |
| Deal overview and navigation | `lib/deal-overview.ts` (5), `lib/deal-overview-view.ts` (5), `app/deals/[id]/page.tsx` (3), `app/companies/page.tsx` (1), `components/StageFrame.tsx` (2), `lib/stage-tabs.ts` (1) | 17 |

Subtotals add to 248.

Wording facts from the brief that I could not confirm from the repository (the Korean wording is not reproduced here):
- Only the greenfield HR tab label "people/organization plan" (written with a slash in Korean) is user-defined final: unverified in code (I did not locate a marker-free label); the PR #511 text mentions "S9 panel priority on people/organization plan".
- "New business" replaced an earlier phrase: unverified; I did not find which earlier phrase.

Decisions:
- [ ] Run a glossary review (glossary-curator + you) and remove the markers file by file
- [ ] Accept the interim wording for now and set a review date: ______
- [ ] Confirm the final label "people/organization plan" is excluded from the review.

## 7. Constants to set at merge or confirm

| Constant | Value on main | Location | Governs | Decision |
|---|---|---|---|---|
| `GF_SUBTRACK_PREDICATE_DATE` | `"2026-10-12"` | `app/web-next/lib/wave-f-date.ts:8` | Greenfield `greenfield-dd` 1.1.0 selection for projects whose earliest policy pin is on/after it (ADR-0160 decision 9) | [ ] confirm  [ ] set ______ |
| `GF_WORKSPACE_SCOPE_DATE` | `"2026-10-12"` (placeholder) | `wave-f-date.ts:14` | Greenfield S9 workspace overlay scope cut-off (ADR-0160 b) | [ ] set to the real merge date  [ ] keep 2026-10-12 |
| `BF_WORKSPACE_SCOPE_DATE` | `"2026-10-12"` (placeholder) | `wave-f-date.ts:21` | Brownfield S9 workspace overlay cut-off (ADR-0162) | [ ] set to the real merge date  [ ] keep 2026-10-12 |
| `GX_EXECUTION_BASELINE_DATE` | `"2026-10-12"` | `app/web-next/lib/greenfield-execution.ts:40` | Greenfield S11 execution-baseline retroactive rule (ADR-0161) | [ ] confirm  [ ] set ______ |
| `WAVE_F_PREDICATE_DATE` (existing, for reference) | `"2026-10-08"` | `wave-f-date.ts:3` | earlier wave, unchanged | none |

Note: the PR #511 notes asked to set the two workspace dates "to the merge date". The merge happened on 2026-10-12 (PRs merged that day per `git log`), so the placeholder already equals the date of the PR #513/#514 merges, but PR #511 merged earlier the same day (time of day: unverified). Because the check compares dates, a project created on 2026-10-12 is "on or after" the cut-off in every case.

## 8. In-flight project impact

Source: ADR-0160 / ADR-0162 policy-impact sections, the ADR-0161 design impact table (about line 302-305), ADR-0162 live-copy figures. None of this was re-queried (no server or database access in this task): treat all figures as unverified for the live database.

| Project | Track / sub-track / stage as documented | Changes | Needs your action |
|---|---|---|---|
| PRJ-DSE4PW (`01M1MXQN21DP8KYHNW3GDSE4PW`) | greenfield, `existing_business_rbd`; ADR-0160 says S8, the ADR-0161 design says S9 (conflict; actual: unverified) | S9: sub-track steps and workspace scope apply only after opt-in (grandfathered: 37 recorded judgements keep the old view); `site_required` has no default for this sub-track, so a person must confirm it before S9 opens; S11 `greenfield-execution-baseline` will be blocking when S11 is reached; S12 `portfolio-venture-monitoring` applies via `case_type`; PMI tab hidden; fin-04..fin-08 out of S11 scope; default venture_class `enabling`; S8 goals can now be set; adopting a case without goals needs an acknowledgement | [ ] opt in to greenfield-dd 1.1.0 (ADR-0160 recommends it)  [ ] opt in to workspace scope after the count preview  [ ] confirm `site_required`  [ ] record the policy migration (lead) |
| PRJ-T7T81A | brownfield, partnership, S8; already opted in to the brownfield workspace scope | S12 `partnership-monitoring` applies; PMI tab hidden; fin-04..fin-08 remain; judgeable 38 -> 55 (29 workspace + 26 extras) per ADR-0162 live-copy figure; no S9 rows yet | none required; [ ] review the 55 figure on live data |
| PRJ-QGB2W5 | brownfield, strategic_investment, S9, 37 S9 judgements | Grandfathered until opt-in; after opt-in 29/38 judged/judgeable -> 27/36 per ADR-0162; S12 `integration-monitoring` applies (post-close, recommended); PMI tab stays; merger-control/FDI items stay absent for this sub-track (section 5.1) | [ ] opt in or leave grandfathered  [ ] decide 5.1 first, since it changes the count |
| DEMO-S1-S12 | brownfield m_and_a, S12, with data | Byte-identical m_and_a baseline; `integration-monitoring` shows as recommended, not blocking; no PMI or scorecard data changed | none; [ ] O4 (populate demo data) |

## 9. Known limitations and follow-ups

- `scripts/upgrade-project.ts` has four TS2307 errors (missing helper modules), pre-existing at HEAD. PR #513/#514 mention upstream request U-20261012-001 as pending; whether it was actually filed through the upstream tool: unverified. [ ] confirm the request exists
- Custom DD items have no proposer column; the two-person review relies on existing columns. A future migration is needed (PR #511 notes). [ ] schedule  [ ] accept as is
- design:lint baseline: four pre-existing violations at HEAD (R5 `window.confirm` x2 in `app/settings/connected-apps/page.tsx:234,424`; R4 stage header in `app/route-decision/page.tsx:174` and `app/our-company/page.tsx:15`), out of scope of PR #514. New rule R10 (`table-sizing`) reports 0 violations; the `KNOWN_OFFENDERS` ratchet is empty.
- Test coverage notes: PR #511 states the full unit suite at 2447+ tests; #512 2541; #513 2558; #514 2559 pass. The PR #511 test-plan boxes are all unchecked in the merged body, and scenario suites were run only for #512 (greenfield 6/6, brownfield-ma 13/13). Scenario / browser / `bun run build` checks are stated as not run for #513 and #514. I did not run any test.
- CI is skipped on all four PRs because of billing; verification was local (memory note: admin-merge on local verification).
- No MCP write tool exists for greenfield S12 cycles; the scorecard POST is the only write path.
- The MCP read tool `get_execution_baseline` is not implemented.
- Request-body size caps are a platform-level item, not addressed.
- `flow.spec` activity-level `applicableTracks` is not supported (ADR-0160 follow-up); S10 `deal-structure-hypothesis` still lists the brownfield wording for greenfield. The S11 `investment-structuring` activity agent is `brownfield-agent` for every track at the activity level (ADR-0161 Q6 handles greenfield through the procedure layer).
- Optional seeding of `project.sub_track` / `site_required` as routing vars was done by migration 0136; the earlier follow-up in ADR-0160 decision 6/8 ("no migration") is superseded by addendum a.
- Documentation state: ADR headers vs addenda inconsistencies in section 1 remain until you decide; a docs fix (mark addenda as "accepted together with the header", or revert headers) is a separate task.

## 10. Summary of inconsistencies found

1. ADR-0160 (`:3` Accepted vs `:51,68,83,90` "Status stays Proposed"), ADR-0161 (`:3` vs `:56,68,80`), ADR-0162 (`:3` vs `:14`, `:39`), plus DEC-01 `:24`, DEC-02 `:26`, overlay files `:15`/`:17`.
2. ADR-0163 Accepted by the implementing agent, not by a human; README row has no date.
3. Migration 0139 live on `main` while ADR-0164 is Proposed; ADR-0161 Row 2 addendum and DEC-02 still describe `run_required`/"no migration".
4. Design for ADR-0161 `status: draft` and section 15 "still open" for O1..O4 although ADR-0161 is Accepted and the code encodes answers (O1 differs from the design recommendation).
5. PRJ-DSE4PW stage: S8 (ADR-0160) vs S9 (ADR-0161 design).
6. PR #511 test-plan boxes unchecked in the merged body; PR #513 reports "139 migrations" while ADR-0163 says "138 migrations".
7. Workspace scope dates are placeholders equal to the merge date; whether `GX_EXECUTION_BASELINE_DATE` is still used after review fix R1 is unclear.
8. ADR-0160 line 90 says the ADR still needs final approval while the header says Accepted.
