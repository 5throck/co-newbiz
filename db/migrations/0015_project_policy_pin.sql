-- @reversible: true (additive rebuild + seed data — the DROP in the rebuild is row-preserving via INSERT...SELECT, exactly the 0013 compliance_check pattern; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts — ADR-0014)
-- project_policy_pin rebuild + mandatory grandfathering backfill — design of
-- record docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md
-- (PR-5 row: "+ project_policy_pin 백필(거버넌스 #8)") and ADR-0047 §4 (the
-- backfill is a PRECONDITION of PR-5, not a follow-up). PR-5b.
--
-- WHY A REBUILD: the spec's §0 premise "project_policy_pin does not exist"
-- was wrong — migration 0011 created it as (project_id, policy_id,
-- policy_version, pinned_at, pinned_by, migration_note) with a composite PK.
-- ADR-0047's grandfathering needs the same append-only supersede semantics as
-- project_case_classification (re-pinning must keep the old pin visible, or
-- "which policy set was this project judged against last quarter" stops being
-- answerable), so the table is rebuilt to the 0013 pattern:
--   - id TEXT PRIMARY KEY (append-only rows, not a mutable slot),
--   - superseded_by self-reference + partial unique live index,
--   - policy_doc_id replaces policy_id (pins target governance documents —
--     the 13 procedure docs here; plain TEXT with NO FK, the
--     compliance_check.waiver_id precedent from 0006: governance_doc/policy/
--     procedure are still unseeded tables owned by the policy:sync work
--     seeded later, and an FK to an empty anchor would make this backfill
--     unrunnable).
-- Column drops vs 0011: migration_note is gone (not in the target shape; the
-- rebuild carries 0 rows — every existing database has an empty pin table,
-- verified 2026-08-23 — so nothing is lost; future re-pin reasons live in the
-- audit trail written by the repository layer).
--
-- BACKFILL (ADR-0047 §4.2): every existing md_project row — pilots included —
-- is pinned to the procedure versions in force at migration-authoring time.
-- Static INSERT...SELECT per procedure doc: the 13 (doc, version) pairs are
-- authored constants read from procedures/**/schema.yaml on 2026-08-23 (no
-- dynamic YAML reads in SQL, per spec constraint 10); the project
-- enumeration is dynamic (FROM md_project), so fresh databases backfill
-- nothing and production databases backfill everything that exists.
-- The two variant procedures (ent-a / region-eu brownfield-screening) declare
-- no version of their own — they reference the shared procedure, so they pin
-- at the referenced shared version.
-- WHERE NOT EXISTS makes the data half idempotent even under manual
-- re-execution (belt-and-braces on top of the runner's schema_migrations
-- bookkeeping, the mechanism 0014 documented as the hard backstop).
-- pinned_at is a fixed literal (ADR-0002: no dynamic date functions) so the
-- seed set is byte-deterministic; pinned_by is the migration-authoring actor
-- literal, the same convention 0014 used for created_at provenance.

CREATE TABLE project_policy_pin_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  policy_doc_id TEXT NOT NULL,
  pinned_version TEXT NOT NULL,
  pinned_at TEXT NOT NULL,
  pinned_by TEXT NOT NULL,
  superseded_by TEXT REFERENCES project_policy_pin_new(id)
);
INSERT INTO project_policy_pin_new (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by, superseded_by)
  SELECT 'pin-0015-' || policy_id || '-' || project_id, project_id, policy_id, policy_version, pinned_at, pinned_by, NULL
  FROM project_policy_pin;
DROP TABLE project_policy_pin;
ALTER TABLE project_policy_pin_new RENAME TO project_policy_pin;
CREATE UNIQUE INDEX idx_project_policy_pin_live ON project_policy_pin(project_id, policy_doc_id) WHERE superseded_by IS NULL;

-- ── Grandfathering backfill: 13 static (doc, version) pairs ───────────────
-- Values read 2026-08-23 from procedures/_shared/*/schema.yaml (11) plus
-- procedures/entities/ent-a/brownfield-screening and
-- procedures/regions/EU/brownfield-screening (2 variants, version inherited
-- from the referenced shared brownfield-screening).

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-shared-brownfield-dd-' || p.id, p.id, 'shared-brownfield-dd', '1.3.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'shared-brownfield-dd');

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-shared-brownfield-fs-' || p.id, p.id, 'shared-brownfield-fs', '1.2.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'shared-brownfield-fs');

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-shared-brownfield-pre-fs-' || p.id, p.id, 'shared-brownfield-pre-fs', '1.3.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'shared-brownfield-pre-fs');

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-shared-brownfield-screening-' || p.id, p.id, 'shared-brownfield-screening', '1.2.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'shared-brownfield-screening');

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-shared-entity-establishment-execution-' || p.id, p.id, 'shared-entity-establishment-execution', '1.1.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'shared-entity-establishment-execution');

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-shared-entity-ic-review-' || p.id, p.id, 'shared-entity-ic-review', '1.1.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'shared-entity-ic-review');

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-shared-greenfield-dd-' || p.id, p.id, 'shared-greenfield-dd', '1.0.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'shared-greenfield-dd');

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-shared-greenfield-fs-' || p.id, p.id, 'shared-greenfield-fs', '1.0.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'shared-greenfield-fs');

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-shared-greenfield-pre-fs-' || p.id, p.id, 'shared-greenfield-pre-fs', '1.2.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'shared-greenfield-pre-fs');

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-shared-greenfield-screening-' || p.id, p.id, 'shared-greenfield-screening', '1.3.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'shared-greenfield-screening');

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-shared-group-investment-review-' || p.id, p.id, 'shared-group-investment-review', '1.1.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'shared-group-investment-review');

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-ent-a-brownfield-screening-' || p.id, p.id, 'ent-a-brownfield-screening', '1.2.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'ent-a-brownfield-screening');

INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by)
SELECT 'pin-0015-region-eu-brownfield-screening-' || p.id, p.id, 'region-eu-brownfield-screening', '1.2.0', '2026-08-23T00:00:00Z', 'migration-0015'
FROM md_project p
WHERE NOT EXISTS (SELECT 1 FROM project_policy_pin e WHERE e.project_id = p.id AND e.policy_doc_id = 'region-eu-brownfield-screening');
