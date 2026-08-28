// GET /api/projects/:id/comp-benchmark — api-spec §4 as-built. Aggregate-only
// pay-parity rows (k>=3 aggregates by design; the table has no individual
// rows to leak). Elevated role: viewers are rejected; analysts/admins read.
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
    return forbidden("role_required", "Compensation benchmark data requires an elevated role (analyst or admin).");
  }
  const rows = getDb()
    .query(
      `SELECT id, job_family, grade, headcount, target_median, acquirer_median,
              gap_pct, annual_cost_delta
       FROM comp_benchmark
       WHERE project_id = ?
       ORDER BY job_family, grade`,
    )
    .all(project.id);
  return ok(rows, 200, { count: rows.length });
}
