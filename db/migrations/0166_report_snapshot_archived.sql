-- 0166_report_snapshot_archived.sql (2026-10-21, decider: 보고서 삭제 필요).
-- report_snapshot is an append-only immutable history (ADR-0116 Phase 6), but a
-- mistyped or abandoned draft stayed in the history forever. Soft delete keeps
-- that doctrine: archived_at hides the row from the default history list while
-- the row and its render files remain auditable (?archived=1 surfaces them).
ALTER TABLE report_snapshot ADD COLUMN archived_at TEXT;
