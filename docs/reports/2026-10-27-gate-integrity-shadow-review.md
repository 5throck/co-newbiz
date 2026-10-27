# Gate-integrity shadow review (ADR-0186 P5), 2026-10-27

Operator: compliance-officer (dispatched by PM). Mode: read-only. This memo checks completeness and recommends; the flip and shadow-start decisions belong to the owner (ADR-0053). It carries no PASS stamp.

## 1. Data window and environment caveat

- Requested: `bun scripts/co-newbiz/gate-integrity-shadow-report.ts --days 30 --json --db-path db/data/co-newbiz.sqlite` (and the human form).
- Result: **both runs crashed** with `SQLiteError: no such table: app_user_human_role` at `buildShadowReport` (script line ~107). The report produced no output.
- Cause (verified): the dev DB's last applied migration is `0172_dry_run_session.sql` (applied 2026-10-23). Migrations 0173 to 0179 are not applied here; `condition_precedent`, `app_user_human_role` and `gate_decision_snapshot` do not exist. Migration 0179 is still untracked in git.
- Consequence: the report script cannot be evidenced against this DB until migrations are applied. I did not apply them (read-only instruction). Whether the script needs a graceful degrade for an unmigrated DB is a defect to route to `platform-lead`.
- Fallback: direct read-only SQL on tables that exist. Dev runs with `NODE_ENV=development`, so every family defaults to `off` (`db/lib/gate-integrity-flags.ts:37`). Audit rows matching `would_block` or `.refused:` in `audit_log`: **0**. Zero would-blocks here is a property of the `off` default and the missing tables, not evidence of readiness.
- Window of usable shadow evidence: **none**. No family has run in `shadow` anywhere.

## 2. Per-family precondition status (runbook section 1)

| Family | Status | Evidence |
|---|---|---|
| rationale | cannot assess | No would_block data. Denylist review against real rationales was not evidenced. |
| waiver | not met | 26 mandatory `na` rows exist (17 on PRJ-DSE4PW `01M1MXQN21DP8KYHNW3GDSE4PW`, open; 9 on `01M1MPD52T6TAGKWP3P6QGB2W5`, soft-deleted), matching the runbook's count. Column `na_confirmed_by` does not exist in dev (0177 unapplied), so none can be confirmed; no human legacy review is on record. `waiver` table has 0 rows, so the 90-day and `approved_at` checks are vacuous (no active waivers). Approver role grants: cannot assess. |
| ladder | cannot assess | `gate_decision` has 36 rows; the per-project predecessor check was not run. 2 open non-deleted projects sit at `group_ic`, 2 have no gate yet. Grandfathered-gap documentation not evidenced. |
| validators | cannot assess | Validator-completeness needs the script. Open brownfield projects: 2 (1 at `group_ic`, 1 with no gate), so past-fs brownfield count is at most 1; the six-validator records were not checked. bf-03 state not checked. |
| wacc | cannot assess | Needs the script and assumption `kind` logic. S8+ candidates exist (at least the `group_ic` projects); provisional-share G11 not computed. PRJ-DSE4PW is handled by its own runbook (`docs/runbooks/prj-dse4pw-reconfirmation.md`); the reconfirm command has not been run (0179 unapplied). |
| snapshot_ack | not met | `gate_decision_snapshot` table absent. No human end-to-end propose, confirm and stale-retry run is evidenced. G4, G5 not computable. |
| kill_binding | not met | No `group-ic-reviewer` grant holder can exist (`app_user_human_role` absent). No test override evidenced. G5 not computable. Flips together with snapshot_ack. |
| divergence | cannot assess | G3 needs shipped columns plus audit events; none present. Brief persistence across all gate paths including MCP not evidenced. |
| maker_checker | not met (O-1) | Grant holders per IC reviewer role: 0 verifiable (table absent in dev); O-1 needs at least 2 distinct holders for each of `entity-ic-reviewer` and `group-ic-reviewer`. No rehearsal countersign evidenced. Pending countersigns (G7) and open condition precedents (G8): tables absent, not computable. |

## 3. Verified / could not verify / needs judgement

**Verified**
- Both report runs fail on the dev DB for the stated reason; dev migration head is 0172.
- Dev default for every family is `off`; production default is `shadow` only when `NODE_ENV === "production"`.
- 0 gate-integrity audit events in `audit_log`; 36 `gate_decision` rows; 0 `waiver` rows; 26 mandatory `na` rows with the 17/9 split, 9 on a soft-deleted project.
- Open non-deleted projects: 2 brownfield, 2 greenfield (listed in section 2).

**Could not verify**
- Anything the script computes: readiness holders, legacy-unconfirmed by project (beyond raw counts), brownfield validator gaps, S8+ provisional WACC, open condition precedents, pending countersigns, G1 to G12 KPIs.
- Production state: I did not touch prod (7749); its `NODE_ENV`, applied migrations and flag values are unknown.
- Whether the six runtime flag modes are read at request time or only at startup beyond what the runbook states.

**Needs judgement (human)**
- Whether the 26 legacy `na` rows are confirmed, reopened or accepted as legacy.
- Whether the report script should degrade gracefully on an unmigrated DB (route to `platform-lead`).
- Which families to start shadowing first, and the owner's acceptance of the 14-day window.

## 4. Before the first production shadow window can start

1. Apply migrations 0173 to 0179 through the normal release path (owner/`release-engineer`); 0179 is not yet committed. Re-run this report on a migrated DB.
2. Confirm prod is `NODE_ENV=production` so families default to `shadow` (flag changes need a restart; owner-executed per runbook, not by agents). Record the effective mode of each family from the settings or health surface.
3. Grant IC reviewer roles so at least 2 distinct people hold `entity-ic-reviewer` and at least 2 hold `group-ic-reviewer` (O-1); owner briefs the second holder.
4. Run the PRJ-DSE4PW requirement command (`scripts/co-newbiz/reconfirm-requirement.ts`, per `docs/runbooks/prj-dse4pw-reconfirmation.md`) as a human-directed step; this report did not run it.
5. Reseed demo data only on dev (`seed-demo-gate-contract.ts`), never on prod, so shadow evidence is not polluted by fixtures; any fixture-sourced would_block is then attributable.
6. Start the weekly compliance-officer review of `gate_integrity.would_block:<code>` events (G6/G12) with an explained/unexplained flag per event.

## 5. Recommendation

- **Shadow window now:** I cannot recommend any family start a production shadow window today on evidence, because prod state is unverified and the dev DB cannot run the report. Once steps 1 and 2 are done, `rationale`, `divergence`, `ladder` and `validators` carry no precondition that shadow itself would violate (shadow does not block), so they can start a 14-day window together; `waiver`, `wacc`, `snapshot_ack`, `kill_binding` and `maker_checker` can also run in shadow, but their enforce preconditions (items in section 2 marked not met) need the human actions in section 4 in parallel. Shadow is non-blocking; this is a needs-judgement call for the owner.
- **Enforce:** **No family is ready to flip to enforce.** There is zero shadow evidence (no window, no 14 would-block-free days with observed gate writes), and several preconditions are not met. The runbook order and 3-business-day spacing stand.

Files: `/Users/techcross/git/ai_workspace/Projects/co-newbiz/docs/reports/2026-10-27-gate-integrity-shadow-review.md`
