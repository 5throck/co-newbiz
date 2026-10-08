-- @reversible: true (additive nullable columns plus one index on an append-only log; rollback is a pre-migration backup restore, scripts/co-newbiz/restore.ts, ADR-0014. No existing column or row is changed.)
-- ADR-0155 (Wave B / B-1) — per-call token usage, cost and deal id on the
-- agent run ledger. All columns are nullable: rows written before this
-- migration, and synthesis rows, simply carry no usage. cost_usd is NULL when
-- the model has no entry in config/llm-pricing.yaml (never a guess).
-- usage_estimated = 1 marks the chars/4 fallback used when a provider
-- response carried no usage block.

ALTER TABLE llm_call_log ADD COLUMN input_tokens INTEGER;
ALTER TABLE llm_call_log ADD COLUMN output_tokens INTEGER;
ALTER TABLE llm_call_log ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE llm_call_log ADD COLUMN cache_write_tokens INTEGER;
ALTER TABLE llm_call_log ADD COLUMN cost_usd REAL;
ALTER TABLE llm_call_log ADD COLUMN usage_estimated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE llm_call_log ADD COLUMN project_id TEXT;
ALTER TABLE llm_call_log ADD COLUMN function_name TEXT;
ALTER TABLE llm_call_log ADD COLUMN prompt_hash TEXT;
CREATE INDEX idx_llm_call_log_project ON llm_call_log(project_id, created_at DESC);
