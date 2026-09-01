-- 0057_investment_progress.sql
-- S10 투자심사·실행 / S11 사후 관리 (flow.spec v2.0.0).
--   investment_decision   : Entity/Group IC 승인 기록 (사람 최종, 경계 #2)
--   portfolio_entry       : S11 포트폴리오 스코어카드 항목 (분기 갱신)
-- Additive-only (ADR-0014).
CREATE TABLE investment_decision (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  entity_verdict TEXT CHECK (entity_verdict IN ('approved', 'rejected')),
  group_verdict TEXT CHECK (group_verdict IN ('approved', 'rejected')),
  rationale TEXT,
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
CREATE INDEX idx_invdec_opp ON investment_decision(opportunity_id);

CREATE TABLE portfolio_entry (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  quarter TEXT NOT NULL,               -- YYYY-Qn
  score INTEGER CHECK (score BETWEEN 1 AND 10),
  status TEXT CHECK (status IN ('on_track', 'watch', 'risk')),
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_portfolio_opp ON portfolio_entry(opportunity_id, quarter);
