-- @reversible: true (one new table plus its indexes; rollback is DROP TABLE
-- decision_proposal, or a pre-migration backup restore, scripts/co-newbiz/
-- restore.ts, ADR-0014. No existing table is touched.)
--
-- Wave M PR M-2 (ADR-0154 §5, design 2026-10-08-wave-m-mcp-parity §6.2):
-- decision_proposal holds what an agent PROPOSES for a human to decide. It is
-- the only table a propose_* MCP tool writes. gate_decision, route_decision,
-- venture_transition_decision, the business-case adoption marker, the target
-- selection record and the human approvals (charter confirmation, DD checklist
-- judgment, four-axis completion: kind 'approval', payload.subject) are written
-- only by the existing decision routes, executed from the human's own web
-- session when they confirm the proposal (boundary #2). Closure and PMI
-- kickoff have no proposal kind at all.
--
-- confirm_token_hash is the single-use confirm nonce (SHA-256). It is issued
-- only to a cookie session that loads the confirm view, so a proposal cannot
-- be confirmed without the human first being shown its payload.
-- confirmed_payload_json keeps the payload as the human finally confirmed it
-- (after optional inline edits) next to payload_json (as proposed) so the
-- diff is auditable.

CREATE TABLE decision_proposal (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'gate_decision', 'route_decision', 'case_adoption', 'target_selection', 'transition_decision', 'approval'
  )),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity', 'project')),
  entity_id TEXT NOT NULL,
  stage_id TEXT,
  payload_json TEXT NOT NULL,
  rationale TEXT NOT NULL,
  evidence_refs_json TEXT,
  proposed_by_user_id TEXT NOT NULL REFERENCES app_user(user_id),
  via_client_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired', 'superseded')),
  confirm_token_hash TEXT,
  expires_at TEXT NOT NULL,
  confirmed_by_user_id TEXT REFERENCES app_user(user_id),
  confirmed_at TEXT,
  confirmed_payload_json TEXT,
  resulting_record_id TEXT,
  created_at TEXT NOT NULL,
  CHECK (status != 'confirmed' OR (confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL))
);

CREATE INDEX idx_decision_proposal_entity ON decision_proposal(entity_type, entity_id, kind, status);
CREATE INDEX idx_decision_proposal_proposer ON decision_proposal(proposed_by_user_id, status, created_at);
