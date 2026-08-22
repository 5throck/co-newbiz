-- @reversible: true (pure seed migration — zero DDL; every table touched already
-- exists: evidence_var/rag_rule/rag_rule_variable since 0012, project_variable_
-- snapshot since 0017. Manual rollback, legal only while nothing references the
-- seeds, is: DELETE the rag_rule_variable rows of the eight staged rules; DELETE
-- the eight rag_rule rows; DELETE the eleven evidence_var seeds — the var
-- deletions are legal only while no dimension_input or project_variable_snapshot
-- row references them, verified 0 rows at seed time.)
-- technical_execution + risk dimension evidence layer — design of record
-- docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md
-- (plan row PR-7; risk axes per Decision 8), ADR-0046 §5. Thresholds agendas:
-- docs/decisions/open/technical-execution-thresholds.md and
-- docs/decisions/open/risk-thresholds.md. PR-7.
--
-- ── SCOPE — the PR-6 resolution, applied ──────────────────────────────────
-- Both agendas are meeting artifacts: every number, vocabulary, enum, and gate
-- assignment is a §5 meeting decision. This migration lands ONLY the decidable
-- evidence layer: the 11 var seeds, the 8 staged disabled placeholder rules,
-- the 11 rag_rule_variable rows. Deferred with citations (full table in
-- .git/research/pr7-technical-risk-evidence-layer-spec.md §0):
--   trl_grade / ip_ownership_status CHECK enums (tech §5.1/§5.2 — the
--     vocabularies themselves are "subject to confirmation"; landing a CHECK
--     would invent policy exactly as PR-6 refused for switching_cost_grade),
--   ordinal TRL treatment (tech §5.1), cert/permit one-or-two axes (§5.3),
--   the technical-vs-regulatory_permit permit boundary (§5.4), missing-evidence
--     treatment per gate (tech §5.5 / risk §5.5), business-criticality
--     weighting (tech §3.3(a) — no such field exists; adding one is
--     meeting-first), contingent-liability form + denominator (risk §5.1 —
--     BOTH forms (a) and (b) are staged per option (c); the meeting may drop
--     either), covenant recency/cured/type (risk §5.2 — the recency-qualified
--     variant is NOT staged; the agenda marks it "possibly"), partner status
--     enum + dependency_risk vocabulary (risk §5.3), graded-vs-kill-triggering
--     per axis (risk §5.4 — esp. partner-sourcing, which may belong in a kill
--     criterion instead), every numeric threshold (§5.6), the thresholds_source
--     record itself (§5.7), ALL snapshot fillers (post-meeting filler PR, the
--     0017 precedent), and Green-cap enforcement (PR-9).
--   antitrust_finding is EXCLUDED BY PREMISE (risk agenda §2.1, Decision 4 /
--   F19): it already feeds regulatory_permit; a risk rule over it would
--   double-count one finding across two of the six dimensions. Reversal is a
--   separate ADR, never a threshold decision. No var, no rule, no join row.
--
-- ── SEEDS — 11 rows, ALL computed, ZERO asserted ───────────────────────────
-- Unlike market (which carried asserted human-judgement vars), every source
-- here is an existing table/column, verified present in migrations 0005/0011/
-- 0012: dd_finding.trl_grade + .ip_ownership_status (0011, unconstrained TEXT
-- — the enums are the meeting's), certification.transferable_on_coc (0012;
-- inferred basis is write-blocked in the repository since PR-3, so a filler
-- can never count an inferred row), permit + permit_edge (critical path is
-- derivable, not asserted — tech agenda §2), contingent_liability.probability
-- × .amount_expected (0005; REAL monetary columns are the recorded F-3 debt —
-- exact-equality boundary values are not reliable, a risk-agenda §3.1 caveat),
-- covenant_test.breached, partner_candidate.status + .dependency_risk (0011).
-- requires_evidence_ref=0 for all eleven: computed vars carry provenance
-- through their source query, not per-row refs (the 0017 convention).
-- created_at is the SAME fixed literal 0017 used ('2026-08-23T00:00:00Z',
-- ADR-0002: no dynamic date functions) so both seed sets are byte-deterministic
-- and mutually consistent. Idempotence: schema_migrations bookkeeping plus the
-- PRIMARY KEYs as the hard backstop (0014 pattern).
--
-- ── STAGED RULE SKELETON — anti-tamper staging ────────────────────────────
-- Rules MAY carry "_threshold_placeholder" scalars while enabled=0; the SQL
-- CHECK (enabled=1 ⇒ policy_id AND thresholds_source) plus the zod enablement
-- check (PR-9) keep them unactivatable without the meeting record. All eight
-- rows: version=1, enabled=0, policy_id=NULL, thresholds_source=NULL,
-- grade='amber' (the placeholder convention — the only grade surviving the
-- Decision-9 Green cap pre-calibration, so a placeholder cannot manufacture
-- Green even if activated in error), created_at fixed literal.
--   stage_gate='dd' is a STAGING DEFAULT, re-decided at the meetings: the tech
--   agenda §3.1 explicitly says "The meeting should state which gate each
--   threshold applies at rather than assuming DD" and the risk agenda assigns
--   no gates at all. The value is inert while enabled=0; the activation PR
--   (post-meeting) restates it per the decision record.
--   SCHEMA-FORCED COUNT EXCEPTIONS (the at_least.k=2 precedent, 0017):
--   count.value is zod z.number() — no string placeholder is possible. The
--   count-bearing nodes therefore carry the DEGENERATE MAXIMAL-SENSITIVITY
--   integers: gte 1 ("any exists") and lte 0 ("none exist") — the
--   least-committal readings, each biased toward MORE Amber/Red signal on a
--   disabled row and never toward Green. The meetings re-decide every cut.
--   Consequence: tech-dd-cert-transferability and risk-dd-covenant-breach
--   contain zero string placeholders by construction — enumerated as the
--   sanctioned exceptions in tests/unit/migration-0018.test.ts.
--   Structures per the agendas' own sketches: tech §3.1 membership form /
--   §3.2 (the is_null conjunct is sketched by the agenda but flagged
--   gate-dependent — kept because staging follows the sketch, contested in
--   the header, re-decided at the meeting) / §3.3(a) / §3.3(b); risk §3.1(a)
--   + §3.1(b) (staging both = option (c)) / §3.2 primary form / §3.3
--   conjunction ("few-or-no candidates AND high dependency" — the thin pool
--   is only a risk where dependency is high).
--   rag_rule_variable wires each rule's referenced vars exactly — asserted by
--   tests against collectPredicateVars (db/lib/applies-when.ts), so a drifted
--   join row fails a test, not a silent LIKE scan. R2's in + is_null share one
--   var: one join row (composite PK dedups).

INSERT INTO evidence_var (var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, created_at) VALUES
  ('tech.trl_grade', '기술 성숙도(TRL)', 'string', NULL, 'computed', 0, '2026-08-23T00:00:00Z'),
  ('tech.ip_ownership_status', 'IP 소유 명확성', 'string', NULL, 'computed', 0, '2026-08-23T00:00:00Z'),
  ('cert.non_transferable_on_coc', 'COC 시 이전불가 인증 수', 'number', 'count', 'computed', 0, '2026-08-23T00:00:00Z'),
  ('permit.critical_path_duration', '허가 크리티컬패스 기간', 'number', 'months', 'computed', 0, '2026-08-23T00:00:00Z'),
  ('permit.unresolved_on_critical_path', '크리티컬패스 미해결 허가 수', 'number', 'count', 'computed', 0, '2026-08-23T00:00:00Z'),
  ('risk.contingent_expected_value', '우발채무 기대손실액', 'number', 'krw', 'computed', 0, '2026-08-23T00:00:00Z'),
  ('risk.contingent_max_amount', '우발채무 최대 금액', 'number', 'krw', 'computed', 0, '2026-08-23T00:00:00Z'),
  ('risk.contingent_max_probability', '우발채무 최대 발생확률', 'number', 'ratio', 'computed', 0, '2026-08-23T00:00:00Z'),
  ('risk.covenants_breached', '위반된 covenant 수', 'number', 'count', 'computed', 0, '2026-08-23T00:00:00Z'),
  ('risk.partner_candidates_active', '활성 파트너 후보 수', 'number', 'count', 'computed', 0, '2026-08-23T00:00:00Z'),
  ('risk.partner_dependency_risk', '파트너 의존도 위험', 'string', NULL, 'computed', 0, '2026-08-23T00:00:00Z');

INSERT INTO rag_rule (id, rule_key, version, stage_gate, dimension, grade, condition_expr, priority, enabled, policy_id, thresholds_source, created_at) VALUES
  ('rule-0018-tech-dd-trl-grade', 'tech-dd-trl-grade', 1, 'dd', 'technical_execution', 'amber', '{"op":"in","var":"tech.trl_grade","values":["_threshold_placeholder"]}', 1, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0018-tech-dd-ip-clarity', 'tech-dd-ip-clarity', 1, 'dd', 'technical_execution', 'amber', '{"op":"any_of","of":[{"op":"in","var":"tech.ip_ownership_status","values":["_threshold_placeholder"]},{"op":"is_null","var":"tech.ip_ownership_status"}]}', 2, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0018-tech-dd-cert-transferability', 'tech-dd-cert-transferability', 1, 'dd', 'technical_execution', 'amber', '{"op":"count","var":"cert.non_transferable_on_coc","cmp":"gte","value":1}', 3, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0018-tech-dd-permit-critical-path', 'tech-dd-permit-critical-path', 1, 'dd', 'technical_execution', 'amber', '{"op":"any_of","of":[{"op":"cmp","var":"permit.critical_path_duration","cmp":"gt","value":"_threshold_placeholder","unit":"months"},{"op":"count","var":"permit.unresolved_on_critical_path","cmp":"gte","value":1}]}', 4, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0018-risk-dd-contingent-expected-value', 'risk-dd-contingent-expected-value', 1, 'dd', 'risk', 'amber', '{"op":"cmp","var":"risk.contingent_expected_value","cmp":"gte","value":"_threshold_placeholder","unit":"krw"}', 5, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0018-risk-dd-contingent-two-factor', 'risk-dd-contingent-two-factor', 1, 'dd', 'risk', 'amber', '{"op":"all_of","of":[{"op":"cmp","var":"risk.contingent_max_amount","cmp":"gte","value":"_threshold_placeholder","unit":"krw"},{"op":"cmp","var":"risk.contingent_max_probability","cmp":"gte","value":"_threshold_placeholder","unit":"ratio"}]}', 6, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0018-risk-dd-covenant-breach', 'risk-dd-covenant-breach', 1, 'dd', 'risk', 'amber', '{"op":"count","var":"risk.covenants_breached","cmp":"gte","value":1}', 7, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0018-risk-dd-partner-sourcing', 'risk-dd-partner-sourcing', 1, 'dd', 'risk', 'amber', '{"op":"all_of","of":[{"op":"count","var":"risk.partner_candidates_active","cmp":"lte","value":0},{"op":"in","var":"risk.partner_dependency_risk","values":["_threshold_placeholder"]}]}', 8, 0, NULL, NULL, '2026-08-23T00:00:00Z');

INSERT INTO rag_rule_variable (rule_id, var_key) VALUES
  ('rule-0018-tech-dd-trl-grade', 'tech.trl_grade'),
  ('rule-0018-tech-dd-ip-clarity', 'tech.ip_ownership_status'),
  ('rule-0018-tech-dd-cert-transferability', 'cert.non_transferable_on_coc'),
  ('rule-0018-tech-dd-permit-critical-path', 'permit.critical_path_duration'),
  ('rule-0018-tech-dd-permit-critical-path', 'permit.unresolved_on_critical_path'),
  ('rule-0018-risk-dd-contingent-expected-value', 'risk.contingent_expected_value'),
  ('rule-0018-risk-dd-contingent-two-factor', 'risk.contingent_max_amount'),
  ('rule-0018-risk-dd-contingent-two-factor', 'risk.contingent_max_probability'),
  ('rule-0018-risk-dd-covenant-breach', 'risk.covenants_breached'),
  ('rule-0018-risk-dd-partner-sourcing', 'risk.partner_candidates_active'),
  ('rule-0018-risk-dd-partner-sourcing', 'risk.partner_dependency_risk');
