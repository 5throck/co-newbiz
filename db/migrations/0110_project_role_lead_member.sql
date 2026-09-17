-- 0110_project_role_lead_member.sql
-- @version 1.0.0
-- @reversible: false — the three retired values ('contributor', 'reviewer',
--   'observer') collapse into 'member' and the original distinctions are
--   unrecoverable after the mapping (a hand-reverse would need the
--   pre-migration backup; ADR-0014).
--
-- Project membership roles collapse to two values — 'lead' | 'member'
-- (user decision, 2026-09-17; design 2026-09-17-project-role-lead-member).
--
-- Rationale: of the four values introduced by migration 0002 (ADR-0038/39/40
-- need-to-know model), only 'lead' ever had a permission branch anywhere in
-- the codebase (project delete and close/archive via the isLead checks).
-- contributor/reviewer/observer were stored and validated but enforced no
-- difference — any membership row granted identical visibility and write
-- access — while the promotion UI surfaced them as a role picker, promising
-- distinctions the engine never made. The flow.spec S11 artifact wording
-- "사람 최종 승인(reviewer 기록)" is a gate-authority concept, not a
-- membership tier; if gate-authority granularity is needed later it should
-- be modeled as its own axis rather than resurrected here.
--
-- Table rebuild (SQLite cannot ALTER a CHECK constraint). No child table
-- references project_member, so the DROP is safe under the runner's default
-- transaction; the user_id no-FK note from migration 0008 is preserved
-- verbatim (membership links to app_user by convention, enforced at the
-- engine layer in db/lib/access-control.ts).
CREATE TABLE project_member_new (
  project_id TEXT NOT NULL REFERENCES md_project(id),
  user_id TEXT NOT NULL,
  project_role TEXT NOT NULL CHECK (project_role IN ('lead', 'member')),
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  need_to_know_basis TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
INSERT INTO project_member_new
  SELECT project_id,
         user_id,
         CASE WHEN project_role = 'lead' THEN 'lead' ELSE 'member' END,
         granted_by,
         granted_at,
         revoked_at,
         need_to_know_basis
  FROM project_member;
DROP TABLE project_member;
ALTER TABLE project_member_new RENAME TO project_member;
CREATE INDEX idx_project_member_user ON project_member(user_id, project_id);
