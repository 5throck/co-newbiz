-- @reversible: true (purely additive — one nullable column, no rows touched.
-- Manual rollback: ALTER TABLE gate_decision DROP COLUMN learning_capture
-- (SQLite >=3.35), or restore from a pre-migration backup — ADR-0014.)
--
-- ADR-0152 §3 — every gate KILL carries learning capture. The routes require
-- it for decision='kill' (422). NO backfill: kills recorded before this
-- migration (2026-10-08) keep NULL and are grandfathered (ADR-0151 precedent).
ALTER TABLE gate_decision ADD COLUMN learning_capture TEXT;
