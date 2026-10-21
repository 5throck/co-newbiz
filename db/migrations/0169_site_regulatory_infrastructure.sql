-- 0169_site_regulatory_infrastructure.sql (2026-10-21, decider: 부지 주소로
-- 건축법·인허가 법규 검토와 상하수도·전기·도로·물류·학교 등 인프라·인력 평가).
-- Person-verified fields on the site candidate: the address grounds the
-- k-law-based regulatory DRAFT (draft only — never stored as fact), and the
-- infrastructure/labor notes hold what a person verified on site. Scores stay
-- person-entered (ADR-0112: values are recorded, never invented).
ALTER TABLE site ADD COLUMN address TEXT;
ALTER TABLE site ADD COLUMN infra_notes TEXT;
ALTER TABLE site ADD COLUMN labor_notes TEXT;
