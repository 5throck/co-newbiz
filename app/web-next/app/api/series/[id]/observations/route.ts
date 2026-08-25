// Port of app/server/analysis.ts GET /api/series/:id/observations
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { ok, provenance } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id: seriesId } = await params;
  const url = new URL(request.url);
  const allRevisions = ["1", "true"].includes(url.searchParams.get("all_revisions") ?? "");
  const periodId = url.searchParams.get("period_id") || null;
  const rows = getDb()
    .query(
      `SELECT period_id, revision_no, value, unit_id, source_id, fetched_at
       FROM fact_market_observation f
       WHERE f.series_id = ? AND (? IS NULL OR f.period_id = ?)
       ${
        allRevisions
          ? ""
          : "AND f.revision_no = (SELECT MAX(f2.revision_no) FROM fact_market_observation f2 WHERE f2.series_id = f.series_id AND f2.period_id = f.period_id)"
      }
       ORDER BY f.period_id DESC, f.revision_no DESC`,
    )
    .all(seriesId, periodId, periodId) as { source_id: string }[];
  const sources = new Set(rows.map((r) => r.source_id));
  return ok(rows, 200, {
    series_id: seriesId,
    all_revisions: allRevisions,
    count: rows.length,
    ...(sources.size === 1 ? provenance({ source: rows[0].source_id }) : {}),
  });
}
