// Port of app/server/market.ts GET /api/projects/:id/industries/:industryId/financials
import { getDb } from "../../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id, industryId } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const url = new URL(request.url);
  const years = Math.min(Math.max(Number(url.searchParams.get("years") ?? 5), 1), 10);
  const currentYear = new Date().getUTCFullYear();
  const rows = getDb()
    .query(
      `SELECT p.fiscal_year AS fiscal_year, f.metric_key AS metric_key, MAX(f.value) AS value, MAX(f.revision_no) AS revision_no
       FROM fact_industry f JOIN md_period p ON p.id = f.period_id
       WHERE f.industry_id = ? AND p.fiscal_year >= ?
       GROUP BY p.fiscal_year, f.metric_key ORDER BY p.fiscal_year DESC, f.metric_key`,
    )
    .all(industryId, currentYear - years + 1);
  return ok(rows, 200, { industry_id: industryId, years });
}
