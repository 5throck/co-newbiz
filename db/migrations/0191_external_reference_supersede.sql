-- 0191_external_reference_supersede.sql
-- @reversible: true (purely additive — two nullable columns on
-- market_external_reference, no existing rows touched. Manual rollback:
-- ALTER TABLE market_external_reference DROP COLUMN superseded_by;
-- ALTER TABLE market_external_reference DROP COLUMN superseded_at;)
--
-- External reference supersede (design
-- 2026-09-18-s1-growth-gap-calibration, amendment 2026-11-12c): a person
-- retires a recorded external reference without rewriting history.
-- superseded_at marks the retirement moment; superseded_by names the
-- successor row (NULL for a plain supersede — no successor recorded). The
-- row itself is never deleted — append-only preservation: completed
-- analyses keep the reference they were run with, and only the NEXT
-- re-analysis baseline changes (resolveExternalReference filters superseded
-- rows out, so the web-search / LLM-prior fallback ladder resumes).

ALTER TABLE market_external_reference ADD COLUMN superseded_at TEXT;
ALTER TABLE market_external_reference ADD COLUMN superseded_by TEXT REFERENCES market_external_reference(id);
