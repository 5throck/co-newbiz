-- 0037_contract_coc_clause.sql
-- Structured record for the customer-attrition validator (ma-07/ma-08):
-- change-of-control clauses in customer/supplier contracts plus
-- concentration, churn estimate, and competitive-overlap notes.
-- Design of record: docs/adr/0072-contract-coc-clause-table.md.
-- value_impact is INTEGER KRW millions (ADR-0061).
CREATE TABLE contract_coc_clause (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  counterparty TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('customer', 'supplier')),
  coc_clause_present INTEGER NOT NULL CHECK (coc_clause_present IN (0, 1)),
  clause_summary TEXT,
  concentration_pct REAL CHECK (concentration_pct IS NULL OR (concentration_pct >= 0 AND concentration_pct <= 100)),
  est_churn_pct REAL CHECK (est_churn_pct IS NULL OR (est_churn_pct >= 0 AND est_churn_pct <= 100)),
  overlap_note TEXT,
  value_impact INTEGER,
  evidence_ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ccc_project ON contract_coc_clause(project_id);
