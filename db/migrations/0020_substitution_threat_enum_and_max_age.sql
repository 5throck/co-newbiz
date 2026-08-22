-- @reversible: true (the value_chain_link rebuild carries no data change —
-- every column and 0019's switching_cost_grade CHECK are reproduced verbatim,
-- only the substitution_threat CHECK clause is added; the table is written
-- generically so rows carry through. Manual rollback, legal only while the
-- table is unreferenced by data: re-run the 0019 value_chain_link shape
-- through the same rebuild procedure to drop the CHECK; reverse the two
-- max_age_days UPDATEs (SET NULL). Full-restore mechanism for production is
-- pre-migration backup restore, see scripts/co-newbiz/restore.ts — ADR-0014.)
-- Filler-PR rider + registry hygiene. Two sections:
--   (a) D-M-MKT-2's open rider action item (docs/decisions/market-thresholds.
--       md §D-M-MKT-11.4 / rag-framework.md §5-1): substitution_threat gets a
--       CHECK enum.
--   (b) D-M-MKT-3's recommended evidence_var.max_age_days = 730 for the three
--       fact_industry-computed vars ("filler-PR detail, flagged not decided
--       here" — the record RECOMMENDS it; landing it with the filler that
--       reads it is the record's own assignment of the work).
--
-- ── (a) IMPLEMENTATION PROPOSAL PENDING RATIFICATION — inventoried, not
-- invented-as-policy: a repo-wide scan (app/server readers, app/web renderers,
-- procedures, checklists, skills, docs) found NO established substitution_
-- threat vocabulary anywhere — the column is read nowhere and rendered as
-- free text. Per the filler-PR instruction (mirror switching_cost_grade if no
-- vocabulary exists, and DOCUMENT the mirror as a proposal pending
-- ratification), this lands the five-member ordinal with IDENTICAL members
-- to switching_cost_grade (D-M-MKT-2): 'negligible'|'low'|'moderate'|'high'|
-- 'very_high', NULL allowed. Direction: higher = more substitution threat
-- (the ordinal scales OPPOSITELY in meaning to switching_cost_grade, where
-- higher = more lock-in — same labels, opposite sign). Owner of the
-- ratification: process-governance-manager (the rider's owner). Until
-- ratified, the CHECK's only effect is typo-rejection on writes — no rule
-- reads the column (market-dd-switching-cost reads switching_cost_grade), so
-- nothing downstream can activate on an unratified vocabulary.
--
-- ── (b) The staleness gate the fact filler enforces: market.tam /
-- market.growth_rate / market.top3_share carry max_age_days = 730 (2 years of
-- annual data). The filler reads this column at fill time (db/lib/
-- snapshot-filler.ts Family A), so the number lives in exactly one place.

CREATE TABLE value_chain_link_constrained (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  from_industry_id TEXT NOT NULL REFERENCES md_industry(id),
  to_industry_id TEXT NOT NULL REFERENCES md_industry(id),
  direction TEXT NOT NULL CHECK (direction IN ('upstream', 'downstream')),
  elasticity REAL,
  lag_months INTEGER,
  correlation REAL,
  r2 REAL,
  pass_through_rate REAL,
  pass_through_lag_months INTEGER,
  concentration_hhi REAL,
  switching_cost_grade TEXT CHECK (switching_cost_grade IS NULL OR switching_cost_grade IN ('negligible','low','moderate','high','very_high')),
  substitution_threat TEXT CHECK (substitution_threat IS NULL OR substitution_threat IN ('negligible','low','moderate','high','very_high')),
  evidence_ref TEXT,
  assessed_at TEXT NOT NULL
);
INSERT INTO value_chain_link_constrained (id, project_id, from_industry_id, to_industry_id, direction, elasticity, lag_months, correlation, r2, pass_through_rate, pass_through_lag_months, concentration_hhi, switching_cost_grade, substitution_threat, evidence_ref, assessed_at)
  SELECT id, project_id, from_industry_id, to_industry_id, direction, elasticity, lag_months, correlation, r2, pass_through_rate, pass_through_lag_months, concentration_hhi, switching_cost_grade, substitution_threat, evidence_ref, assessed_at FROM value_chain_link;
DROP TABLE value_chain_link;
ALTER TABLE value_chain_link_constrained RENAME TO value_chain_link;
CREATE INDEX idx_value_chain_link_project ON value_chain_link(project_id);

UPDATE evidence_var SET max_age_days = 730 WHERE var_key IN ('market.tam', 'market.growth_rate', 'market.top3_share');
