# ADR-0155 — LLM structured output, real token usage, per-deal cost and GenAI spans

- Status: Accepted (2026-10-08, pre-approved by the user in chat)
- Date: 2026-10-08
- Deciders: Human reviewer (user, pre-approved in chat 2026-10-08). Drafted by backend-engineer for platform-lead (Wave B PR B-1). AI review alone cannot accept this ADR (DB schema change).
- Design of record: `docs/designs/2026-10-08-wave-b-ai-eval-design.md` §5-§6
- Related: ADR-0128 (agent run ledger), ADR-0153 (3-stage review runtime)

## Context

`lib/llm.ts` returned text only. Callers parsed JSON by hand, the AI 2nd review estimated cost as chars/4, and `llm_call_log` carried no tokens, cost or deal id, so spend per deal could not be answered.

## Decision

1. Add `completeStructured` (provider-native JSON schema when `CO_NEWBIZ_LLM_CAPS` declares `structured`, otherwise instruct-and-parse), always followed by Zod validation, one repair retry that names only failing paths, then an explicit synthesis fallback with a reason. Add streaming and `cache_control` prompt caching, each gated by the same capability list, never by model name.
2. Read provider-reported usage (Anthropic, OpenAI-compatible, Gemini and custom shapes). The chars/4 estimate is kept only when a response has no usage and is flagged `usage_estimated`.
3. Migration 0130 adds nullable columns to `llm_call_log`: `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `usage_estimated`, `project_id`, `function_name`, `prompt_hash`, plus an index on `project_id`. Existing rows are untouched.
4. Cost comes from `config/llm-pricing.yaml` (per-million prices with `source`, `verified_on`, `maintainer`). An unknown model records `cost_usd = NULL` and a one-time warning.
5. OpenTelemetry GenAI span `gen_ai.chat` is emitted over OTLP/HTTP JSON only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, with no SDK dependency. Prompt and completion content are never recorded (MNPI).

## Consequences

- A per-deal token and cost rollup is exposed on the existing `GET /api/projects/[id]/agent-runs`.
- Agents still inherit the caller's permissions; none of this adds an account or a decision path (boundaries 1 and 2).
- Prices in the table must be verified by their maintainer; unverified entries are labelled `verified_on: null`.

## Alternatives rejected

- Adopting the OpenTelemetry JS SDK: a large dependency for one span type, and a lockfile change on the default path.
- Estimating cost for unknown models: a guessed number reads as a fact.
