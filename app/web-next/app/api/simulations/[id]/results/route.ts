// Port of app/server/analysis.ts GET /api/simulations/:id/results
// + the distribution aggregate (simulation.ts 1.1.0): raw draw ROWS are
// never exposed (api.test.ts pins the absence of a `draws` property and
// retention_policy keeps draws purgeable) — the server reduces them to a
// fixed-bin histogram and a CDF trace instead. Simulations that predate the
// draw-persisting engine return distribution: null and the UI keeps its
// quantile-reconstruction fallback.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

const HISTOGRAM_BINS = 40;
const CDF_POINTS = 100;

interface Distribution {
  metric: string;
  draws: number;
  bins: { start: number; end: number; count: number }[];
  cdf: { value: number; p: number }[];
}

function buildDistribution(metric: string, values: number[]): Distribution {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[n - 1];
  const width = (hi - lo) / HISTOGRAM_BINS || 1;
  const counts = new Array<number>(HISTOGRAM_BINS).fill(0);
  for (const v of values) {
    const idx = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor((v - lo) / width)));
    counts[idx]++;
  }
  const bins = counts.map((count, i) => ({
    start: lo + width * i,
    end: lo + width * (i + 1),
    count,
  }));
  const cdf: { value: number; p: number }[] = [];
  for (let i = 0; i < CDF_POINTS; i++) {
    const value = lo + ((hi - lo) * i) / (CDF_POINTS - 1);
    // binary search: count of draws <= value
    let low = 0;
    let high = n;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (sorted[mid] <= value) low = mid + 1;
      else high = mid;
    }
    cdf.push({ value, p: low / n });
  }
  return { metric, draws: n, bins, cdf };
}

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
  const drawRows = getDb()
    .query("SELECT value FROM simulation_draw WHERE simulation_id = ? AND metric = 'npv' ORDER BY iteration_no")
    .all(simulationId) as { value: number }[];
  const distribution = drawRows.length > 0 ? buildDistribution("npv", drawRows.map((d) => d.value)) : null;
  // A2 input snapshot — what this simulation actually consumed.
  const inputs = getDb()
    .query("SELECT assumption_key, value FROM run_input WHERE run_id = ? AND assumption_key LIKE 'sim.%' ORDER BY assumption_key")
    .all(simulation.run_id) as Array<{ assumption_key: string; value: number }>;
  const liabilities = getDb()
    .query("SELECT COUNT(*) AS c FROM contingent_liability WHERE project_id = ?")
    .get(simulation.project_id) as { c: number };
  const { project_id: _projectId, ...row } = simulation;
  return ok({ simulation: row, results, distribution, inputs, contingent_liability_count: liabilities.c }, 200, {
    seed: simulation.seed,
    iterations: simulation.iterations,
    draws_stored: drawRows.length,
    histogram_bins: HISTOGRAM_BINS,
  });
}
