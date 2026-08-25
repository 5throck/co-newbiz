// Port of app/server/analysis.ts GET /api/data-changes
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const seriesId = url.searchParams.get("series_id") || null;
  const requested = Number(url.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 500) : 100;
  const rows = getDb()
    .query(
      `SELECT id, series_id, detected_at, change_type, old_value, new_value
       FROM data_change_log
       WHERE (? IS NULL OR series_id = ?)
       ORDER BY detected_at DESC, id DESC LIMIT ?`,
    )
    .all(seriesId, seriesId, limit);
  return ok(rows, 200, { limit });
}
