// Port of app/server/deal-review.ts GET /api/projects/:id/incentives
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
      `SELECT id, site_id, direction, type, grantor, program_name, amount, npv_value, currency_id,
              granted_on, application_deadline, construction_deadline, obligation_json, clawback_rule,
              estimated_clawback, negotiability, status, evidence_ref
       FROM incentive WHERE project_id = ? ORDER BY direction, status, id`,
    )
    .all(project.id) as { direction: string }[];
  const byDirection: Record<string, number> = {};
  for (const row of rows) byDirection[row.direction] = (byDirection[row.direction] ?? 0) + 1;
  return ok(rows, 200, byDirection);
}
