# Existing-project data alignment, 2026-10-14

Scope: projects that progressed before the 2026-10 model changes (migrations 0135..0142, ADR-0159..0167, DEC-20261008-01 .. DEC-20261014-02). Source: a copy of the dev database taken 2026-10-14 (migrations up to 0141 applied). The live database was not touched; every command below ran against copies in `/tmp`.

Tool: `scripts/co-newbiz/align-existing-projects.ts` v1.0.0. It never decides for a person: `--apply` writes only items classed deterministic.

## 1. Inventory

| # | Change | Source | Effect on an existing project | Class | Handled by |
|---|---|---|---|---|---|
| 1 | Project business goals table | 0135, ADR-0159 | Projects past S8 have no goals; targets fall back to affiliate/group standards | human (analyst sets goals) | reported `business_goals_missing` |
| 2 | Greenfield sub-track vars, `site_required` routing var, `capex_tranche` | 0136, ADR-0160 | `site_required` has no default for R&BD / intra-venture; capex tranches empty for every project (S11 baseline will report gaps) | human (site confirmation); no action (tranches) | reported `site_required_unconfirmed` |
| 3 | `site_required` needs no evidence ref | 0138 | None on existing rows | no action | n/a |
| 4 | DD custom items on four more domains | 0137 | Table widened, no row changed | no action | n/a |
| 5 | Scorecard unique key adds `review_cycle` | 0139, ADR-0164 | Key only widened, no data change | no action | n/a |
| 6 | Establishment step assignee, reopen history | 0140, ADR-0165 | Columns NULL = unassigned; duplicate step rows from the 2026-10-13 assignee bug | human (duplicates) | reported `duplicate_step_rows` |
| 7 | Notification dedupe key, event `via` | 0141 | Existing rows keep `unknown` / NULL | no action | n/a |
| 8 | Establishment mode | 0142, ADR-0167 | Migration backfills origin internal/joint to `new_entity`. Remaining NULL: Green Field without steps (person chooses at S10), external origin, Brown Field | deterministic (steps exist) / human (no steps) | `establishment_mode_new_entity`, `establishment_mode_choice` |
| 9 | Green Field default origin `internal` | ADR-0166 | Existing NULL-origin Green Field projects stay NULL, so they never gain the S11 establishment requirement | deterministic | `origin_greenfield_internal` |
| 10 | Origin outside the allowed set | seed data | `acquisition` matches no predicate | human | reported `origin_nonstandard_value` |
| 11 | Route decision sub-track / no current route | ADR-0160/0162 | Greenfield without a current route has sub-track UNASSESSED (fail-closed) | human | reported `greenfield_no_current_route` |
| 12 | Retroactive S9 scope date 2026-07-01, dd gate pin | ADR-0160(e,f), 0162(b,c) | All dev projects were created after 2026-07-01 so are on the scoped path; a valid dd gate decision pins the pre-scope view | no action | reported `dd_gate_pin` (information) |
| 13 | Policy pins | ADR-0160/0162 opt-in | Opt-in pins refer to overlay versions older than the current ones | human (re-pin is a recorded human act) | reported `policy_pin_stale` |
| 14 | Execution baseline / post-management by track | ADR-0161 | Applied by predicate, retroactive, no re-pin; one human `policy_migration` audit entry per project | no action by this tool | n/a |
| 15 | Opportunity-keyed establishment rows | 0059 history | Rows with NULL `project_id` and one owning project can be linked | deterministic | `step_rows_project_id` (0 found in dev) |
| 16 | Per-target WACC subject | ADR-0132 era | `wacc_subject` NULL after S8 | human | reported `wacc_subject_unset` |
| 17 | Checklist version bumps, glossary term changes | checklists, glossary | `project_checklist_item_state` has no version column; wording changes live in YAML, stored rationales are history | no action | n/a |
| 18 | `deal_structure_hypothesis`, `venture_scorecard` | 0075, 0139 | Existing rows valid under the new schema | no action | n/a |

Route decisions are keyed by opportunity (project_id NULL) by design; the app resolves the current route through `source_opportunity_id`. No action.

## 2. Per-project dry-run (dev copy, as is)

Command: `bun scripts/co-newbiz/align-existing-projects.ts --db /tmp/align-dev.sqlite`. Result: deterministic=0, human=8, none=5. The copy is at migration 0141, so the mode column is absent and migration 0142 will backfill it.

| project_no | track | Current values | Proposed change | Class |
|---|---|---|---|---|
| PRJ-QGB2W5 | brownfield | origin internal, soft-deleted 2026-09-10 | none, excluded | none |
| PRJ-DSE4PW | greenfield | origin internal, mode column absent; step 1 has two rows (done, pending); `wacc_subject` NULL; overlay pin 1.0.0 vs current 1.1.0; valid dd gate (go) | 0142 sets `new_entity`; duplicate row, WACC subject and re-pin need a person | human x3, none x2 |
| PRJ-QG5WDY | greenfield | origin NULL, soft-deleted 2026-09-13 | none, excluded (see scenario below) | none |
| PRJ-T7T81A | brownfield | origin external; `wacc_subject` NULL; overlay pin 1.0.0 vs current 1.2.3 | person decisions only | human x2 |
| DEMO-S1-S12 | brownfield | origin `acquisition`; 0 goals; `wacc_subject` NULL; valid dd gate (go) | person decisions only | human x3, none x1 |

Scenario copy (both soft-deleted projects restored in a throwaway copy, migration 0142 applied by `bun db/migrate.ts --db-path /tmp/align-scn.sqlite`): deterministic=1, human=14, none=3. The one deterministic item is PRJ-QG5WDY origin NULL to `internal`. After 0142, PRJ-QGB2W5 and PRJ-DSE4PW already carry `new_entity`. PRJ-QG5WDY additionally needs: a route decision, the S10 mode choice, and goals.

### Apply results on `/tmp` copies

| Run | applied | backup | row counts before/after | integrity |
|---|---|---|---|---|
| dev copy `--apply` (1st) | 0 | none (nothing to write) | identical | ok |
| dev copy `--apply` (2nd) | 0 | none | identical | ok |
| scenario copy `--apply` (1st) | 1 (origin of PRJ-QG5WDY) | `<db>.align-backup-<ts>.sqlite` via `VACUUM INTO` | all 8 tracked tables identical (md_project 5, entity_establishment_step 11, entity_establishment_step_event 7, project_policy_pin 3, route_decision 11, gate_decision 28, project_business_goal 4, venture_scorecard 9) | ok, FK check clean |
| scenario copy `--apply` (2nd) | 0 | none | identical | ok |

One `audit_log` row was written (actor `system:data-alignment`, action `data_alignment.origin_greenfield_internal`, target `<projectId>#before=origin=NULL;after=origin=internal`). `audit_log` has no before/after columns, so the values ride in `target`.

## 3. Human decisions needed

| # | Question | Options | Recommended answer |
|---|---|---|---|
| H1 | PRJ-DSE4PW establishment step 1 has a done row and a newer pending duplicate (assignee bug). Which survives? | (a) delete the pending row and re-point its two assign events to the done row; (b) keep both; (c) reopen the done row | (a). The pending row has no recorded work, only assignments. Do it as a reviewed one-off SQL on a backup copy first, since deleting is irreversible without the backup |
| H2 | PRJ-DSE4PW overlay pin is 1.0.0, current overlay is 1.1.0; PRJ-T7T81A brownfield overlay pin is 1.0.0, current 1.2.3. Re-pin? | Re-pin through the opt-in API with a `migration_note`; or stay on the old version | Re-pin both after the owner reads the changed item counts, since the pins were opt-ins to the then-current scope. Not auto-applied because it changes which items count toward S9 completion |
| H3 | `wacc_subject` is NULL for PRJ-DSE4PW, PRJ-T7T81A, DEMO-S1-S12 | promoter / target / project_newco, each with a rationale | valuation-agent to confirm. Suggested: PRJ-T7T81A and DEMO target; PRJ-DSE4PW project_newco (its entity mode is `new_entity`) |
| H4 | DEMO-S1-S12 origin is `acquisition`, outside the allowed set | external; hybrid; leave | external (the m_and_a derivation). Also fix the demo seed (`seed-s1-s12-demo.ts` line 241) in a separate change |
| H5 | Active project goals are missing for DEMO-S1-S12 (and for PRJ-QG5WDY / PRJ-QGB2W5 if restored) | analyst sets goals per ADR-0159; accept the group/affiliate fallback | Accept the fallback for the demo and the deleted projects; analyst sets goals for any live deal |
| H6 | PRJ-QG5WDY (only if restored): no current route decision, no mode, no goals | decide route and S10 mode; or keep deleted | Keep deleted. If restored, decide the route first because origin and `site_required` depend on it |
| H7 | Green Field projects with origin internal/joint, no steps, mode NULL (none in live dev data today) | new_entity / business_unit (business_unit only with origin internal) | No default; a person chooses at S10 (ADR-0167 D4) |
| H8 | ADR-0166 section 3 says "no backfill" for NULL-origin Green Field; the lead asked to treat it as deterministic | apply as deterministic (adds the S11 establishment requirement); or reclassify case by case | Operator approval of this report counts as the explicit act. Only PRJ-QG5WDY (soft-deleted) is affected today |

Two model notes for the ADR owner: ADR-0167 D2 says Brown Field mode stays NULL, but the migration 0142 backfill is keyed on origin only, so PRJ-QGB2W5 (Brown Field, internal) became `new_entity`. This is harmless because it has recorded steps. The script follows D2 for new work (Brown Field gets `new_entity` only when steps exist). Capex tranches are empty for every project; DSE4PW passed S10 without tranches, so the S11 baseline reconciliation will report gaps. That is a finding, not a data fix.

## 4. Operator commands

All paths relative to `Projects/co-newbiz`.

1. Dry-run on a copy (safe; read-only connection):
   `cp <live>.sqlite /tmp/align-copy.sqlite && bun scripts/co-newbiz/align-existing-projects.ts --db /tmp/align-copy.sqlite`
2. Apply on a backup copy (rehearsal; apply migration 0142 first if the copy lacks it):
   `bun db/migrate.ts --db-path /tmp/align-copy.sqlite && bun scripts/co-newbiz/align-existing-projects.ts --db /tmp/align-copy.sqlite --apply` then run it a second time and confirm `applied=0`.
3. Apply on the live DB, only after a person approves this report and the migrations are applied through the normal release path (stop the app or accept a short write lock; take the project backup `scripts/co-newbiz/backup.ts` first):
   `bun scripts/co-newbiz/align-existing-projects.ts --db db/data/co-newbiz.sqlite --apply --i-know-this-is-a-live-db`
   The script takes its own `VACUUM INTO` backup beside the DB, verifies row counts and integrity, and exits non-zero on any mismatch. Without both flags it refuses the live path, including for a dry-run; dry-run the live data via a copy (step 1).

Not run: step 3. The live dev DB is unchanged.

## 5. Approved decisions (human decider, chat 2026-10-14)

The recommended answers for H1, H2, H4 were approved. Script v1.1.0 adds a separate mode `--apply-approved-decisions`, which executes only these items, each behind a precondition guard that makes it skip safely when the data differs:

| Item | Action | Guard |
|---|---|---|
| `duplicate_step_cleanup` (H1) | PRJ-DSE4PW: delete the pending duplicate of establishment step 1 and re-point its events to the done row | Exactly two rows for step 1 of that project, one done and one pending; the pending row has no note and no evidence URL |
| `policy_repin` x2 (H2) | PRJ-DSE4PW `ovl-greenfield-workspace-scope` 1.0.0 to the current version (1.1.0); PRJ-T7T81A `ovl-brownfield-workspace-scope` 1.0.0 to current (1.2.3) | The live pin is exactly 1.0.0 and differs from the current overlay version. Same insert/supersede sequence as the opt-in code; a `policy_pin_migrated` audit row carries the note "aligned 2026-10-14 by approved data alignment" |
| `origin_acquisition_external` (H4) | DEMO-S1-S12 origin `acquisition` to `external` | Origin is currently exactly `acquisition`. `seed-s1-s12-demo.ts` 1.8.3 now seeds `external` |

Each applied item writes one `audit_log` row, actor `system:data-alignment`, action `data_alignment.approved.<item>`. One transaction, the same `VACUUM INTO` backup, post-checks, idempotent (a second run reports every item as skipped).

Deliberately NOT applied: `wacc_subject` (H3, the valuation-agent must confirm first), business goals for DEMO (H5, accept the fallback), PRJ-QG5WDY (H6, stays deleted), the S10 mode choice for Green Field without steps (H7, a person chooses). ADR-0167 D2 versus the 0142 backfill discrepancy (Brown Field internal origin becomes `new_entity` by the migration) is unchanged and noted for the ADR owner.

Rehearsed on a `/tmp` copy of the dev DB (migration 0142 applied): dry-run listed four WOULD lines; apply changed step rows 11 to 10, pins 3 to 5 (two superseded), DEMO origin to `external`, integrity ok; the second run skipped all four.

### Operator commands for the live dev DB

Run in your own terminal, from `Projects/co-newbiz`, with the app stopped or idle.

a) Copy and rehearse:
```
cp db/data/co-newbiz.sqlite /tmp/live-rehearsal.sqlite
bun db/migrate.ts --db-path /tmp/live-rehearsal.sqlite
bun scripts/co-newbiz/align-existing-projects.ts --db /tmp/live-rehearsal.sqlite --apply-approved-decisions
bun scripts/co-newbiz/align-existing-projects.ts --db /tmp/live-rehearsal.sqlite --apply-approved-decisions --apply
bun scripts/co-newbiz/align-existing-projects.ts --db /tmp/live-rehearsal.sqlite --apply-approved-decisions --apply   # must report all SKIPPED
```
b) Live apply (migrations 0142 already applied through the normal path; take `bun scripts/co-newbiz/backup.ts` first):
```
bun scripts/co-newbiz/align-existing-projects.ts --db db/data/co-newbiz.sqlite --apply-approved-decisions --apply --i-know-this-is-a-live-db
```
c) Verify afterwards (read-only):
```
sqlite3 -readonly db/data/co-newbiz.sqlite "
select count(*) from entity_establishment_step s join md_project p on p.id=s.project_id where p.project_no='PRJ-DSE4PW' and s.step_no=1;  -- expect 1
select p.project_no, pp.policy_doc_id, pp.pinned_version from project_policy_pin pp join md_project p on p.id=pp.project_id where pp.superseded_by is null and pp.policy_doc_id like 'ovl-%';  -- expect 1.1.0 and 1.2.3
select origin from md_project where project_no='DEMO-S1-S12';  -- expect external
select action, target from audit_log where actor_user_id='system:data-alignment' order by created_at;
pragma integrity_check; pragma foreign_key_check;"
```
Rollback: restore the `*.align-backup-*.sqlite` file written beside the DB.
