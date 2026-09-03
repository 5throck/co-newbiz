-- @notransaction (PRAGMA foreign_keys cannot run inside a transaction, and the
-- process_run rebuild below rewrites a table that activity_run / agent_run /
-- agent_position / gate_evaluation reference by FK.)
-- @reversible: false in the general case (row-preserving table rebuild — all
-- rows are reproduced verbatim; the shape widens, so a manual rollback means
-- rebuilding with the 0045 body, which would drop any opportunity-scoped run
-- recorded since. ADR-0014 discipline; pre-migration backup is the recovery
-- path — scripts/co-newbiz/restore.ts.)
--
-- Orchestration engine generalization, step 1/3 (ADR-0096):
-- process_run addressing generalizes from project_id TEXT NOT NULL REFERENCES
-- md_project(id) to entity_type TEXT NOT NULL CHECK (entity_type IN
-- ('opportunity','project')) + entity_id TEXT NOT NULL. Steering-committee
-- runs happen on the opportunity (pre-promotion S4/S6–S7, ADR-0094); S8/S9
-- runs happen on the project (ADR-0095) — one table must carry both.
--
-- project_id is KEPT as a nullable compatibility column: project-entity runs
-- keep it populated so existing project-keyed queries and the 0045 index
-- semantics survive unchanged; opportunity-scoped runs leave it NULL by
-- design. All pre-0064 rows migrate as entity_type='project',
-- entity_id = project_id, project_id preserved. SQLite cannot ALTER a CHECK or
-- a NOT NULL, so the table is rebuilt in place (0033/0062 precedent).

PRAGMA foreign_keys = OFF;

CREATE TABLE process_run_rebuilt (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity', 'project')),
  entity_id TEXT NOT NULL,
  project_id TEXT REFERENCES md_project(id),
  spec_version TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'claude-desktop', 'cli', 'system', 'agent', 'human')),
  started_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
INSERT INTO process_run_rebuilt (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at)
  SELECT id, 'project', project_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at FROM process_run;
DROP TABLE process_run;
ALTER TABLE process_run_rebuilt RENAME TO process_run;
CREATE INDEX IF NOT EXISTS idx_process_run_project ON process_run(project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_process_run_entity ON process_run(entity_type, entity_id, started_at);

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
