-- @reversible: true (additive-in-effect: relaxes a CHECK constraint; no row meaning changes — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- @notransaction
-- ADR-0126 — proxy_link에 hop_type 'structural' 추가. S1 시장분석(시장 구조
-- 정의 단계)이 LLM으로 도출한 인접 산업 링크를 사람이 승인해 등록할 때 쓴다.
-- 구조 링크는 변환 계수가 없다(coefficient/beta/r2 NULL) — 통계 보정 없이
-- 가치사슬 연계의 위상(topology)만 기록하며, convertViaProxyChain이 이런 hop을
-- 포함한 체인을 변환하려 하면 계수 부족으로 실패한다(의도된 가드 — 없는
-- 데이터를 있는 것처럼 변환하지 않는다). SQLite는 CHECK 제약을 in-place로
-- 바꿀 수 없으므로 테이블 리빌드가 필요하다(FK 하위 행 없음 — 안전).
PRAGMA foreign_keys = OFF;

CREATE TABLE proxy_link_new (
  id TEXT PRIMARY KEY NOT NULL,
  from_industry_id TEXT NOT NULL REFERENCES md_industry(id),
  to_industry_id TEXT NOT NULL REFERENCES md_industry(id),
  hop_type TEXT NOT NULL CHECK (hop_type IN ('engineering', 'statistical', 'structural')),
  -- Engineering hops: coefficient is a fixed physical constant, beta/r2/lag
  -- are NULL (no regression was run). Statistical hops: beta/r2/lag/ci
  -- populated from python/correlation.py's output. Structural hops: no
  -- conversion factor at all — human-approved S1 topology links only.
  coefficient REAL,
  beta REAL,
  r2 REAL,
  lag_months INTEGER,
  ci_low REAL,
  ci_high REAL,
  evidence_ref TEXT NOT NULL,
  calibrated_at TEXT,
  CHECK (
    (hop_type = 'engineering' AND coefficient IS NOT NULL AND beta IS NULL)
    OR
    (hop_type = 'statistical' AND beta IS NOT NULL AND r2 IS NOT NULL)
    OR
    (hop_type = 'structural' AND coefficient IS NULL AND beta IS NULL AND r2 IS NULL)
  )
);

INSERT INTO proxy_link_new SELECT * FROM proxy_link;
DROP TABLE proxy_link;
ALTER TABLE proxy_link_new RENAME TO proxy_link;
CREATE INDEX idx_proxy_link_chain ON proxy_link(from_industry_id, to_industry_id);

PRAGMA foreign_keys = ON;
