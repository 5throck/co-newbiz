-- 0133_business_case_archive.sql
-- @reversible: true (purely additive — two nullable columns, no existing rows
-- or tables touched. Manual rollback: ALTER TABLE business_case_model DROP
-- COLUMN archived_by; ... DROP COLUMN archived_at (SQLite >=3.35), or restore
-- from a pre-migration backup — scripts/co-newbiz/restore.ts.)
--
-- Legacy business-case cleanup (ADR-0158, design
-- 2026-10-09-legacy-model-cleanup). A pre-ADR-0143 model (target_id NULL on a
-- brownfield project) that a human adoption (process_run s8_case_adopt) or
-- other decision evidence still references must not be deleted — it is
-- ARCHIVED instead. NULL archived_at = active (every existing row is
-- grandfathered). Archived rows are excluded from the S8 list, the target
-- comparison and the completion/RAG predicates, but still resolve by id for
-- the adoption and IC-package history views.

ALTER TABLE business_case_model ADD COLUMN archived_at TEXT;
ALTER TABLE business_case_model ADD COLUMN archived_by TEXT;
