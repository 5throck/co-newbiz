-- @notransaction (PRAGMA foreign_keys cannot change inside a transaction, and market_sizing_version is rebuilt below to
-- widen its CHECK: four tables reference it by FK.)
-- @reversible: true (the rebuild is row-preserving 1:1; no grade value changes. Manual rollback: the statements in
-- ROLLBACK-SQL below, after a backup per ADR-0014; the rollback first fails loudly if any row already holds grade 'U'
-- (re-grade or delete those versions first). Or restore the pre-migration backup, scripts/co-newbiz/restore.ts.)
-- ROLLBACK-SQL-BEGIN
--   PRAGMA foreign_keys = OFF;
--   DROP TABLE IF EXISTS msv_guard;
--   CREATE TABLE msv_guard (n INTEGER CHECK (n = 0));
--   INSERT INTO msv_guard SELECT COUNT(*) FROM market_sizing_version WHERE data_confidence_grade = 'U';
--   DROP TABLE msv_guard;
--   CREATE TABLE market_sizing_version_old (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES market_sizing_analysis(id), version_no INTEGER NOT NULL, payload TEXT NOT NULL, changelog TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, data_confidence_grade TEXT CHECK (data_confidence_grade IS NULL OR data_confidence_grade IN ('A', 'B', 'C')), chain_hops INTEGER, confidence_basis TEXT, UNIQUE (analysis_id, version_no));
--   INSERT INTO market_sizing_version_old SELECT id, analysis_id, version_no, payload, changelog, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis FROM market_sizing_version;
--   DROP TABLE market_sizing_version;
--   ALTER TABLE market_sizing_version_old RENAME TO market_sizing_version;
--   CREATE INDEX idx_msv_analysis ON market_sizing_version(analysis_id, version_no DESC);
--   UPDATE market_sizing_version SET confidence_basis = substr(confidence_basis, 17) WHERE confidence_basis LIKE 'legacy_default: %';
--   PRAGMA foreign_keys = ON;
--   PRAGMA foreign_key_check;
-- ROLLBACK-SQL-END
--
-- ADR-0187 D1 (owner, 2026-10-27; design 2026-10-27-process-ssot-decision-evidence 4.1, finding H7). The SQL twin of
-- packages/core-scoring/src/data-confidence.ts 1.1.0: a market-sizing version whose industry has NO proxy chain
-- recorded and whose source is not direct data (provenance other than 'frozen-research') is graded 'U' (unknown)
-- instead of a defaulted 'B'. U caps the overall RAG at Amber and can never be Green (rag-engine
-- dataConfidenceFromChain). The CHECK below widens to admit 'U'.
--
-- No retroactive re-grade (ADR-0151 stance, design 6/7: write-time only). Existing rows keep their stored grade. A row
-- that was graded by the old default (chain_hops = 0, grade 'B', so no hop existed and the B came from the source cap
-- alone) gets its confidence_basis prefixed 'legacy_default: ' so readers can tell a defaulted grade from a derived
-- one (only rows whose chain_hops is exactly 0 - a NULL chain_hops is not known to be zero-hop and is left alone; a
-- NULL basis is stored as '(no basis recorded)' behind the prefix). The rollback strips the prefix again. The rebuild
-- and the label run inside one explicit BEGIN IMMEDIATE ... COMMIT between the foreign_keys PRAGMAs, so a failure
-- between DROP and RENAME rolls back instead of losing the table; PRAGMA foreign_key_check runs after FKs are back on
-- (precedent 0061/0094). The next market-sizing run for that industry writes a new version with the derived grade (U where no chain is
-- recorded); RAG reads the latest version, so the change reaches a project only through a new run.

PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

CREATE TABLE market_sizing_version_new (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES market_sizing_analysis(id),
  version_no INTEGER NOT NULL,
  payload TEXT NOT NULL,
  changelog TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data_confidence_grade TEXT CHECK (data_confidence_grade IS NULL OR data_confidence_grade IN ('A', 'B', 'C', 'U')),
  chain_hops INTEGER,
  confidence_basis TEXT,
  UNIQUE (analysis_id, version_no)
);
INSERT INTO market_sizing_version_new (id, analysis_id, version_no, payload, changelog, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis)
  SELECT id, analysis_id, version_no, payload, changelog, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis
  FROM market_sizing_version;
DROP TABLE market_sizing_version;
ALTER TABLE market_sizing_version_new RENAME TO market_sizing_version;
CREATE INDEX idx_msv_analysis ON market_sizing_version(analysis_id, version_no DESC);

UPDATE market_sizing_version
  SET confidence_basis = 'legacy_default: ' || COALESCE(confidence_basis, '(no basis recorded)')
  WHERE data_confidence_grade = 'B' AND chain_hops = 0
    AND COALESCE(confidence_basis, '') NOT LIKE 'legacy_default:%';

COMMIT;

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
