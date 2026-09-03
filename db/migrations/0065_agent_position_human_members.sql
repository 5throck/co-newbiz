-- 0065_agent_position_human_members.sql
-- @reversible: true (row-preserving table rebuild — all columns and rows are
-- reproduced verbatim; only the member columns widen. Manual rollback: rebuild
-- with the 0045 body (drops member_type/human_user_id), or restore from a
-- pre-migration backup — scripts/co-newbiz/restore.ts.)
--
-- Orchestration engine generalization, step 2/3 (ADR-0096): a committee seat
-- may now be held by a human role (the procedures/_human-roles.yaml registry
-- keys) as well as an agent, so agent_position gains:
--   member_type   TEXT NOT NULL DEFAULT 'agent' CHECK (member_type IN ('human','agent'))
--   human_user_id TEXT REFERENCES app_user(user_id)
-- and agent_key relaxes to nullable.
--
-- The exactly-one-of invariant — precisely one of agent_key | human_user_id
-- non-null — is enforced at the APPLICATION layer (the orchestrator insert
-- path), not by a CHECK: a cross-column CHECK would force another table
-- rebuild per tweak of the member model, and the invariant is one line of
-- insert-path validation. Deliberate trade recorded in ADR-0096 §2 so it is
-- not re-litigated.
--
-- No FK children reference agent_position, so the rebuild runs inside the
-- normal transaction wrapper (unlike 0064).

CREATE TABLE agent_position_rebuilt (
  id TEXT PRIMARY KEY NOT NULL,
  process_run_id TEXT NOT NULL REFERENCES process_run(id),
  member_type TEXT NOT NULL DEFAULT 'agent' CHECK (member_type IN ('human', 'agent')),
  agent_key TEXT,
  human_user_id TEXT REFERENCES app_user(user_id),
  position_md TEXT NOT NULL,
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  round INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
INSERT INTO agent_position_rebuilt (id, process_run_id, member_type, agent_key, human_user_id, position_md, confidence, round, created_at)
  SELECT id, process_run_id, 'agent', agent_key, NULL, position_md, confidence, round, created_at FROM agent_position;
DROP TABLE agent_position;
ALTER TABLE agent_position_rebuilt RENAME TO agent_position;
CREATE INDEX IF NOT EXISTS idx_agent_position_run ON agent_position(process_run_id, round);
