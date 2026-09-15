-- @reversible: true (additive column — rollback via DROP COLUMN or pre-migration
-- backup restore, scripts/co-newbiz/restore.ts)
-- 브라운필드 후보 상세화면에서도 그룹/계열사 화면과 동일한 LLM 회사 프로파일
-- 파이프라인(company-profile-pipeline.ts)을 재사용하기 위해, company_profile_version을
-- company_group_member 전용(member_id)에서 md_company 일반(company_id)으로 확장한다
-- (사용자 요청 "일반화하는게 바람직할 듯 해", 2026-09-15). member_id는 그대로 두어
-- 그룹/계열사 화면 기존 데이터·API는 영향받지 않는다 — 신규 브라운필드 프로파일만
-- company_id를 쓴다.
ALTER TABLE company_profile_version ADD COLUMN company_id TEXT REFERENCES md_company(id);

CREATE INDEX idx_cpv_company ON company_profile_version(company_id, version_no DESC);
