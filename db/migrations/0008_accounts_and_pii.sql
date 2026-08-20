-- Accounts, sessions, and PII tables — Wave 5.5, docs/security-model.md.
-- Realizes FR-SEC-02/04/05/06/07/09 and design v1.0 §4-9/§4-9-1.
--
-- NOTE on user_id: project_member.user_id (migration 0002) deliberately has
-- no FK — it predates accounts. app_user.user_id below is the identity those
-- rows reference. Adding a retroactive FK would invalidate every existing
-- membership fixture, so the linkage stays by convention here and is
-- enforced at the engine layer (db/lib/access-control.ts checks the grantee
-- is an active app_user before granting).

CREATE TABLE app_user (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'analyst', 'viewer')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'locked', 'disabled')),
  -- FR-SEC-09: hash-only storage. The three columns below are exactly what
  -- scripts/lib/auth.ts produces; no column anywhere may hold plaintext.
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  -- FR-SEC-04: when this equals project_classification.wall_group, the user
  -- is walled off from that project even with a membership row (an
  -- information wall overrides membership — belt and suspenders).
  wall_group TEXT,
  created_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT
);
CREATE INDEX idx_app_user_status ON app_user(status, user_id);

CREATE TABLE password_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(user_id),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX idx_password_history_user ON password_history(user_id, changed_at DESC);

-- Server-side sessions: the cookie/token carries a random value; only its
-- SHA-256 is stored, so a DB dump cannot be replayed as a login (§4 TRIDE
-- "Spoofing — stolen session").
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(user_id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_session_user ON session(user_id, expires_at DESC);

-- ---------------------------------------------------------------------------
-- PII tables (FR-SEC-05, ADR-0039) — aggregate-first enforced by CHECK
-- constraints, not by convention. A violation is an INSERT failure, which is
-- the point of security-model §7 items 5 and 6.
--
-- comp_benchmark: job-family/grade aggregates ONLY. headcount >= 3 is a
-- k-anonymity floor (k=3 small-cell suppression — a standard statistical
-- disclosure control): a 1- or 2-person row re-identifies its members even
-- without a name column, so the schema refuses to store it.
CREATE TABLE comp_benchmark (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  job_family TEXT NOT NULL,
  grade TEXT NOT NULL,
  headcount INTEGER NOT NULL CHECK (headcount >= 3),
  target_median INTEGER NOT NULL,      -- integer minor units (KRW won), ADR-0002
  acquirer_median INTEGER NOT NULL,
  gap_pct REAL NOT NULL,
  annual_cost_delta INTEGER NOT NULL,
  evidence_ref TEXT
);
CREATE INDEX idx_comp_benchmark_project ON comp_benchmark(project_id, job_family);

-- management_package: executive_ref is a POSITION-BASED surrogate key
-- (e.g. 'TARGET-CEO-01'), never a real name. The CHECK enforces the format:
-- starts uppercase [A-Z], no lowercase and no spaces anywhere, ends in a
-- two-digit ordinal after a dash. Korean names fail the [A-Z] start; 'John
-- Smith' fails the no-space rule. The real name stays outside the system
-- (design §4-9-1(b) minimal collection).
CREATE TABLE management_package (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  executive_ref TEXT NOT NULL CHECK (
    executive_ref GLOB '[A-Z]*'
    AND executive_ref NOT GLOB '*[a-z ]*'
    AND executive_ref GLOB '*-[0-9][0-9]'
  ),
  role_title TEXT NOT NULL,
  base_pay INTEGER NOT NULL,           -- integer minor units (KRW won)
  coc_trigger INTEGER NOT NULL DEFAULT 0 CHECK (coc_trigger IN (0, 1)),
  coc_payout_estimate INTEGER,
  accelerated_vesting INTEGER NOT NULL DEFAULT 0 CHECK (accelerated_vesting IN (0, 1)),
  non_compete_months INTEGER,
  non_compete_enforceable INTEGER CHECK (non_compete_enforceable IN (0, 1)),
  retention_plan_cost INTEGER,
  flight_risk TEXT CHECK (flight_risk IN ('low', 'medium', 'high')),
  value_impact INTEGER,
  evidence_ref TEXT
);
CREATE INDEX idx_management_package_project ON management_package(project_id);

-- Pseudonymized projection for analytics (security-model §5): drops the two
-- payroll-level medians, keeps the gap and cost columns statistics need.
-- Analytics must read this view, not the base table.
CREATE VIEW v_comp_anonymized AS
SELECT id, project_id, job_family, grade, headcount, gap_pct, annual_cost_delta, evidence_ref
FROM comp_benchmark;

-- ---------------------------------------------------------------------------
-- FR-SEC-07 / ADR-0012: audit_log is append-only AT THE DATABASE LEVEL.
-- The migration comment in 0002 deferred DELETE-revocation to deployment
-- config; these triggers close the gap for every connection, including a
-- DB-owner running ad-hoc SQL. UPDATE is blocked equally — an audit row that
-- can be rewritten is as worthless as one that can be deleted.
CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only (FR-SEC-07, ADR-0012)');
END;

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only (FR-SEC-07, ADR-0012)');
END;
