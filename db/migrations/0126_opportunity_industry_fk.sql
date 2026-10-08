-- @reversible: true (ADD COLUMN + new report table + 2 triggers — rollback is
-- pre-migration backup restore, scripts/co-newbiz/restore.ts; ADR-0014.
-- Manual: DROP TRIGGER trg_opportunity_industry_*; DROP TABLE
-- opportunity_industry_backfill_report; ALTER TABLE opportunity DROP COLUMN
-- industry_id.)
--
-- Wave F-6 (design 2026-10-08-wave-f-process-closure §6): the S1 predicate
-- joined opportunity.market_scope to md_industry.name_ko by STRING. This adds
-- the real foreign key. Backfill is EXACT match only and only when exactly one
-- industry carries that name; every opportunity with a market_scope that could
-- not be mapped is LISTED in opportunity_industry_backfill_report for human
-- mapping — never guessed.
--
-- The two triggers keep the FK derived for writers that still set only
-- market_scope (three API routes + scripts): same exact-unique-match rule, and
-- an explicit industry_id write is never overwritten (the UPDATE trigger fires
-- only when market_scope changes and re-derives, resetting to NULL when the
-- new name matches nothing so a stale FK cannot outlive its scope).

ALTER TABLE opportunity ADD COLUMN industry_id TEXT REFERENCES md_industry(id);

CREATE TABLE opportunity_industry_backfill_report (
  opportunity_id TEXT PRIMARY KEY NOT NULL,
  market_scope TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('no_match', 'ambiguous')),
  candidate_count INTEGER NOT NULL,
  reported_at TEXT NOT NULL
);

-- @backfill-begin
UPDATE opportunity SET industry_id = (
  SELECT i.id FROM md_industry i WHERE i.name_ko = opportunity.market_scope
)
WHERE industry_id IS NULL
  AND market_scope IS NOT NULL
  AND (SELECT COUNT(*) FROM md_industry i WHERE i.name_ko = opportunity.market_scope) = 1;

INSERT OR REPLACE INTO opportunity_industry_backfill_report (opportunity_id, market_scope, reason, candidate_count, reported_at)
SELECT o.id, o.market_scope,
       CASE WHEN (SELECT COUNT(*) FROM md_industry i WHERE i.name_ko = o.market_scope) = 0 THEN 'no_match' ELSE 'ambiguous' END,
       (SELECT COUNT(*) FROM md_industry i WHERE i.name_ko = o.market_scope),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM opportunity o
WHERE o.industry_id IS NULL AND o.market_scope IS NOT NULL AND TRIM(o.market_scope) != '';
-- @backfill-end

CREATE TRIGGER trg_opportunity_industry_ins AFTER INSERT ON opportunity
WHEN NEW.industry_id IS NULL AND NEW.market_scope IS NOT NULL
 AND (SELECT COUNT(*) FROM md_industry i WHERE i.name_ko = NEW.market_scope) = 1
BEGIN
  UPDATE opportunity SET industry_id = (SELECT i.id FROM md_industry i WHERE i.name_ko = NEW.market_scope)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_opportunity_industry_upd AFTER UPDATE OF market_scope ON opportunity
WHEN NEW.market_scope IS NOT OLD.market_scope AND NEW.industry_id IS OLD.industry_id
BEGIN
  UPDATE opportunity SET industry_id = CASE
    WHEN NEW.market_scope IS NOT NULL
     AND (SELECT COUNT(*) FROM md_industry i WHERE i.name_ko = NEW.market_scope) = 1
    THEN (SELECT i.id FROM md_industry i WHERE i.name_ko = NEW.market_scope)
    ELSE NULL END
  WHERE id = NEW.id;
END;
