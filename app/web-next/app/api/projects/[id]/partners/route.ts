// Port of app/server/deal-review.ts GET /api/projects/:id/partners
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
      `SELECT id, name, partner_type, region_code, capability_score, capacity_score, financial_score,
              compliance_risk, customer_base_fit, dependency_risk, status, contacted_at, nda_signed, evidence_ref
       FROM partner_candidate WHERE project_id = ? ORDER BY name`,
    )
    .all(project.id);
  return ok(rows);
}
