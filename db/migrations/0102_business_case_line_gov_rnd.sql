-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- ADR-0138 — business_case_line.category에 'gov_rnd'(정부 R&D 지원금/보조금)
-- 추가. SQLite는 CHECK 제약을 직접 ALTER할 수 없어 0049 방식(테이블 재생성)을
-- 따른다. 정부 R&D는 핵심 상업 매출이 아니므로 마진 계산(business-targets.ts)
-- 에서는 capex와 동일하게 매출·영업비용 합산에서 제외한다(ADR-0114와 같은 논리).
CREATE TABLE business_case_line_new (
  id TEXT PRIMARY KEY NOT NULL,
  model_id TEXT NOT NULL REFERENCES business_case_model(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('labor', 'opex', 'capex', 'revenue', 'gov_rnd')),
  name TEXT NOT NULL,
  annual_amount_krw_m REAL NOT NULL,
  headcount INTEGER,
  start_year INTEGER NOT NULL DEFAULT 1,
  growth_rate REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO business_case_line_new SELECT id, model_id, category, name, annual_amount_krw_m, headcount, start_year, growth_rate, note, created_by, created_at FROM business_case_line;
DROP TABLE business_case_line;
ALTER TABLE business_case_line_new RENAME TO business_case_line;
CREATE INDEX idx_bc_line_model ON business_case_line(model_id, category);
