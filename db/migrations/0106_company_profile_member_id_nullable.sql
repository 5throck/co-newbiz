-- @reversible: true (table-rebuild for NOT NULL relaxation — SQLite can't ALTER
-- a column's NOT NULL, 0049/0102/0104 방식(테이블 재생성)을 따른다; rollback은
-- pre-migration backup 복원, scripts/co-newbiz/restore.ts)
-- 0105에서 추가한 company_id 전용 행(브라운필드 후보 등)은 member_id가 없다 —
-- 원 스키마(0054)의 member_id NOT NULL 제약을 풀어야 실제 INSERT가 가능하다
-- (사용자 리포트 "NOT NULL constraint failed: company_profile_version.member_id",
-- 2026-09-15). CHECK로 member_id/company_id 중 최소 하나는 있도록 강제한다.
CREATE TABLE company_profile_version_new (
  id TEXT PRIMARY KEY,
  member_id TEXT REFERENCES company_group_member(id),
  company_id TEXT REFERENCES md_company(id),
  version_no INTEGER NOT NULL,
  payload TEXT NOT NULL,
  source_ref TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (member_id IS NOT NULL OR company_id IS NOT NULL)
);
INSERT INTO company_profile_version_new SELECT id, member_id, company_id, version_no, payload, source_ref, created_by, created_at FROM company_profile_version;
DROP TABLE company_profile_version;
ALTER TABLE company_profile_version_new RENAME TO company_profile_version;
CREATE UNIQUE INDEX idx_cpv_member_version ON company_profile_version(member_id, version_no) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX idx_cpv_company_version ON company_profile_version(company_id, version_no) WHERE company_id IS NOT NULL;
CREATE INDEX idx_cpv_member ON company_profile_version(member_id, version_no DESC);
CREATE INDEX idx_cpv_company ON company_profile_version(company_id, version_no DESC);
