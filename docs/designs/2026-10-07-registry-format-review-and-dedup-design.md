# Design: script-registry format review + duplicate-row dedup

- **Spec ID**: 2026-10-07-registry-format-review-and-dedup
- **Date**: 2026-10-07
- **Status**: implemented
- **Scope**: `scripts/SCRIPTS.md`

## Problem

The 2026-10-07 fleet provenance inspection (workspace spec `2026-10-07-registry-provenance-normalization-design`) flagged this registry as nonstandard (~57 rows with `source=co-newbiz` instead of a layer value). Review finding:

- **The vocabulary is truthful and stays.** `templates/co-newbiz/scripts/` delivers **zero** scripts — every `co-newbiz/*` script is genuinely project-local. Rows use `source=co-newbiz | layer=L3-only (<prose justification>)`, which is factually correct and richer than the fleet minimum (`L3 | L3`); the prose in the layer cell is valuable contract documentation. The workspace normalizer skips these rows by row shape; it is being hardened upstream (v1.1.0) to skip-and-report them explicitly rather than by regex accident.
- **Six rows were duplicates, now removed**: five exact paste-duplicates (`policy-sync`, `fin-project`, `calibrate`, `convert`, `kosis-units` — identical content rows appearing twice, Wave A3 rows 65-75) and one `verify-scripts --fix` fossil for `job-worker.ts` (`L0 | … | L0` at old line 233) whose file was already rowed correctly in the house convention (line 114). Each script file retains exactly one registry row.

## Decision

Delete only the 6 duplicate rows; keep the `co-newbiz | L3-only (<prose>)` vocabulary as this repo's accepted convention for project-local scripts.

## Verification

- `bun scripts/verify-scripts.ts --verify` — 192 registered scripts, 0 warnings (one row per file).
- A documentation flag-table row accidentally caught by the dedup sweep (`--dry-run` in the resync README section) was restored before commit — net change is exactly the 6 registry rows.
