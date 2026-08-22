-- @reversible: true (additive seed data only — no DDL; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts — ADR-0014. A manual rollback is a plain DELETE of the four var_keys, legal only while no dimension_input/rag_rule_variable row references them — verified 0 rows at seed time.)
-- Routing variable seeds — design of record
-- docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md,
-- Decision 5e (fact-based antitrust gating) and Decision 7 (applies_when
-- reuses the predicate language). PR-5a.
--
-- SEEDS ARE ROUTING FACTS ONLY — scoring-var seeds come with PR-6
-- (project_variable_snapshot scope). Four rows, two source families,
-- consumed by db/lib/applies-when.ts:
--
--   source_kind='column'   the value is READ off the live
--                          project_case_classification row (partial unique
--                          live index, migration 0013) — these are
--                          routing-read views of the ADR-0047 axes, not
--                          independently assertable facts. No live
--                          classification row => all three UNASSESSED.
--   source_kind='asserted' the value is a dimension_input assertion
--                          (migration 0013) — reflected in routing only when
--                          live (superseded_by IS NULL) AND reviewed
--                          (reviewed_by IS NOT NULL), per Decision 3's
--                          cross-domain review-before-use boundary.
--
-- NO DATA DEFAULTS — DELIBERATE. target.has_external_market_presence could
-- tempt a "carve-out units default to TRUE until proven otherwise" seed
-- rationale. It must NOT: absence is the resolver's problem, not the data's.
-- db/lib/applies-when.ts evaluates unassessed routing vars FAIL-CLOSED (the
-- step APPLIES with an applied-by-default note) — a data-side default would
-- silently re-open the exact false-skip path this migration exists to close
-- (reversal #6). The DB records what was asserted; absence stays absence.
--
-- created_at is a fixed literal (portability constraint: no dynamic date
-- functions — ADR-0002) so the seed set is byte-deterministic. Row
-- duplication on any re-execution is impossible: the runner's
-- schema_migrations bookkeeping is the idempotence mechanism, and the
-- var_key PRIMARY KEY is the hard backstop (a duplicate seed row cannot
-- exist in any code path).

INSERT INTO evidence_var (var_key, label_ko, value_type, source_kind, requires_evidence_ref, created_at) VALUES
  ('target.has_external_market_presence', '타깃의 외부시장 경쟁 여부', 'boolean', 'asserted', 1, '2026-08-23T00:00:00Z'),
  ('project.case_type', '케이스 유형', 'string', 'column', 0, '2026-08-23T00:00:00Z'),
  ('project.origin', '사업 기원 분류', 'string', 'column', 0, '2026-08-23T00:00:00Z'),
  ('project.technology_track', '기술 트랙', 'string', 'column', 0, '2026-08-23T00:00:00Z');
