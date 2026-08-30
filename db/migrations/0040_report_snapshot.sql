-- 0040_report_snapshot.sql
-- Report snapshots (조사결과 영속화). The `document` table is a registry
-- (id/run/version/hash, no content column) whose rows are produced by the
-- offline report pipeline; there was no way for a user to persist the
-- current state of a deal's analysis (runs, simulations, RAG, DD progress,
-- review status) as a point-in-time record viewable later. report_snapshot
-- stores that assembled markdown per project, with actor and timestamp.
CREATE TABLE report_snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_report_snapshot_project ON report_snapshot(project_id, created_at);
