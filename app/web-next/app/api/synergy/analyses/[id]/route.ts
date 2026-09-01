// One synergy analysis: status (for the "분석 중" polling) + versions with
// parsed payloads. GET is read-only for any authenticated role.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();

  const analysis = db
    .query(
      `SELECT sa.id, sa.status, sa.current_step, sa.created_by, sa.created_at, sa.completed_at, sa.source_ref,
              c.id AS company_id, c.name_ko AS company_name, c.dart_corp_code,
              ac.name_ko AS acquirer_name
       FROM synergy_analysis sa
       JOIN md_company c ON c.id = sa.company_id
       LEFT JOIN md_company ac ON ac.id = sa.acquirer_company_id
       WHERE sa.id = ?`,
    )
    .get(id) as
    | { id: string; status: string; current_step: number; created_by: string; created_at: string; completed_at: string | null; source_ref: string | null; company_id: string; company_name: string; dart_corp_code: string | null; acquirer_name: string | null }
    | null;
  if (!analysis) return notFound();

  const versions = db
    .query(
      `SELECT version_no, payload, changelog, created_by, created_at
       FROM synergy_version WHERE analysis_id = ? ORDER BY version_no DESC`,
    )
    .all(id) as Array<{ version_no: number; payload: string; changelog: string | null; created_by: string; created_at: string }>;
  const parsed = versions.map((v) => {
    try {
      return { ...v, payload: JSON.parse(v.payload) as unknown };
    } catch {
      return { ...v, payload: null };
    }
  });

  return ok({ ...analysis, versions: parsed }, 200, { status: analysis.status, versions: parsed.length });
}
