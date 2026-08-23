-- 0025_class_c_thresholds_and_antitrust_reversal.sql
-- @version 1.0.0
-- @reversible: true (pure data migration — 2 INSERTs against seed-only tables;
-- reversal is DELETE by the two seeded ids, backup-first per ADR-0014)
-- ADR-0062 (reversal of migration-0018 Decision 4) + the Class C decision
-- record docs/decisions/2026-08-24-class-c-decisions.md (the approving user
-- record). Two seeds, nothing else:
--
--   (1) governance_doc row for the Class C record — the thresholds_source
--       anchor every Class-C-thresholded criterion and future rule cites
--       (same pattern as 0022's three gd-0022-* rows).
--   (2) evidence_var 'antitrust.presumption_screens_triggered' — the ONE var
--       the reversal admits: count of antitrust_finding rows inside the
--       2023 DOJ/FTC structural-presumption zone (hhi_after > 1800 AND
--       delta > 100). Computed; requires_evidence_ref=0 (0017 convention —
--       provenance rides the source query).
--
-- Deliberately NOT here: rag_rule rows over the new var (the reversal is a
-- kill-criteria tripwire only — regulatory_permit keeps exclusive grading
-- claim on antitrust_finding); any PMI/deal-shape vars (their threshold half
-- is decided by the record but the var half needs its own extension rounds,
-- ADR-0060 §3); share>30% screen (no market-share column exists).

INSERT INTO governance_doc (id, layer, key, title, scope, version, enforceability, owner_agent, doc_path, effective_from) VALUES
  ('gd-0024-class-c-decisions', 'policy', 'class-c-decisions', 'Decision Record - Class C Residual Decisions (Approved Async)', 'shared', 'v1.0', 'mandatory', 'process-governance-manager', 'docs/decisions/2026-08-24-class-c-decisions.md', '2026-08-24T00:00:00Z');

INSERT INTO evidence_var (var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, created_at) VALUES
  ('antitrust.presumption_screens_triggered', 'HHI 구조적 추정권 초기 스크린 발동 수', 'number', 'count', 'computed', 0, '2026-08-24T00:00:00Z');
