# Wave D UX gaps design — notifications, freshness, DD provenance

Status: approved for implementation (2026-09-09)

## D1 Notification read state

Add nullable `notification.read_at` with a per-user unread index. The row remains recipient-owned: `GET /api/notifications` filters by `user_id`, `POST /api/notifications/{id}/read` can only update a caller-owned row, and `POST /api/notifications/read-all` updates only the caller's unread rows. Existing rows backfill as unread (`read_at IS NULL`) without rewriting notification history.

UI impact: the top bar shows a true unread count and a one-click "mark all read" action; the admin notification table shows read/unread state but cannot mutate another user's inbox.

## D2 Project list stale signal

`is_stale` is derived at read time and is never stored on `md_project`. The list checks live `project_industry` bindings against the same `fact_industry` metric convention used by snapshot-filler (`market.tam`, `market.growth_rate`, `market.top3_share`) and the SSOT `evidence_var.max_age_days`. If the latest annual fact exceeds the configured age window, the project row includes `is_stale=true` and `stale_reasons[]`; no binding or no rows means no stale assertion is made.

## D3 DD-tailor Tavily provenance

The deterministic DD tailor remains the default and continues to emit `source_url=null`, `source_reliability='C'`. When `CO_NEWBIZ_DD_TAILOR_AGENTS=tavily` and `TAVILY_API_KEY` is configured, the executor runs Tavily search per domain and attaches retrieved URLs with conservative A/B/C reliability classification. The engine still writes `proposed` custom items only; source provenance never approves a checklist item or changes gate state.
