-- 0147_s5_plan_pin.sql
-- @reversible: true (purely additive - one new table, one partial unique index, one lookup index
-- and two guard triggers; no existing column or row changes, and nothing reads the table until a
-- person sets bc.s5_source = 1 on a project, so every project keeps today's copy path. Manual
-- rollback: the statements in ROLLBACK-SQL below; the table is dropped with its rows, so take a
-- backup first if the stored pins must be kept (pre-migration backup restore of record,
-- scripts/co-newbiz/restore.ts, ADR-0014). Code rollback: revert the PR. ADR-0178 slice 0.)
-- ROLLBACK-SQL-BEGIN
--   DROP TRIGGER trg_s5_plan_pin_no_delete;
--   DROP TRIGGER trg_s5_plan_pin_immutable;
--   DROP INDEX idx_s5_plan_pin_project;
--   DROP INDEX idx_s5_plan_pin_current;
--   DROP TABLE s5_plan_pin;
-- ROLLBACK-SQL-END
--
-- ADR-0178 slice 0 - S5-S8 linkage option B (S5 single source, S8 pinned reference). One row is
-- one pinned version of a Green Field project's S5 investment plan. The table is APPEND-ONLY: a
-- re-pin supersedes the current row (superseded_at / superseded_by) and inserts a new one in the
-- same transaction; rows are never deleted and nothing but the supersede marker is ever updated
-- (guard triggers below). Exactly one current row per project (partial unique index).
--   plan_hash            sha256 over the S5 input as loadInvestmentVectorsInput builds it (plus the
--                        derived plan-line structure) - one definition shared with the S5 simulation
--                        input hash; see lib/s5-plan-pin.ts.
--   input_snapshot_json  the pinned S5 input itself (OPEN-1): S5 keeps no line history, so S8 computes
--                        against this snapshot and the pinned version stays re-readable after S5 is
--                        edited. Never edited.
--   s5_sim_run_id        the confirmed S5 investment simulation run in force at pin time (nullable).
--   s5_sim_input_hash    that run's input_hash (nullable).
--   reason               'initial' (first pin: promotion or first person-made pin) | 'repin'.
-- Brown Field projects never get a row. A pin changes S8 computation only for projects where a
-- person set bc.s5_source = 1; it never alters an existing case, simulation or adopted result.

CREATE TABLE s5_plan_pin (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  plan_hash TEXT NOT NULL,
  s5_sim_run_id TEXT REFERENCES investment_simulation_run(id),
  s5_sim_input_hash TEXT,
  input_snapshot_json TEXT NOT NULL CHECK (json_valid(input_snapshot_json)),
  pinned_by TEXT NOT NULL,
  pinned_at TEXT NOT NULL,
  superseded_at TEXT,
  superseded_by TEXT REFERENCES s5_plan_pin(id) DEFERRABLE INITIALLY DEFERRED,
  reason TEXT NOT NULL CHECK (reason IN ('initial', 'repin')),
  audit_id TEXT,
  CHECK ((superseded_at IS NULL) = (superseded_by IS NULL))
);
CREATE UNIQUE INDEX idx_s5_plan_pin_current ON s5_plan_pin(project_id) WHERE superseded_at IS NULL;
CREATE INDEX idx_s5_plan_pin_project ON s5_plan_pin(project_id, pinned_at DESC);

CREATE TRIGGER trg_s5_plan_pin_no_delete
BEFORE DELETE ON s5_plan_pin
BEGIN
  SELECT RAISE(ABORT, 's5_plan_pin is append-only');
END;

CREATE TRIGGER trg_s5_plan_pin_immutable
BEFORE UPDATE ON s5_plan_pin
WHEN OLD.superseded_at IS NOT NULL
  OR NEW.id IS NOT OLD.id
  OR NEW.project_id IS NOT OLD.project_id
  OR NEW.opportunity_id IS NOT OLD.opportunity_id
  OR NEW.plan_hash IS NOT OLD.plan_hash
  OR NEW.s5_sim_run_id IS NOT OLD.s5_sim_run_id
  OR NEW.s5_sim_input_hash IS NOT OLD.s5_sim_input_hash
  OR NEW.input_snapshot_json IS NOT OLD.input_snapshot_json
  OR NEW.pinned_by IS NOT OLD.pinned_by
  OR NEW.pinned_at IS NOT OLD.pinned_at
  OR NEW.reason IS NOT OLD.reason
BEGIN
  SELECT RAISE(ABORT, 's5_plan_pin rows are immutable except the supersede marker');
END;
