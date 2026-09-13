-- @reversible: true (additive-only — one new column, default 0, no data
-- rewritten; manual rollback: `ALTER TABLE md_industry DROP COLUMN pinned;`
-- — SQLite supports DROP COLUMN natively since 3.35, or restore from
-- pre-migration backup, ADR-0014.)
-- S1 industry list — explicit curation. As linked-industry auto-registration
-- (전방/전전방/후방/후후방, ADR-0129/0130) grows the list, users need to mark
-- which industries are their actual focus and default the list view to just
-- those, without losing the rest (still reachable via an "전체 보기" toggle).
ALTER TABLE md_industry ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));
