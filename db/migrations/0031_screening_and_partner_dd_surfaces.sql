-- 0031_screening_and_partner_dd_surfaces.sql
-- @version 1.0.0
-- @reversible: true (additive DDL — two new tables; reversal is DROP TABLE,
-- backup-first per ADR-0014)
--
-- ADR-0067 — kill-criteria extension round 4: screening longlist + partner
-- DD finding surfaces. Unblocks entries #12 (no_viable_target_in_longlist)
-- and #15/#16 (partner red findings) by giving "red/viable in machine-
-- readable form" a home, per the disposition of record
-- docs/decisions/2026-08-24-evidence-source-backlog-disposition.md.
--
--   screening_longlist   Screening-gate candidate register; viability is
--                        the knock-out verdict recorded per candidate.
--                        #12 halts when the longlist has rows but ZERO
--                        viable candidates (empty list = not yet screened).
--   partner_dd_finding   Per-partner DD findings with workstream +
--                        severity vocabularies; #15/#16 tripwires count
--                        RED findings on their workstreams.

CREATE TABLE screening_longlist (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  candidate_name TEXT NOT NULL,
  knock_out_passed INTEGER NOT NULL CHECK (knock_out_passed IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_screening_longlist_project ON screening_longlist(project_id);

CREATE TABLE partner_dd_finding (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  partner_id TEXT NOT NULL REFERENCES partner_candidate(id),
  workstream TEXT NOT NULL CHECK (workstream IN ('financial_distress', 'ip_chain', 'general')),
  severity TEXT NOT NULL CHECK (severity IN ('red', 'amber', 'green')),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_partner_dd_finding_project ON partner_dd_finding(project_id);
CREATE INDEX idx_partner_dd_finding_partner ON partner_dd_finding(partner_id);

INSERT INTO evidence_var (var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, created_at) VALUES
  ('screening.viable_targets', '롱리스트 생존 후보 수', 'number', 'count', 'computed', 0, '2026-08-25T00:00:00Z'),
  ('partner.financial_distress_red_count', '파트너 DD 재무건전성 레드 파인딩 수', 'number', 'count', 'computed', 0, '2026-08-25T00:00:00Z'),
  ('partner.dd_ip_chain_red_count', '파트너 DD IP 체인 레드 파인딩 수', 'number', 'count', 'computed', 0, '2026-08-25T00:00:00Z');
