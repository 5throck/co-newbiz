-- @reversible: true (additive index only — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- Index for the admin audit-log viewer's unfiltered read path
-- (GET /api/admin/audit-log — ORDER BY created_at DESC, id DESC with no
-- actor filter). idx_audit_log_actor (0002) only helps the actor-scoped
-- query; this covers the plain chronological scan query-performance-tuning
-- flags as a high-traffic pattern once the audit log grows.

CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC, id DESC);
