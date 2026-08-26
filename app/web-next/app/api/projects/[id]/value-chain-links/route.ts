// Port of app/server/deal-review.ts GET /api/projects/:id/value-chain-links
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query(
      `SELECT v.id, v.direction, v.elasticity, v.lag_months, v.correlation, v.r2,
              v.pass_through_rate, v.pass_through_lag_months, v.concentration_hhi,
              v.switching_cost_grade, v.substitution_threat, v.evidence_ref, v.assessed_at,
              fi.name_ko AS from_industry_ko, fi.name_en AS from_industry_en,
              ti.name_ko AS to_industry_ko, ti.name_en AS to_industry_en
       FROM value_chain_link v
       JOIN md_industry fi ON fi.id = v.from_industry_id
       JOIN md_industry ti ON ti.id = v.to_industry_id
       WHERE v.project_id = ? ORDER BY v.assessed_at DESC, v.id DESC`,
    )
    .all(project.id);
  return ok(rows);
}
