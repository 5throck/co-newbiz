# ADR-0059: Venture/JV Scorecard Storage Schema (design-stage)

**Status**: Accepted (2026-08-23 — design-stage decision answering ADR-0052 open question (e); the migration, monitoring script, and portfolio view are explicitly deferred to the follow-up E.4 implementation round per the user-approved 2026-08-23 scope)
**Date**: 2026-08-23
**Deciders**: process-governance-manager, platform-lead (design owner), pm

## Context

ADR-0052 open question (e): "no table stores JV/venture scorecards today; the monitoring script is blocked until this is decided." Since PR-12c/12e, two procedures produce recurring scorecard outputs — `jv_health_scorecard` (jv-lifecycle-governance#2, seven dimensions) and `portfolio_scorecard_rollup` (portfolio-venture-monitoring#1, bifurcated financial/strategic) — as procedure artifacts only. The E.4 chain (schema ADR → monitoring script → portfolio view) is the longest-lead residual; cells 5/6/9 of the ADR-0047 classification matrix stay thin until it completes (readiness audit R3/R8).

External best practice (readiness-gap research, Area 1): CVC portfolios run dual financial/strategic objectives over a four-type taxonomy (driving / enabling / emergent / passive); balanced-scorecard practice caps the measure set (~20), requires a target per measure, anchors measures to strategy, and treats the scorecard as a recurring trend-and-trigger governance instrument — collection/reporting is automated in mature organizations. Prior committed research (pmi-jv/rbd) fixes the JV dimension content (Ankura/Watermark lineage; seven dimensions).

## Decision

1. **Add one scorecard-row table** (DDL sketch below — the migration lands with the E.4 round, not now):

```sql
CREATE TABLE venture_scorecard (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  source_procedure TEXT NOT NULL CHECK (source_procedure IN ('jv-lifecycle-governance','portfolio-venture-monitoring')),
  review_cycle TEXT NOT NULL,                -- e.g. '2026-Q4'; JV monitor + portfolio cadence share the axis
  venture_class TEXT NOT NULL CHECK (venture_class IN ('driving','enabling','emergent','passive','jv')),
  section TEXT NOT NULL CHECK (section IN ('financial','strategic')),
  measure_key TEXT NOT NULL,
  target_value TEXT,                          -- required unless status = 'insufficient_evidence'
  actual_value TEXT,
  status TEXT NOT NULL CHECK (status IN ('on_target','deviation','insufficient_evidence')),
  evidence_ref TEXT NOT NULL,                 -- ADR-0058 vocabulary (doc:/src:/https:)
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (target_value IS NOT NULL OR status = 'insufficient_evidence')
);
CREATE INDEX idx_venture_scorecard_project ON venture_scorecard(project_id, review_cycle);
CREATE INDEX idx_venture_scorecard_rollup ON venture_scorecard(review_cycle, section);
```

2. **Shape rules and their sources**:
   - **Run-scoped + review-cycle time-series** — every rollup is reproducible per run (ADR-0005 lineage) and the governance use is trend-and-trigger across cycles, never latest-value-only.
   - **`venture_class`** — the CVC four-type taxonomy (driving/enabling/emergent/passive) plus `jv`, mapped onto the ADR-0047 cells (driving/enabling ≈ 9/10 internal venture; emergent ≈ 5/6 hybrid/minority; passive ≈ carve-outs; jv ≈ 7/8). Rollups report by class; flattening is a reporting choice, not forced by storage.
   - **Per-measure target required** (CHECK-constrained, single `insufficient_evidence` escape) — a measure without a target is invalid, per balanced-scorecard discipline.
   - **Measure-set size discipline (~20 per scorecard)** enforced by the producing procedure/validator, not SQL — the cap is a practice, not a schema constant.
   - **Weights excluded** — JV scorecard weights and review cadence are open question (b); when decided they enter via the governance-doc reference pattern (like `rag_rule.policy_id`), never a column with silent defaults.
   - **Decisions excluded** — `venture_transition_decision` and tranche releases are approval-chain records (two-tier-approval-chain / group-level-review lineage); this table stores evidence rows only.
   - **JV and portfolio share the table** with `source_procedure` as discriminator — same row shape, same evidence vocabulary, one rollup surface; splitting into two tables would duplicate the E.4 script's read path for zero isolation gain.

3. **The template layer reads this shape**: `templates/deliverables/portfolio-scorecard-rollup-template.md` and `jv-health-scorecard-template.md` (landed with the remediation PR-3) use the same section/measure/target/actual/status fields, so a filled template maps 1:1 onto rows when the migration lands.

## Consequences

- Open question (e) resolves to "yes, a schema addition" at the design level; the E.4 chain's first link is now unblocked — migration → monitoring script (`scripts/co-newbiz/` portfolio rollup) → portfolio view, in that order, next round.
- Cells 5/6/9 stay thin (class D) until that chain lands; this ADR changes nothing at runtime.
- `evidence_ref` reuses the ADR-0058 citation vocabulary — no new citation format.
- No kill-criteria impact (scorecard rows are evidence, not gate-time halts — same boundary PR-12e drew).
- Policy impact: none — no procedure/policy document changes; this ADR is the decision record for the future migration.

## Cross-references

- ADR-0052 §E + open questions (b), (e) — the monitoring design this storage serves; weights stay open.
- Readiness audit R3/R8 (`docs/audits/2026-08-23-readiness-audit.md`); research basis `docs/research/readiness-gap-best-practice.md` Area 1.
- Remediation design `docs/designs/2026-08-23-readiness-gap-remediation-design.md` §2 (shape requirements), §7 (landing sequence).
