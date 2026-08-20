-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- Project membership and information-protection core — docs/db-schema.md §9.
-- Non-descopable MVP items (ADR-0038/0039/0040/0012). Deny-by-default:
-- a row here is what grants visibility, not a role alone (FR-SEC-01/02).

CREATE TABLE project_member (
  project_id TEXT NOT NULL REFERENCES md_project(id),
  user_id TEXT NOT NULL,
  project_role TEXT NOT NULL CHECK (project_role IN ('lead', 'contributor', 'reviewer', 'observer')),
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  need_to_know_basis TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_member_user ON project_member(user_id, project_id);

CREATE TABLE project_classification (
  project_id TEXT PRIMARY KEY REFERENCES md_project(id),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('public', 'internal', 'confidential', 'restricted')),
  mnpi_flag INTEGER NOT NULL DEFAULT 0 CHECK (mnpi_flag IN (0, 1)),
  wall_group TEXT,
  classified_by TEXT NOT NULL,
  classified_at TEXT NOT NULL
);

CREATE TABLE insider_list (
  project_id TEXT NOT NULL REFERENCES md_project(id),
  user_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  removed_at TEXT,
  reason TEXT NOT NULL,
  acknowledged_at TEXT,
  PRIMARY KEY (project_id, user_id)
);

-- Read access to sensitive tables is logged too, not just writes (FR-SEC-06).
CREATE TABLE data_access_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  table_key TEXT NOT NULL,
  record_ref TEXT NOT NULL,
  project_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('read', 'write')),
  at TEXT NOT NULL,
  ip TEXT
);
CREATE INDEX idx_data_access_log_user ON data_access_log(user_id, at DESC);

-- Append-only by convention here; the actual DELETE-privilege revocation is
-- enforced at the DB-role level in Stage 5's deployment config, not by this
-- migration alone (FR-SEC-07 — see docs/security-model.md §7 item 7).
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_user_id, created_at DESC);
