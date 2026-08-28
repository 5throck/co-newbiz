// GET /api/projects/:id/management-package — api-spec §4 as-built. Role-based
// executive comp (FR-MA-06/SEC-05): the table stores executive_ref only, and
// this response selects no name-shaped column, so a real name cannot leak by
// accident. Elevated role: viewers are rejected; analysts/admins read.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  if (auth.auth.role === "viewer") {
    return forbidden("role_required", "Executive compensation data requires an elevated role (analyst or admin).");
  }
  const rows = getDb()
    .query(
      `SELECT id, executive_ref, role, base_pay, coc_trigger, coc_payout_estimate,
              accelerated_vesting, non_compete_months, non_compete_enforceable,
              flight_risk, value_impact
       FROM management_package
       WHERE project_id = ?
       ORDER BY executive_ref`,
    )
    .all(project.id);
  return ok(rows, 200, { count: rows.length });
}
