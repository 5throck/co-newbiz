---
title: "Run ledger daily buckets (summary.daily) — design"
date: 2026-10-26
status: approved
author: backend-engineer
lang: en
---

# Run ledger daily buckets

## Problem
The /flows call-count trend chart is built client-side from the latest 100 `llm_call_log` rows loaded for the paginated table. With ~186 calls in one day, all 100 rows land on a single day and the trend is wrong. The summary cards are correct because they are a server-side window aggregate.

## Decision
`GET /api/flows/runs` returns per-day buckets for the selected window in `summary.daily`. The chart consumes them; the table stays paginated and unchanged.

## Response contract
`summary.daily: Array<{ day: string; ok: number; failed: number; costUsd: number }>`
- `day`: `YYYY-MM-DD`; ascending; one entry per calendar day from the day containing the window start through today (inclusive).
- `ok`: rows with `ok = 1`; `failed`: all other rows (same classification as `bucketLlmCallsByDay`); `costUsd`: sum of non-null `cost_usd`.
- Same filters as the summary (visibility, agentKey, entity, ok, source, is_dry_run exclusion unless `includeDryRun=1`) plus `created_at >= windowStart`.
- Independent of `limit` and `before` (the list cursor is not applied).
- Logic lives in `app/web-next/lib/llm-daily.ts`; money stays a plain number (USD), no integer-KRW conversion applies here.

## Summary cards
The whole `summary` (cards and `daily`) is built from the same cursor-free filter set: window start applies, `before`/`limit` never do. Paging the table back must not change any card.

## Timezone rule
A day is a server-local calendar date: SQL `strftime('%Y-%m-%d', created_at, 'localtime')` and JS local getters for the zero-fill, the same local-date rule `bucketLlmCallsByDay` uses (it uses browser-local getters; they agree when server and browser share a timezone, as in the KST deployment). The window start is `now - window` as in the summary; its calendar day is the first bucket, so 24h yields 2 days, 7d yields 8, 30d yields 31 (the first and last may be partial).

## Empty days
Days with no calls are included as `{ ok: 0, failed: 0, costUsd: 0 }` so the x-axis is continuous across the whole window.

## Acceptance criteria
1. 7d response has contiguous ascending days ending today; counts match direct SQL per-day counts.
2. Dry-run rows excluded by default, included with `includeDryRun=1`.
3. `limit` / `before` do not change `summary.daily`.
4. Registered in `docs/architecture/openapi.yaml`; unit tests in `tests/unit/flows-daily-buckets.test.ts` pass; tsc clean.
