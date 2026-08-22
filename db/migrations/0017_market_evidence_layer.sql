-- @reversible: true (additive DDL + seed data — one CREATE TABLE, one CREATE INDEX, seed rows only; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts — ADR-0014. A manual rollback, legal only while project_variable_snapshot has zero writers and zero rows, is: DROP TABLE project_variable_snapshot; DELETE the rag_rule_variable rows of the five staged rules; DELETE the five rag_rule rows; DELETE the ten evidence_var seeds — the var deletions are legal only while no dimension_input row references them, verified 0 rows at seed time.)
-- Market dimension evidence layer — design of record
-- docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md,
-- Decision 2 (run-scoped variable snapshot) + Decision 6 (corrected market
-- evidence mapping), ADR-0046 §5 (snapshot table). Thresholds agenda:
-- docs/decisions/open/market-thresholds.md. PR-6.
--
-- Three sections, in dependency order:
--   (a) project_variable_snapshot — Decision 2's DDL, never landed (PR-2
--       created only evidence_var + rag_rule_variable)
--   (b) evidence_var seeds — the decidable market vars per Decision 6
--   (c) rag_rule staged skeleton — 5 disabled placeholder rows + the
--       rag_rule_variable wiring, which must come after the seeds (FK).
--
-- ── (a) THE FOURTH STATUS — one documented deviation from the design DDL ──
-- The design's Decision 2 sketch enumerates status IN
-- ('present','missing','stale'). Its own Decision 6 text REQUIRES more:
-- value_chain_link-derived vars must be excluded on low fit quality SO THAT
-- low confidence is distinguishable from missing ("r2 < 0.6 시 저신뢰 배제…
-- 결측과 저신뢰를 구분 못 함" — the named defect of the current state). A
-- 3-status table cannot express that distinction: a value excluded on fit
-- quality is not missing (a value EXISTS and was measured) and not stale
-- (age is not the problem); marking it present would make it
-- indistinguishable from trusted values, and any present-row marker would be
-- an out-of-schema convention. The table is brand new — zero writers, zero
-- rows — so extending the enum now is free; the alternative is an ALTER on a
-- live table in the post-meeting filler PR.
--
-- The exclusion STANDARD is decided but deliberately NOT encoded anywhere in
-- this migration: value_chain_link-derived vars are excluded on r2 < 0.6,
-- the same criterion gradeChain() applies to statistical hops (D-M4-1,
-- db/lib/chain-grading.ts). No consumer exists until the value_chain_link
-- filler lands (agenda-gated, §5.1/§5.3/§3.1); encoding the constant with no
-- reader would be decoration — the exact failure mode ADR-0046 records for
-- requires_evidence_ref.
--
-- FILLER DISCIPLINE (Decision 2's F-7/F-8/F-9 resolution, restated because
-- it binds the future filler, not this migration): population is
-- hand-written, code-reviewed static SQL per variable family — never dynamic
-- identifier interpolation, never a {table, column} descriptor. dimension_input
-- is ONE source among several that populate the snapshot, not the special
-- case. The fillers themselves are OUT of scope here and gated on the
-- thresholds meeting.
--
-- ── SCOPE — what lands vs what the meeting owns ──────────────────────────
-- (docs/decisions/open/market-thresholds.md §5 enumerates the deferrals)
--   Lands now: the snapshot table, the 9 decidable var seeds (+ the
--     fit-quality var below = 10 rows), the staged disabled rule skeleton.
--   NOT seeded: market.competitive_intensity — source undecided (agenda
--     §5.1, blocking item #1; §3.2 notes it may not be a standalone var at
--     all, only the composite that spans growth/entry-barrier/top3).
--   Deferred with agenda citations: switching_cost_grade CHECK (§5.2 — no
--     vocabulary exists anywhere, 0 table rows and 0 pilot references;
--     landing a CHECK would invent policy), fact_industry metric_key
--     convention for TAM/growth (§5.3), entry_barrier / right_to_win ordinal
--     vocabularies (§5.4), every numeric threshold (§5.6 — gates PR-9
--     activation per the agenda header), the fact_industry and
--     value_chain_link snapshot fillers, the r2 < 0.6 exclusion enforcement,
--     Amber-cap enforcement, and all market grading logic (no thresholds →
--     no grade can be honestly emitted).
--
-- ── (b) SEEDS — 10 rows ──────────────────────────────────────────────────
--   source_kind='computed' for tam/growth_rate/top3_share is honest even
--   though the fact_industry metric_key convention is meeting #3: the SOURCE
--   KIND is decided (fact_industry is a computed source); the key mapping is
--   not. The same holds for bargaining_power_hhi and switching_cost_grade
--   (value_chain_link is a computed source).
--   right_to_win.* are number because agenda §3.6 structures them as
--   cmp gte; the ordinal SCALE itself is meeting #4, so unit stays NULL.
--   market.link_fit_quality is the 10th seed: agenda §3.1's two-conjunct
--   bargaining-power shape references a fit-quality var, and r2 lives on the
--   value_chain_link row — so the var is computable and decidable today.
--   Seeding it keeps every rule-referenced var in the registry and the join
--   table truthful (the alternative — dropping the conjunct — is recorded in
--   the PR-6 spec and rejected).
--   created_at is a fixed literal '2026-08-23T00:00:00Z' (ADR-0002: no
--   dynamic date functions) so the seed set is byte-deterministic. Row
--   duplication on re-execution is impossible: the runner's schema_migrations
--   bookkeeping is the idempotence mechanism, the PRIMARY KEYs the hard
--   backstop (0014 pattern).
--
-- ── (c) STAGED RULE SKELETON — anti-tamper staging ───────────────────────
-- Rules MAY carry "_threshold_placeholder" scalars while enabled=0; the SQL
-- CHECK (enabled=1 ⇒ policy_id AND thresholds_source) plus the zod
-- enablement check (PR-9) keep them unactivatable without the meeting
-- record. All five rows: version=1, enabled=0, policy_id=NULL,
-- thresholds_source=NULL, stage_gate='dd', dimension='market', created_at
-- fixed literal.
--   grade='amber' for ALL five — the placeholder convention: the only grade
--   that survives the Decision 9 Green cap pre-calibration (uncalibrated
--   market rules may emit Amber or Red, never Green), so a placeholder row
--   cannot manufacture a Green signal even if activated in error. The
--   meeting may re-grade any rule.
--   condition_expr is the PR-1 predicate AST (db/lib/predicate.ts
--   PredicateSchema), every UNDECIDED scalar as the string
--   "_threshold_placeholder". One schema-forced exception: at_least.k must
--   be an integer (zod z.number().int()), so market-dd-right-to-win carries
--   k=2 — the agenda §3.6 note's own worked-example value, inert while
--   enabled=0, re-decided at the meeting together with the per-var cuts.
--   Structures per agenda §3: bargaining-power = §3.1's two conjuncts;
--   competitive-demerit = §3.2's composite (the user's worked example);
--   switching-cost = §3.3; tam-growth = §3.4; right-to-win = §3.6.
--   rag_rule_variable wires each rule's referenced vars exactly — asserted
--   by tests/unit/migration-0017.test.ts against collectPredicateVars
--   (db/lib/applies-when.ts), so a drifted join row fails a test, not a
--   silent LIKE scan.

CREATE TABLE project_variable_snapshot (
  run_id TEXT NOT NULL REFERENCES run(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  var_key TEXT NOT NULL REFERENCES evidence_var(var_key),
  value_num NUMERIC, value_text TEXT,
  evidence_ref TEXT, observed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('present','missing','stale','low_confidence')),
  PRIMARY KEY (run_id, project_id, var_key)
);
CREATE INDEX idx_project_variable_snapshot_project ON project_variable_snapshot(project_id, var_key);

INSERT INTO evidence_var (var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, created_at) VALUES
  ('market.bargaining_power_hhi', '상하방 교섭력(HHI)', 'number', 'ratio', 'computed', 0, '2026-08-23T00:00:00Z'),
  ('market.switching_cost_grade', '고객 전환비용 등급', 'string', NULL, 'computed', 0, '2026-08-23T00:00:00Z'),
  ('market.tam', '시장 총규모(TAM)', 'number', 'krw', 'computed', 0, '2026-08-23T00:00:00Z'),
  ('market.growth_rate', '시장 성장률', 'number', 'ratio', 'computed', 0, '2026-08-23T00:00:00Z'),
  ('market.top3_share', '상위 3개사 점유율', 'number', 'ratio', 'computed', 0, '2026-08-23T00:00:00Z'),
  ('market.entry_barrier', '진입장벽', 'string', NULL, 'asserted', 1, '2026-08-23T00:00:00Z'),
  ('right_to_win.customer_overlap', '우위 원천: 고객 중첩', 'number', NULL, 'asserted', 1, '2026-08-23T00:00:00Z'),
  ('right_to_win.tech_overlap', '우위 원천: 기술 중첩', 'number', NULL, 'asserted', 1, '2026-08-23T00:00:00Z'),
  ('right_to_win.brand_transferability', '우위 원천: 브랜드 이전가능성', 'number', NULL, 'asserted', 1, '2026-08-23T00:00:00Z'),
  ('market.link_fit_quality', '밸류체인 연결 적합도(r2)', 'number', 'ratio', 'computed', 0, '2026-08-23T00:00:00Z');

INSERT INTO rag_rule (id, rule_key, version, stage_gate, dimension, grade, condition_expr, priority, enabled, policy_id, thresholds_source, created_at) VALUES
  ('rule-0017-market-dd-bargaining-power', 'market-dd-bargaining-power', 1, 'dd', 'market', 'amber', '{"op":"all_of","of":[{"op":"cmp","var":"market.bargaining_power_hhi","cmp":"gte","value":"_threshold_placeholder"},{"op":"cmp","var":"market.link_fit_quality","cmp":"gte","value":"_threshold_placeholder"}]}', 1, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0017-market-dd-competitive-demerit', 'market-dd-competitive-demerit', 1, 'dd', 'market', 'amber', '{"op":"all_of","of":[{"op":"cmp","var":"market.growth_rate","cmp":"lt","value":"_threshold_placeholder"},{"op":"in","var":"market.entry_barrier","values":["_threshold_placeholder"]},{"op":"cmp","var":"market.top3_share","cmp":"gte","value":"_threshold_placeholder"}]}', 2, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0017-market-dd-switching-cost', 'market-dd-switching-cost', 1, 'dd', 'market', 'amber', '{"op":"in","var":"market.switching_cost_grade","values":["_threshold_placeholder"]}', 3, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0017-market-dd-tam-growth', 'market-dd-tam-growth', 1, 'dd', 'market', 'amber', '{"op":"any_of","of":[{"op":"cmp","var":"market.tam","cmp":"lt","value":"_threshold_placeholder","unit":"krw"},{"op":"cmp","var":"market.growth_rate","cmp":"lt","value":"_threshold_placeholder","unit":"ratio"}]}', 4, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0017-market-dd-right-to-win', 'market-dd-right-to-win', 1, 'dd', 'market', 'amber', '{"op":"at_least","k":2,"of":[{"op":"cmp","var":"right_to_win.customer_overlap","cmp":"gte","value":"_threshold_placeholder"},{"op":"cmp","var":"right_to_win.tech_overlap","cmp":"gte","value":"_threshold_placeholder"},{"op":"cmp","var":"right_to_win.brand_transferability","cmp":"gte","value":"_threshold_placeholder"}]}', 5, 0, NULL, NULL, '2026-08-23T00:00:00Z');

INSERT INTO rag_rule_variable (rule_id, var_key) VALUES
  ('rule-0017-market-dd-bargaining-power', 'market.bargaining_power_hhi'),
  ('rule-0017-market-dd-bargaining-power', 'market.link_fit_quality'),
  ('rule-0017-market-dd-competitive-demerit', 'market.growth_rate'),
  ('rule-0017-market-dd-competitive-demerit', 'market.entry_barrier'),
  ('rule-0017-market-dd-competitive-demerit', 'market.top3_share'),
  ('rule-0017-market-dd-switching-cost', 'market.switching_cost_grade'),
  ('rule-0017-market-dd-tam-growth', 'market.tam'),
  ('rule-0017-market-dd-tam-growth', 'market.growth_rate'),
  ('rule-0017-market-dd-right-to-win', 'right_to_win.customer_overlap'),
  ('rule-0017-market-dd-right-to-win', 'right_to_win.tech_overlap'),
  ('rule-0017-market-dd-right-to-win', 'right_to_win.brand_transferability');
