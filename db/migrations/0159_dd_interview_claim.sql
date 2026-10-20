-- 0159_dd_interview_claim.sql (2026-10-21 S9 depth: expert-interview
-- triangulation). checklists/commercial-dd-checklist.yaml cdd-07 (mandatory)
-- requires 2–3 independent sources per key claim. The dd_interview row is one
-- source; `claim` names the key claim it supports or refutes so the
-- triangulation summary can group sources per claim. Nullable: an interview
-- recorded without a claim is still a valid record, it simply does not count
-- toward any claim's triangulation.
ALTER TABLE dd_interview ADD COLUMN claim TEXT;
CREATE INDEX IF NOT EXISTS idx_dd_interview_claim ON dd_interview(project_id, claim);
