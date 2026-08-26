// Port of app/server/deal-review.ts GET /api/projects/:id/sites
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
      `SELECT id, name, region_code, infra_score, infra_capex, incentive_npv, logistics_cost,
              labor_availability, permit_lead_time_days, affected_area_notification_status, total_score, rank
       FROM site_candidate WHERE project_id = ? ORDER BY (rank IS NULL), rank, name`,
    )
    .all(project.id);
  return ok(rows);
}
