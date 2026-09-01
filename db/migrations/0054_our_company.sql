-- 0054_our_company.sql
-- 우리 회사 분석 — 그룹/계열사 2단계 자사 프로파일 (flow.spec S3의 입력).
--   company_group           : 그룹(지주·HQ) 단위
--   company_group_member    : 그룹 소속 계열사 (DART 코드 선택 또는 비상장 직접 입력)
--   company_profile_version : 계열사별 프로파일 분석 결과 (append-only 버전)
-- Additive-only (ADR-0014).
CREATE TABLE company_group (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE company_group_member (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES company_group(id),
  company_name TEXT NOT NULL,
  dart_corp_code TEXT,
  role TEXT NOT NULL DEFAULT 'affiliate' CHECK (role IN ('hq', 'affiliate')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_cgm_group ON company_group_member(group_id);

CREATE TABLE company_profile_version (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES company_group_member(id),
  version_no INTEGER NOT NULL,
  payload TEXT NOT NULL,
  source_ref TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (member_id, version_no)
);
CREATE INDEX idx_cpv_member ON company_profile_version(member_id, version_no DESC);
