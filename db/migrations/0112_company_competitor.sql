-- 0112_company_competitor.sql
-- @reversible: true (purely additive — one new table, no existing rows or
-- tables touched. Manual rollback: DROP TABLE company_competitor, or restore
-- from a pre-migration backup — scripts/co-newbiz/restore.ts.)
--
-- Human-confirmed competitor registry (ADR-0142, design
-- 2026-09-18-company-competitor-registry-design): the company-profile LLM
-- payload keeps its competitor list as PROPOSAL input only; a confirmed
-- competitor row is created exclusively by a person's accept/register action
-- and snapshots the cross-check verdict + evidence at accept time. Dual
-- subject follows the company_profile_version 0105/0106 pattern
-- (member_id for /our-company affiliates, company_id for generic md_company
-- subjects such as brownfield targets).

CREATE TABLE company_competitor (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT REFERENCES company_group_member(id),
  company_id TEXT REFERENCES md_company(id),
  name TEXT NOT NULL,
  dart_corp_code TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'excluded')),
  exclusion_reason TEXT,
  discovery_source TEXT NOT NULL CHECK (discovery_source IN ('manual', 'ai_proposal')),
  proposal_accepted_at TEXT NOT NULL,
  crosscheck_verdict TEXT CHECK (crosscheck_verdict IN ('confirmed', 'directional', 'contradicted', 'unverified')),
  evidence_json TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CHECK (member_id IS NOT NULL OR company_id IS NOT NULL)
);
CREATE UNIQUE INDEX idx_company_competitor_member_name
  ON company_competitor(member_id, name) WHERE member_id IS NOT NULL AND status = 'confirmed';
CREATE UNIQUE INDEX idx_company_competitor_company_name
  ON company_competitor(company_id, name) WHERE company_id IS NOT NULL AND status = 'confirmed';
CREATE INDEX idx_company_competitor_member ON company_competitor(member_id, status);
CREATE INDEX idx_company_competitor_company ON company_competitor(company_id, status);
