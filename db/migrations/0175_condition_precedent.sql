-- @reversible: true (additive: one new table with its indexes and guard triggers plus the legacy-cutoff table and two nullable
-- columns on approval_chain; no existing column or row changes. Manual rollback: the statements in
-- ROLLBACK-SQL below (ALTER TABLE ... DROP COLUMN needs SQLite 3.35+; otherwise restore the
-- pre-migration backup, scripts/co-newbiz/restore.ts, ADR-0014). Code rollback: revert the PR or set
-- CO_NEWBIZ_GATE_INTEGRITY_VALIDATORS / _MAKER_CHECKER to off. ADR-0186 D4 / D6, design 3.4, 3.6.)
-- ROLLBACK-SQL-BEGIN
--   DROP TRIGGER trg_gate_decision_no_explicit_legacy_rowid;
--   DROP TRIGGER trg_gate_decision_no_delete;
--   DROP TRIGGER trg_gate_integrity_cutoff_no_delete;
--   DROP TRIGGER trg_gate_integrity_cutoff_no_update;
--   DROP TABLE gate_integrity_cutoff;
--   DROP TRIGGER trg_condition_precedent_open_columns;
--   DROP TRIGGER trg_condition_precedent_closed_immutable;
--   DROP TRIGGER trg_condition_precedent_no_delete;
--   DROP INDEX idx_condition_precedent_source;
--   DROP INDEX idx_condition_precedent_project;
--   DROP TABLE condition_precedent;
--   ALTER TABLE approval_chain DROP COLUMN decision_reason;
--   ALTER TABLE approval_chain DROP COLUMN gate_decision_id;
-- ROLLBACK-SQL-END
--
-- ADR-0186 (gate integrity, wave W2, phase P3). A condition precedent becomes a tracked object instead
-- of free text inside a rationale: it is created with an IC GO (entity_ic / group_ic), carries where it
-- must be cleared (group_ic = before the group sitting, establishment / closing = before S11 closes),
-- and is cleared by a different person holding an IC reviewer grant. Open establishment / closing
-- conditions keep S11 incomplete; open group_ic conditions block the group_ic GO. Rows are never
-- deleted; a cleared or withdrawn row is immutable (the history of who cleared what stays).
CREATE TABLE condition_precedent (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  source_decision_id TEXT NOT NULL REFERENCES gate_decision(id),
  gate TEXT NOT NULL CHECK (gate IN ('entity_ic', 'group_ic')),
  text TEXT NOT NULL,
  clear_by TEXT NOT NULL CHECK (clear_by IN ('group_ic', 'establishment', 'closing')),
  owner_role TEXT,
  origin TEXT NOT NULL DEFAULT 'recorder' CHECK (origin IN ('recorder', 'countersign', 'kill_conditional')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cleared', 'withdrawn')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cleared_by TEXT,
  cleared_at TEXT,
  clear_note TEXT,
  evidence_ref TEXT
);
CREATE INDEX idx_condition_precedent_project ON condition_precedent(project_id, status);
CREATE INDEX idx_condition_precedent_source ON condition_precedent(source_decision_id);
CREATE TRIGGER trg_condition_precedent_no_delete BEFORE DELETE ON condition_precedent
BEGIN
  SELECT RAISE(ABORT, 'condition_precedent rows are never deleted (ADR-0186): clear or withdraw instead');
END;
CREATE TRIGGER trg_condition_precedent_closed_immutable BEFORE UPDATE ON condition_precedent
WHEN OLD.status != 'open'
BEGIN
  SELECT RAISE(ABORT, 'a cleared or withdrawn condition_precedent is immutable (ADR-0186)');
END;

-- Only the close columns of an OPEN condition may change (J8): everything else is fixed at creation.
CREATE TRIGGER trg_condition_precedent_open_columns BEFORE UPDATE ON condition_precedent
WHEN OLD.status = 'open' AND (
  NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.source_decision_id IS NOT OLD.source_decision_id
  OR NEW.gate IS NOT OLD.gate OR NEW.text IS NOT OLD.text OR NEW.clear_by IS NOT OLD.clear_by OR NEW.owner_role IS NOT OLD.owner_role
  OR NEW.origin IS NOT OLD.origin OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at)
BEGIN
  SELECT RAISE(ABORT, 'an open condition_precedent may change only its status and close columns (ADR-0186)');
END;

-- Legacy cutoff (security review B1): a gate decision is "legacy" (effective as recorded, never countersigned) ONLY when its
-- rowid is at or below this persisted mark, taken when the maker/checker contract was installed. It is never inferred from a
-- missing snapshot row (a snapshot-build fault in shadow mode would otherwise forge a legacy, instantly effective IC GO).
CREATE TABLE gate_integrity_cutoff (
  name TEXT PRIMARY KEY NOT NULL,
  max_decision_rowid INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO gate_integrity_cutoff (name, max_decision_rowid, created_at)
  VALUES ('maker_checker', (SELECT COALESCE(MAX(rowid), 0) FROM gate_decision), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
CREATE TRIGGER trg_gate_integrity_cutoff_no_update BEFORE UPDATE ON gate_integrity_cutoff
BEGIN
  SELECT RAISE(ABORT, 'gate_integrity_cutoff is fixed once written (ADR-0186)');
END;
CREATE TRIGGER trg_gate_integrity_cutoff_no_delete BEFORE DELETE ON gate_integrity_cutoff
BEGIN
  SELECT RAISE(ABORT, 'gate_integrity_cutoff is fixed once written (ADR-0186)');
END;

-- Hardening (security review H1): the cutoff only means something while gate_decision rowids are immutable evidence. Rows are
-- never deleted, and an INSERT may not claim a rowid at or below the cutoff (an explicit rowid would forge a legacy decision).
-- NEW.rowid is only meaningful when the INSERT names one explicitly; an auto-assigned rowid reads as NULL / non-positive here.
CREATE TRIGGER trg_gate_decision_no_delete BEFORE DELETE ON gate_decision
BEGIN
  SELECT RAISE(ABORT, 'gate_decision rows are never deleted (ADR-0186)');
END;
CREATE TRIGGER trg_gate_decision_no_explicit_legacy_rowid BEFORE INSERT ON gate_decision
WHEN NEW.rowid > 0 AND NEW.rowid <= (SELECT max_decision_rowid FROM gate_integrity_cutoff WHERE name = 'maker_checker')
BEGIN
  SELECT RAISE(ABORT, 'a new gate_decision cannot take a rowid at or below the maker/checker legacy cutoff (ADR-0186)');
END;

-- Maker/checker: which IC gate decision the chain row's current decision countersigns. A later IC GO
-- (a re-decision) differs from this id, so it is un-countersigned until a checker decides it again.
ALTER TABLE approval_chain ADD COLUMN gate_decision_id TEXT;
-- The checker's stated reason (ack substance profile) for the countersign decision.
ALTER TABLE approval_chain ADD COLUMN decision_reason TEXT;
