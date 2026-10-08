// Per-deal LLM token and cost rollup over llm_call_log (Wave B / B-1, design §6).
// Read-only; cost_usd NULL rows (unknown model, synthesis) are counted but add
// nothing to the cost sum, and `unpriced_calls` says how many there were.
import type { Database } from "bun:sqlite";

export interface LlmUsageRollup {
  calls: number;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  unpriced_calls: number;
  estimated_calls: number;
  by_function: Array<{ function_name: string; calls: number; tokens: number; cost_usd: number }>;
}

export function llmUsageRollup(db: Database, projectId: string): LlmUsageRollup {
  const where = "(project_id = ? OR (project_id IS NULL AND context_type = 'project' AND context_id = ?))";
  const t = db
    .query(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(source = 'llm'), 0) AS llm_calls,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
              COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd,
              COALESCE(SUM(source = 'llm' AND cost_usd IS NULL), 0) AS unpriced_calls,
              COALESCE(SUM(usage_estimated), 0) AS estimated_calls
       FROM llm_call_log WHERE ${where}`,
    )
    .get(projectId, projectId) as Omit<LlmUsageRollup, "by_function">;
  const by_function = db
    .query(
      `SELECT COALESCE(function_name, agent_key) AS function_name, COUNT(*) AS calls,
              COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0) + COALESCE(cache_read_tokens,0) + COALESCE(cache_write_tokens,0)), 0) AS tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM llm_call_log WHERE ${where} GROUP BY 1 ORDER BY tokens DESC`,
    )
    .all(projectId, projectId) as LlmUsageRollup["by_function"];
  return { ...t, by_function };
}
