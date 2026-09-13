-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- ADR-0128 — 런타임 LLM 호출 런 장부. 모든 completeOrFallback 호출이
-- "어느 에이전트가, 무슨 목적으로, LLM인지 결정론인지" 기록되는 append-only
-- 장부다. process_run은 opportunity/project 엔터티 결합형이라 임의 컨텍스트의
-- 단발 호출을 담지 못하므로 독립 테이블을 둔다.

CREATE TABLE llm_call_log (
  id TEXT PRIMARY KEY,
  agent_key TEXT NOT NULL,
  purpose TEXT NOT NULL,
  context_type TEXT,
  context_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('llm', 'synthesis')),
  provider TEXT,
  model TEXT,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  latency_ms INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_llm_call_log_agent ON llm_call_log(agent_key, created_at DESC);
