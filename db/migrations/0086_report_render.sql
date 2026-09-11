-- 0086: report_render — rendered document files per report snapshot
-- (ADR-0116 Phase 6 / approved mockup 2026-09-11-reports-composer). The
-- renderer already writes files under render_out/<project>/<snapshot>/, but
-- nothing persisted WHERE — the download route reads this table, never raw
-- request paths. Append-only; a re-render of the same format supersedes by
-- inserting a new snapshot version, so UNIQUE (snapshot_id, format) holds.
-- @reversible: true (additive table)
CREATE TABLE report_render (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES report_snapshot(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('docx', 'pdf', 'hwpx')),
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (snapshot_id, format)
);
CREATE INDEX idx_report_render_snapshot ON report_render(snapshot_id);
