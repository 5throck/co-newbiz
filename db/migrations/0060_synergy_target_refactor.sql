-- 0060_synergy_target_refactor.sql — 시너지 정합성 대상 재편 (ADR-0090).
-- 시너지 분석의 대상을 별도 등록 회사(md_company)에서 그룹/계열사 레지스트리로
-- 전환하고, S2 기회 연결을 추가한다. 기존 행(company_id 기반)은 legacy로 유지 —
-- GET이 둘 다 렌더링하며, 신규 분석은 target_type을 필수로 쓴다. Additive-only (ADR-0014).

ALTER TABLE synergy_analysis ADD COLUMN target_type TEXT CHECK (target_type IN ('affiliate', 'group'));
ALTER TABLE synergy_analysis ADD COLUMN member_id TEXT REFERENCES company_group_member(id);
ALTER TABLE synergy_analysis ADD COLUMN group_id TEXT REFERENCES company_group(id);
ALTER TABLE synergy_analysis ADD COLUMN opportunity_id TEXT REFERENCES opportunity(id);
CREATE INDEX idx_synergy_opp ON synergy_analysis(opportunity_id);

-- company_id(NOT NULL, md_company FK) 유지를 위한 센티널 — 레지스트리 대상 분석은
-- 자신의 md_company 행을 갖지 않으며 이 센티널을 가리킨다 (ADR-0090).
INSERT INTO md_company (id, name_ko, name_en, created_at)
SELECT 'md-synergy-registry-sentinel', '(시너지 레지스트리 대상)', NULL, ''
WHERE NOT EXISTS (SELECT 1 FROM md_company WHERE id = 'md-synergy-registry-sentinel');
