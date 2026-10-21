-- 0165_review_claim_ack.sql (2026-10-21, decider: "확인한 내용을 저장할 방안이
-- 없는 듯 해"). ADR-0182 §5 stored the three-stage review's "사람 확인" checks
-- ONLY inside the gate decision record, so review work was lost on navigation
-- and the project gate route dropped it entirely. This append-only ledger
-- keeps the interim per-claim acknowledgement; the decision record still
-- carries its own snapshot (amends ADR-0182 §5's "no new table" clause — see
-- the addendum in docs/adr/0182-*.md).
CREATE TABLE review_claim_ack (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity', 'project')),
  entity_id TEXT NOT NULL,
  gate TEXT NOT NULL,
  claim TEXT NOT NULL,
  acked INTEGER NOT NULL CHECK (acked IN (0, 1)),
  note TEXT,
  acked_by TEXT NOT NULL,
  acked_at TEXT NOT NULL
);
CREATE INDEX idx_review_claim_ack_item ON review_claim_ack(entity_type, entity_id, gate, claim, acked_at);
