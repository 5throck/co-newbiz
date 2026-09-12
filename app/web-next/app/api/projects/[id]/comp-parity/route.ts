import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET /api/projects/[id]/comp-parity — aggregate-only pay parity + management
// incentive package (hr-integration-agent). Executive refs only, never names
// (SEC-05). B9. Read-only in Wave 0 — management package rows land via the
// legacy batch or a later admin surface.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const parity = db.query(
    `SELECT job_family, grade, headcount, target_median, acquirer_median, gap_pct, annual_cost_delta
     FROM comp_benchmark WHERE project_id = ? ORDER BY job_family`,
  ).all(id);
  const packages = db.query(
    `SELECT id, executive_ref, role_title, base_pay, coc_trigger, coc_payout_estimate,
            accelerated_vesting, non_compete_months, flight_risk, value_impact
     FROM management_package WHERE project_id = ? ORDER BY executive_ref`,
  ).all(id);
  return ok({ parity, management_packages: packages }, 200, { parity: parity.length, packages: packages.length });
}
