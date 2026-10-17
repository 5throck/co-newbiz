// GET /api/opportunities/[id]/sizing-link/versions — additive read-only
// listing (2026-10-17 decider feedback): the COMPLETED S1 market-sizing
// versions of the opportunity's industry, newest first, for the step-1
// version DROPDOWN in the consolidated 진입시장 산정 card. Each row carries
// the version id (the value the existing human-only sizing-link PUT pins),
// version_no, the industry name, the declared scope summary via the
// slice-2 tolerant extractor (extractSizingVersionScope — null when the
// payload is unscoped/unparsable), the data-confidence grade and the
// analysis completed_at. No write path here: the only audited write remains
// the human-only PUT on the parent sizing-link route. Readable by anyone
// who can see the opportunity (same auth level as the sizing-link GET).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { extractSizingVersionScope } from "../../../../../../lib/anchor-scope.ts";

export interface SizingVersionOption {
  id: string;
  version_no: number;
  industry_name: string;
  scope: ReturnType<typeof extractSizingVersionScope>;
  confidence_grade: string | null;
  completed_at: string | null;
}

/** Completed versions of the opportunity's industry, newest first
 *  (created_at then version_no desc — the same ordering the auto-link's
 *  latestCompletedVersion uses). Unknown opportunity -> undefined; an
 *  opportunity without an industry yields an empty list, never fabricated. */
export function listCompletedSizingVersions(
  db: ReturnType<typeof getDb>,
  opportunityId: string,
): SizingVersionOption[] | undefined {
  const opp = db.query("SELECT industry_id FROM opportunity WHERE id = ?").get(opportunityId) as
    | { industry_id: string | null }
    | undefined;
  if (!opp) return undefined;
  if (!opp.industry_id) return [];
  const rows = db
    .query(
      "SELECT mv.id AS id, mv.version_no AS version_no, i.name_ko AS industry_name," +
        " mv.data_confidence_grade AS confidence_grade, mv.payload AS payload, a.completed_at AS completed_at" +
        " FROM market_sizing_version mv JOIN market_sizing_analysis a ON a.id = mv.analysis_id" +
        " JOIN md_industry i ON i.id = a.industry_id" +
        " WHERE a.industry_id = ? AND a.status = 'completed'" +
        " ORDER BY mv.created_at DESC, mv.version_no DESC",
    )
    .all(opp.industry_id) as Array<{
    id: string;
    version_no: number;
    industry_name: string;
    confidence_grade: string | null;
    payload: string;
    completed_at: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    version_no: r.version_no,
    industry_name: r.industry_name,
    scope: extractSizingVersionScope(r.payload),
    confidence_grade: r.confidence_grade,
    completed_at: r.completed_at,
  }));
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const versions = listCompletedSizingVersions(db, id);
  if (versions === undefined) return notFound();
  return ok({ versions }, 200, { count: versions.length });
}
