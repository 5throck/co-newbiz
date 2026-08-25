# Evidence Plane — co-newbiz Overlay Declaration

This variant realizes the workspace `evidence-ledger` base discipline in its
**registry-backed (formal-var) overlay form** — see that skill's
"Registry-backed overlays" section (workspace ADR-0061 overlay contract).

## Where evidence lives here

| Evidence class | Home | Form |
|---|---|---|
| Decision-bearing variables | `evidence_var` registry (migrations 0017–0019+, `db/lib/snapshot-filler.ts`) | row-per-VARIABLE, run-scoped snapshots |
| Gate rules over those variables | `procedures/_kill-criteria/<procedure>__<criterion>.json` | executable predicate + action + governance anchors |
| Analogy corpus for calibration | `docs/decisions/calibration-corpus/` | bounded-analogy cases, membership properties, 5-year retirement |
| Engagement findings | `docs/pilots/`, `docs/audits/` | finding files (F-NNNN), walkthrough records |

## Contract

- A decision record's `evidence_refs[]` resolves INSIDE this plane: a registry
  variable key (`<dimension>.<var>`), a kill-criterion id
  (`<procedure>__<criterion_id>`), an anchor id (`gd-NNNN…`), or a pilot/audit
  file path.
- Supersession/amendment follows the registry's own protocol (premise locks and
  reversal ADRs — never silent edits), mirroring the prose ledger's
  append-vs-supersede rule.
