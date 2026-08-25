// Port of app/server/analysis.ts GET /api/series
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const rows = getDb()
    .query(
      `SELECT series_id, unit_id, source_id, COUNT(*) AS observation_count,
              MIN(period_id) AS min_period_id, MAX(period_id) AS max_period_id
       FROM fact_market_observation
       ${q ? "WHERE series_id LIKE '%' || ? || '%'" : ""}
       GROUP BY series_id, unit_id, source_id
       ORDER BY series_id`,
    )
    .all(...(q ? [q] : []));
  return ok(rows, 200, { count: rows.length });
}
