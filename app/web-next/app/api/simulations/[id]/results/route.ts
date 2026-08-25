// Port of app/server/analysis.ts GET /api/simulations/:id/results
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id: simulationId } = await params;
  const simulation = getDb()
    .query(
      `SELECT s.id, s.run_id, s.seed, s.iterations, s.discount_rate, s.created_at, r.project_id
       FROM simulation s JOIN run r ON r.id = s.run_id
       WHERE s.id = ?`,
    )
    .get(simulationId) as
    | { id: string; run_id: string; seed: number; iterations: number; discount_rate: number; created_at: string; project_id: string }
    | null;
  if (!simulation || !visibleProject(auth.auth, simulation.project_id)) return notFound();
  const results = getDb()
    .query("SELECT metric, p05, p50, p95, mean, std FROM simulation_result WHERE simulation_id = ? ORDER BY metric")
    .all(simulationId) as { metric: string; p05: number; p50: number; p95: number; mean: number; std: number }[];
  const { project_id: _projectId, ...row } = simulation;
  return ok({ simulation: row, results }, 200, { seed: simulation.seed, iterations: simulation.iterations });
}
