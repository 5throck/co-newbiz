-- @reversible: true (additive only — ADD COLUMN x5 on api_token plus two new
-- tables; rollback is pre-migration backup restore, scripts/co-newbiz/restore.ts,
-- ADR-0014. SQLite >= 3.35 can also DROP COLUMN each added column and DROP the
-- two new tables.)
--
-- Wave M PR M-1 (ADR-0154, design 2026-10-08-wave-m-mcp-parity §4.3): the
-- in-app OAuth 2.1 authorization server for the remote MCP endpoint.
--
-- api_token gains the OAuth token kinds. Existing rows become kind='personal'
-- and keep their explicit scopes, so stdio personal tokens are unaffected.
-- OAuth access tokens are audience-bound (RFC 8707) to the /api/mcp resource
-- and are rejected by the general REST API (db/lib/api-tokens.ts filters on
-- kind='personal'). Only SHA-256 hashes are stored, as before (FR-SEC-09).
-- `revoked_at` already exists; a rotated refresh token is revoked, so a replay
-- of it is detected as reuse and revokes the whole `family_id`.

ALTER TABLE api_token ADD COLUMN kind TEXT NOT NULL DEFAULT 'personal'
  CHECK (kind IN ('personal', 'oauth_access', 'oauth_refresh'));
ALTER TABLE api_token ADD COLUMN client_id TEXT;
ALTER TABLE api_token ADD COLUMN family_id TEXT;
ALTER TABLE api_token ADD COLUMN audience TEXT;
ALTER TABLE api_token ADD COLUMN expires_at TEXT;
CREATE INDEX idx_api_token_family ON api_token(family_id);
CREATE INDEX idx_api_token_user_client ON api_token(user_id, client_id);

-- RFC 7591 dynamically registered public clients (token_endpoint_auth_method
-- 'none'; PKCE is the only proof). `verified` starts at 0 and the consent page
-- shows an unverified badge until an admin pins the client.
CREATE TABLE oauth_client (
  client_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  registered_by_user_id TEXT REFERENCES app_user(user_id),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  created_at TEXT NOT NULL
);

-- Single-use authorization codes (<= 60s). `family_id` is stamped when the
-- code is redeemed so a replayed code can revoke the tokens it produced
-- (OAuth 2.1 §4.1.3).
CREATE TABLE oauth_code (
  code_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_user(user_id),
  client_id TEXT NOT NULL REFERENCES oauth_client(client_id),
  redirect_uri TEXT NOT NULL,
  pkce_challenge TEXT NOT NULL,
  scopes TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  family_id TEXT,
  created_at TEXT NOT NULL
);
