-- @reversible: true (pure data migration — 3 INSERTs + 18 UPDATEs against seed-only
-- tables; manual rollback = re-NULL the anchors and set enabled=0 on the 18 rows,
-- DELETE the three gd-0022-* rows. Full-restore mechanism for production is
-- pre-migration backup restore, see scripts/co-newbiz/restore.ts — ADR-0014.)
-- PR-9 — rule activation. D-M-TE-8 "Activation prerequisites" step 3, D-M-RISK-5
-- "Dimension-level combination rule (pinned for PR-9)", D-M-MKT-11.2. The three
-- APPROVED records of record (2026-08-23) are the sole source of every value
-- below; this migration invents nothing:
--   docs/decisions/market-thresholds.md                (D-M-MKT-11.3 literal)
--   docs/decisions/risk-thresholds.md                  (header literal)
--   docs/decisions/technical-execution-thresholds.md   (D-M-TE-1..8)
--
-- Two sections, in dependency order:
--   (a) governance_doc seeds — one row per decision record. The doc of record
--       IS the record file (doc_path), so the policy_id anchor points a
--       reviewer straight at the thresholds they are signing against. These
--       are the table's first seed rows (0 rows before this migration,
--       verified); layer='policy' / enforceability='mandatory' because an
--       enabled rag_rule is a binding grading rule, and the 0012 CHECK
--       requires exactly this anchor before enabled=1 is legal.
--   (b) rag_rule activation — enabled=1 + policy_id + thresholds_source for
--       18 of the 19 market/technical_execution/risk rows, every literal
--       verbatim from the records.
--
-- market-dd-right-to-win STAYS enabled=0 (the 19th row): D-M-MKT-10.1 re-graded
-- it amber→green as a MERIT condition, and the record is explicit that its
-- numbers do NOT lift the Decision 9 Green cap (D-M-MKT-11.2) — an enabled
-- green market rule pre-calibration would violate the cap. It activates only
-- when the calibration exercise (ADR-0049 §4) lifts the cap under a new dated
-- record. The same cap is why no other row carries grade green: an all-FALSE
-- dimension caps to Amber at evaluation time (D-M-RISK-5), never Green.
--
-- D-M-TE-5 double-counting guard, verified at this activation review (the
-- record's own requirement) via tests/unit/migration-0022.test.ts over the
-- rag_rule_variable join rows: permit.critical_path_duration /
-- permit.unresolved_on_critical_path are joined by technical_execution rules
-- ONLY; no regulatory_permit rule joins either; no technical_execution rule
-- reads any permit.status-derived var or antitrust_finding (no antitrust var
-- exists in evidence_var at all — premise-locked since 0018).

-- ── (a) governance_doc — the three decision records ──────────────────────

INSERT INTO governance_doc (id, layer, key, title, scope, version, enforceability, owner_agent, doc_path, effective_from) VALUES
  ('gd-0022-market-thresholds', 'policy', 'market-thresholds', 'Decision Record — Market Dimension Thresholds', 'shared', 'v1.0', 'mandatory', 'process-governance-manager', 'docs/decisions/market-thresholds.md', '2026-08-23T00:00:00Z'),
  ('gd-0022-technical-execution-thresholds', 'policy', 'technical-execution-thresholds', 'Decision Record — Technical Execution Dimension Thresholds', 'shared', 'v1.0', 'mandatory', 'process-governance-manager', 'docs/decisions/technical-execution-thresholds.md', '2026-08-23T00:00:00Z'),
  ('gd-0022-risk-thresholds', 'policy', 'risk-thresholds', 'Decision Record — Risk Dimension Thresholds', 'shared', 'v1.0', 'mandatory', 'process-governance-manager', 'docs/decisions/risk-thresholds.md', '2026-08-23T00:00:00Z');

-- ── (b) rag_rule activation — 18 rows, anchors verbatim from the records ──
-- Explicit rule_key IN-lists (never a dimension-wide UPDATE): a future staged
-- row must never be auto-activated by this migration's breadth.

-- market — 7 rows (D-M-MKT-11.3's literal, character for character)
UPDATE rag_rule SET enabled = 1, policy_id = 'gd-0022-market-thresholds', thresholds_source = 'D-M-MKT-1..11, market thresholds meeting 2026-08-23 (market-intelligence-agent, industry-lead, risk-officer, chair process-governance-manager) — docs/decisions/market-thresholds.md, supersedes docs/decisions/open/market-thresholds.md'
WHERE rule_key IN (
  'market-dd-bargaining-power',
  'market-dd-competitive-demerit',
  'market-dd-switching-cost',
  'market-dd-tam-growth',
  'market-screening-tam-growth',
  'market-pre-fs-tam-growth',
  'market-dd-right-to-win-absent'
);

-- technical_execution — 7 rows (D-M-TE-8; thresholds_source = this record)
UPDATE rag_rule SET enabled = 1, policy_id = 'gd-0022-technical-execution-thresholds', thresholds_source = 'docs/decisions/technical-execution-thresholds.md — D-M-TE-1..8, meeting 2026-08-23'
WHERE rule_key IN (
  'tech-dd-trl-pre-validation',
  'tech-dd-trl-grade',
  'tech-dd-ip-disputed',
  'tech-dd-ip-clarity',
  'tech-dd-cert-load-bearing-loss',
  'tech-dd-cert-transferability',
  'tech-dd-permit-critical-path'
);

-- risk — 4 rows (the record header's literal, character for character)
UPDATE rag_rule SET enabled = 1, policy_id = 'gd-0022-risk-thresholds', thresholds_source = 'docs/decisions/risk-thresholds.md — D-M-RISK-1..7, meeting 2026-08-23 (risk-officer, valuation-agent, legal-counsel, process-governance-manager chair)'
WHERE rule_key IN (
  'risk-dd-covenant-breach',
  'risk-dd-contingent-expected-value',
  'risk-dd-contingent-two-factor',
  'risk-dd-partner-sourcing'
);
