-- @reversible: true (additive only — one nullable column on oauth_client;
-- rollback is pre-migration backup restore, scripts/co-newbiz/restore.ts,
-- ADR-0014. SQLite >= 3.35 can also DROP COLUMN.)
--
-- Admin START/STOP for connected OAuth clients (design
-- 2026-11-27-admin-oauth-client-stop-start). NULL = operating,
-- non-NULL ISO timestamp = stopped by an admin. The actor is not
-- stored here — it lives in the append-only audit_log (FR-SEC-07)
-- as oauth_app_stop / oauth_app_start.
ALTER TABLE oauth_client ADD COLUMN stopped_at TEXT;
