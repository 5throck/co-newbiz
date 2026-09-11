// GET /api/companies — company list + search for the company financials
// screen (ADR-0116 Phase 1). Read-only over md_company with fact coverage
// counts; reachable from the project bridge tab's connect flow and the
// company screen itself. No project scoping — companies are workspace-level.
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const db = getDb();
  const rows = db
    .query(
      `SELECT c.id, c.name_ko, c.dart_corp_code,
              (SELECT COUNT(DISTINCT per.fiscal_year) FROM fact_financial f
                 JOIN md_period per ON per.id = f.period_id
                WHERE f.company_id = c.id) AS fact_years,
              (SELECT MAX(f.created_at) FROM fact_financial f WHERE f.company_id = c.id) AS latest_sync_at
       FROM md_company c
       WHERE (? = '' OR c.name_ko LIKE '%' || ? || '%')
       ORDER BY c.name_ko
       LIMIT 50`,
    )
    .all(q, q);
  return ok({ companies: rows }, 200, { count: (rows as unknown[]).length });
}
