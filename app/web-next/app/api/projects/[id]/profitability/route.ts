// Per-project profitability — the simulation-based NPV history for one deal.
// Every recorded simulation run (with actor, run label, iteration count) and
// its persisted NPV quantile summary. Draws stay API-never-exposed; the
// distribution chart on the page reuses GET /api/simulations/:id/results.
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
      `SELECT s.id AS simulation_id, s.run_id, r.label AS run_label, r.created_by,
              s.iterations, s.discount_rate, s.created_at,
              sr.p05, sr.p50, sr.p95, sr.mean, sr.std
       FROM simulation s
       JOIN run r ON r.id = s.run_id
       LEFT JOIN simulation_result sr ON sr.simulation_id = s.id AND sr.metric = 'npv'
       WHERE r.project_id = ?
       ORDER BY s.created_at DESC, s.id DESC`,
    )
    .all(project.id) as Array<{
    simulation_id: string; run_id: string; run_label: string | null; created_by: string;
    iterations: number; discount_rate: number; created_at: string;
    p05: number | null; p50: number | null; p95: number | null; mean: number | null; std: number | null;
  }>;

  const latest = rows[0] ?? null;
  return ok(
    {
      project_id: project.id,
      project_no: project.project_no,
      latest_simulation_id: latest?.simulation_id ?? null,
      history: rows,
    },
    200,
    { count: rows.length },
  );
}
