-- @reversible: true (purely additive DDL — one CREATE TABLE, two CREATE INDEXes, zero data change; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts — ADR-0014. A manual rollback, legal only while project_industry has zero writers and zero rows, is: DROP TABLE project_industry — no other table references it, verified by repo-wide grep at authoring time.)
-- project→industry binding — ADR-0054
-- (docs/adr/0054-project-industry-binding-for-fact-industry-resolution.md).
-- Closes the record-vs-schema gap the filler PR documented (db/lib/
-- snapshot-filler.ts 1.0.0 header "KNOWN GAP"): docs/decisions/
-- market-thresholds.md D-M-MKT-3 resolves fact_industry metrics per
-- industry_id and D-M-MKT-9 expects TAM/growth live at Screening/Pre-FS,
-- but no project→industry carrier existed anywhere in the schema
-- (value_chain_link endpoints are chain ADJACENCY, not target-market
-- membership — their from/to semantics at Screening are undocumented).
--
-- Pre-checks verified 2026-08-23 against the post-0020 schema:
--   * FK targets exist: md_project(id) and md_industry(id) (both 0001).
--   * No table declares REFERENCES project_industry; no index name
--     collision with idx_project_industry_live / _project.
--
-- The 0013 project_case_classification pattern, applied to industries:
--   - append-only rows (id TEXT PRIMARY KEY) — a binding is history, never
--     a mutable slot; unbinding/re-binding keeps "which industries did this
--     project review against last quarter" answerable (the same audit-trail
--     rationale ADR-0047 §4 gave for project_policy_pin's rebuild);
--   - superseded_by self-reference + partial unique live index: at most one
--     LIVE row per (project_id, industry_id); history rows never block
--     re-binding;
--   - rationale NOT NULL on every row (the dimension_input /
--     project_case_classification discipline: a binding is a judged claim,
--     and who judged it (bound_by) and why (rationale) are inseparable).
--
-- DELIBERATE: multiple DISTINCT live industries per project are LEGAL —
-- multi-industry targets are real (a target spanning two KSIC classes). The
-- consequence is decided at READ time, not banned at write time:
-- snapshot-filler.ts Family A resolves the three fact vars only when
-- exactly one live binding carries rows; two live bindings → the fact vars
-- are written `missing` (no invented aggregation — the record resolves per
-- (industry, metric), and a project-level var over two industries has no
-- decided aggregation). That conservative handling shipped in filler 1.0.0;
-- this migration makes it reachable via bindings instead of only via the
-- caller parameter.
--
-- NO DIRECTION COLUMN: value_chain_link.direction (upstream/downstream)
-- describes the chain relation BETWEEN two industries; this binding is the
-- project's own target-market industry — membership, not traversal. A
-- direction here would invite reading the binding as a chain edge.
--
-- NO SEED / NO BACKFILL: no live projects require one. The pilots'
-- industries get bound when their cases are run — binding is a judged act
-- (bound_by + rationale), and inventing bindings at migration time would be
-- exactly the guess-the-answer the filler's fail-closed default exists to
-- prevent. bound_at is caller-supplied ISO-8601 TEXT (ADR-0002); since this
-- migration seeds nothing, no fixed-literal timestamp appears in it.
--
-- Schema only — no repository writer lands here (the 0013 precedent: the
-- governance-controlled write path is its own PR). The one reader is
-- db/lib/snapshot-filler.ts (1.1.0): live rows are the DEFAULT industry set
-- for the fact family, and the industryIds option UNIONS with the bound set
-- (explicit caller supplement for tests/direct runs), never replaces it.

CREATE TABLE project_industry (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  bound_by TEXT NOT NULL,
  bound_at TEXT NOT NULL,
  rationale TEXT NOT NULL,
  superseded_by TEXT REFERENCES project_industry(id)
);
CREATE UNIQUE INDEX idx_project_industry_live ON project_industry(project_id, industry_id) WHERE superseded_by IS NULL;
CREATE INDEX idx_project_industry_project ON project_industry(project_id, bound_at DESC);
