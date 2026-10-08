// One market-sizing analysis: status + current pipeline step (for the
// "분석 중" polling) and, once completed, its version history. GET is
// read-only for any authenticated role.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { id } = await params;
  const db = getDb();

  const analysis = db
    .query(
      `SELECT a.id, a.status, a.current_step, a.methodology_version, a.created_by, a.created_at, a.completed_at,
              i.id AS industry_id, i.name_ko, i.ksic_code
       FROM market_sizing_analysis a JOIN md_industry i ON i.id = a.industry_id
       WHERE a.id = ?`,
    )
    .get(id) as
    | { id: string; status: string; current_step: number; methodology_version: string; created_by: string; created_at: string; completed_at: string | null; industry_id: string; name_ko: string; ksic_code: string | null }
    | null;
  if (!analysis) return notFound();

  const versions = db
    .query(
      `SELECT version_no, payload, changelog, created_by, created_at, data_confidence_grade, confidence_basis
       FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC`,
    )
    .all(id) as Array<{ version_no: number; payload: string; changelog: string | null; created_by: string; created_at: string; data_confidence_grade: string | null; confidence_basis: string | null }>;
  const versionsWithParsed = versions.map((v) => {
    try {
      return { ...v, payload: JSON.parse(v.payload) as unknown };
    } catch {
      return { ...v, payload: null };
    }
  });

  return ok(
    { ...analysis, versions: versionsWithParsed },
    200,
    { status: analysis.status, versions: versionsWithParsed.length },
  );
}
