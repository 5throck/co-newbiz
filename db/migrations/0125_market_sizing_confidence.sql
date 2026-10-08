-- @reversible: true (additive ADD COLUMN x3 — rollback is pre-migration backup
-- restore, scripts/co-newbiz/restore.ts; ADR-0014. SQLite >= 3.35 can also
-- ALTER TABLE ... DROP COLUMN each added column.)
--
-- Wave F-5 (design 2026-10-08-wave-f-process-closure §5): S1 market sizing
-- persists a data-confidence grade so the RAG data_confidence dimension (and
-- through it the structural overall cap, ADR-0016 / boundary #4) has a stored
-- input instead of an empty table. The grade is derived deterministically from
-- the proxy-chain hop count and the data source (db/lib/data-confidence.ts —
-- THE TS twin of the backfill below; tests/unit/wave-f5-rag.test.ts asserts
-- parity):
--
--   hops      = proxy_link rows incident to the analysed industry whose
--               hop_type is engineering|statistical (structural hops carry no
--               conversion factor and are topology only — ADR-0126).
--   hop grade = A  no statistical hop (direct data or engineering-only)
--               B  exactly one statistical hop with r2 >= 0.6
--               C  more than one statistical hop, or any with r2 < 0.6
--               (same bands as db/lib/chain-grading.ts, D-M4-1)
--   source cap= A  provenance 'frozen-research'
--               B  anything else (llm-estimate / unknown) — the existing
--                  ragCapRecommendation "unverified LLM estimate caps at
--                  Amber" principle
--   grade     = the WORSE of hop grade and source cap.
--
-- Backfill: existing versions get the grade derived from the CURRENT chain
-- state (no historical chain snapshot exists). The S1 completion predicate
-- stays grandfathered for pre-Wave-F opportunities (lib/process-flow.ts).

ALTER TABLE market_sizing_version ADD COLUMN data_confidence_grade TEXT
  CHECK (data_confidence_grade IS NULL OR data_confidence_grade IN ('A', 'B', 'C'));
ALTER TABLE market_sizing_version ADD COLUMN chain_hops INTEGER;
ALTER TABLE market_sizing_version ADD COLUMN confidence_basis TEXT;

UPDATE market_sizing_version SET
  chain_hops = (
    SELECT COUNT(*) FROM proxy_link p, market_sizing_analysis a
    WHERE a.id = market_sizing_version.analysis_id
      AND (p.from_industry_id = a.industry_id OR p.to_industry_id = a.industry_id)
      AND p.hop_type IN ('engineering', 'statistical')
  ),
  data_confidence_grade = MAX(
    (SELECT CASE
        WHEN SUM(p.hop_type = 'statistical') IS NULL OR SUM(p.hop_type = 'statistical') = 0 THEN 'A'
        WHEN SUM(p.hop_type = 'statistical') = 1 AND MIN(CASE WHEN p.hop_type = 'statistical' THEN p.r2 END) >= 0.6 THEN 'B'
        ELSE 'C'
      END
     FROM proxy_link p, market_sizing_analysis a
     WHERE a.id = market_sizing_version.analysis_id
       AND (p.from_industry_id = a.industry_id OR p.to_industry_id = a.industry_id)
       AND p.hop_type IN ('engineering', 'statistical')),
    CASE WHEN COALESCE(CASE WHEN json_valid(payload) THEN json_extract(payload, '$.matrix.provenance') END, 'llm-estimate') = 'frozen-research'
         THEN 'A' ELSE 'B' END
  ),
  confidence_basis = 'backfill-0125: grade derived from current proxy chain + payload provenance';
