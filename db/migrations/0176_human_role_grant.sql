-- @reversible: true (additive: one new table with two indexes plus two nullable columns on
-- approval_chain; no existing column or row changes. Manual rollback: the statements in
-- ROLLBACK-SQL below (ALTER TABLE ... DROP COLUMN needs SQLite 3.35+; otherwise restore the
-- pre-migration backup, scripts/co-newbiz/restore.ts, ADR-0014). Code rollback: revert the PR
-- or set the CO_NEWBIZ_GATE_INTEGRITY_<FAMILY> flags to off. ADR-0186 D6 / design 3.6, 3.14.)
-- ROLLBACK-SQL-BEGIN
--   DROP INDEX uq_app_user_human_role_active;
--   DROP INDEX idx_app_user_human_role_user;
--   DROP TABLE app_user_human_role;
--   ALTER TABLE approval_chain DROP COLUMN decided_by;
--   ALTER TABLE approval_chain DROP COLUMN recorded_by;
-- ROLLBACK-SQL-END
--
-- ADR-0186 (gate integrity, wave W2, phase P1). Human-role grants: the table that maps an
-- authenticated user to a human role key from procedures/_human-roles.yaml (entity-ic-reviewer,
-- group-ic-reviewer). Deny-by-default under ADR-0038: no row, or a revoked row, means no authority
-- on the routes that check it (waiver approval, na confirmation, later countersign and override);
-- the table has no effect on any other route. A grant is exercised by a cookie session only, never a
-- bearer token or an MCP call, and agents hold none (boundary 1). Rows are never deleted: a
-- revocation sets revoked_at/revoked_by so the who-when history stays. At most one ACTIVE grant per
-- (user, role) via the partial unique index. Issuance is admin-only and audited (grant.issue,
-- grant.revoke); a user cannot grant themselves a role (enforced in the repository, db/lib/human-roles.ts).
CREATE TABLE IF NOT EXISTS app_user_human_role (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_user(user_id),
  role_key TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_user_human_role_user ON app_user_human_role(user_id, revoked_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_human_role_active ON app_user_human_role(user_id, role_key) WHERE revoked_at IS NULL;

-- Maker/checker attribution on the existing two-tier approval chain (ADR-0028/0029): who recorded the
-- IC decision the chain row belongs to, and who decided (countersigned) it. Nullable: rows created
-- before this migration (the table is empty in production) carry no attribution.
ALTER TABLE approval_chain ADD COLUMN recorded_by TEXT;
ALTER TABLE approval_chain ADD COLUMN decided_by TEXT;
