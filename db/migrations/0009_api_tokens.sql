-- 0009_api_tokens.sql — Wave 5.6, api-spec.md §2 (Bearer API tokens).
--
-- Scoped API tokens for MCP/CLI clients (design §4-11: session cookie for the
-- web, Bearer token for MCP/CLI). Same storage rule as `session`: only the
-- SHA-256 of the random token is stored — a DB dump cannot be replayed as a
-- valid credential (FR-SEC-09).
--
-- `scopes` is a CSV of 'read'/'write' (validated in db/lib/api-tokens.ts —
-- SQLite CHECK cannot express set membership over a CSV portably). A
-- read-scoped token can never mutate: enforced in app/server/middleware.ts
-- before any handler runs.

CREATE TABLE api_token (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(user_id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_api_token_user ON api_token(user_id);
