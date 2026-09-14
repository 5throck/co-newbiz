# Design: S1 industry deletion cascades all referencing rows

- Date: 2026-09-14
- Status: implemented
- Related: ADR-0129 (link soft-retire), `2026-09-14-s1-industry-list-relation-grouping-design.md`

## Problem

User report: after removing every visible value-chain relation of an industry (`유압식 브레이커`), industry deletion still failed with the generic 409 "referenced by other data" error. Diagnosis on the live DB found three distinct blockers the UI gives no way to clear:

1. **Retired `proxy_link` rows (9)** — the UI's link "removal" is a soft retire per ADR-0129 (`status='retired'`, row kept for audit). Retired rows keep their FK to `md_industry`, so from the user's perspective removed links still block deletion.
2. **One active legacy-untagged `proxy_link` row** — an ADR-0126-era structural row with `relation IS NULL`. It never appears in the removable relation list (only in the `legacyUntagged` review queue), so it is effectively invisible as a blocker.
3. **Project-domain rows with no removal path** — `project_industry` binding (1) and a project `value_chain_link` edge (1) referencing the industry. The API surface has no unbind/delete for either, so blocking on them is a permanent dead end: the industry could never be deleted.

## Approach

`DELETE /api/market-overview/industry/{id}` now cascades every direct `md_industry` reference inside its existing transaction, instead of relying on the FK constraint to refuse:

- existing: `market_sizing_version`, `market_sizing_analysis`, un-promoted `opportunity` cleanup (unchanged)
- new: `project_industry` (after nulling `superseded_by` self-references pointing at deleted bindings), `value_chain_link`, `proxy_link` (retired, active, and legacy-untagged alike), `proxy_chain`, `fact_industry`, `chain_node_sensitivity`, `structure_simulation_result`, `pipeline_run`

Rationale: the industry master row is the FK anchor — no child row is meaningful once it is gone, and several child tables have no individual removal UI, so "block and tell the user to clean up" cannot terminate. Promoted opportunities (investment records) remain protected per the existing rule (market_scope is only nulled). Each cascade step's row count is recorded in an audit log entry (`action=industry_delete`) to preserve the traceability the soft-retire path was protecting.

The UI confirm dialog text was updated to state the actual scope: analyses/versions, value-chain links, project bindings, and analysis artifacts are deleted together; promoted opportunities are preserved.

Verification of the cascade was done on a `.backup` copy of the live DB with `PRAGMA foreign_keys=ON`, deleting the reported industry (`유압식 브레이커`): all statements succeeded, `PRAGMA foreign_key_check` returned no violations, and zero referencing rows remained. The live DB was not touched during verification.

## Verification

- `bunx tsc --noEmit` clean.
- DB-copy cascade test as described above (`delete-ok`, empty `foreign_key_check`) — deleting the reported industry (`유압식 브레이커`).
- Manual check pending on the live app: deleting the industry now returns 200 and the list refreshes without it.
