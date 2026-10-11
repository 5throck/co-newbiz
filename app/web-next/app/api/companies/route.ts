// GET /api/companies — company list + search for the company financials
// screen (ADR-0116 Phase 1). Read-only over md_company with fact coverage
// counts; reachable from the project bridge tab's connect flow and the
// company screen itself. No project scoping — companies are workspace-level.
import { getDb } from "../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

// md_company row created by migration 0060; synergy_analysis.company_id points here
// for registry-target analyses (see api/synergy/analyses/route.ts).
const SYNERGY_REGISTRY_SENTINEL_ID = "md-synergy-registry-sentinel";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  // scope=targets: acquisition-target / analysis-base companies only. Hides
  // group/affiliate profile companies (company_group_member, no FK to
  // md_company, so matched by DART code or, without a code, exact name) and
  // the internal synergy-registry sentinel. Read-only filter; no param = all rows.
  const targetsOnly = params.get("scope") === "targets";
  const scopeClause = targetsOnly
    ? `AND c.id <> '${SYNERGY_REGISTRY_SENTINEL_ID}'
         AND NOT EXISTS (
           SELECT 1 FROM company_group_member m
            WHERE m.deleted_at IS NULL
              AND ((COALESCE(c.dart_corp_code, '') <> '' AND m.dart_corp_code = c.dart_corp_code)
                OR (COALESCE(c.dart_corp_code, '') = '' AND TRIM(m.company_name) = TRIM(c.name_ko))))`
    : "";
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
       ${scopeClause}
       ORDER BY c.name_ko
       LIMIT 50`,
    )
    .all(q, q);
  return ok({ companies: rows }, 200, { count: (rows as unknown[]).length });
}
