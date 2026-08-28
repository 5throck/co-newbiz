// Port of app/server/analysis.ts GET /api/series + per-series freshness
// (ui-spec §2 staleness badges). last_fetched_at is the real MAX(fetched_at)
// of the series' observations — never a fabricated signal. `stale` applies a
// single operational default (90 days since last fetch) echoed in meta so the
// threshold is inspectable, not hidden.
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

const STALENESS_THRESHOLD_DAYS = 90;

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const rows = getDb()
    .query(
      `SELECT series_id, unit_id, source_id, COUNT(*) AS observation_count,
              MIN(period_id) AS min_period_id, MAX(period_id) AS max_period_id,
              MAX(fetched_at) AS last_fetched_at
       FROM fact_market_observation
       ${q ? "WHERE series_id LIKE '%' || ? || '%'" : ""}
       GROUP BY series_id, unit_id, source_id
       ORDER BY series_id`,
    )
    .all(...(q ? [q] : [])) as {
    series_id: string;
    unit_id: string;
    source_id: string;
    observation_count: number;
    min_period_id: string;
    max_period_id: string;
    last_fetched_at: string | null;
  }[];
  const nowMs = Date.now();
  const dayMs = 86_400_000;
  const withStaleness = rows.map((r) => {
    const days = r.last_fetched_at ? Math.floor((nowMs - new Date(r.last_fetched_at).getTime()) / dayMs) : null;
    return { ...r, days_since_fetch: days, stale: days === null ? true : days > STALENESS_THRESHOLD_DAYS };
  });
  return ok(withStaleness, 200, { count: withStaleness.length, staleness_threshold_days: STALENESS_THRESHOLD_DAYS });
}
