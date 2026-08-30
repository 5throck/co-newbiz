// Portfolio profitability — simulation-based profitability rollup across the
// caller's visible projects. For each project: the latest simulation (its
// run label, actor, iteration count) and the persisted NPV quantile summary
// (simulation_result metric='npv'), plus the latest overall RAG grade. The
// per-iteration draws stay API-never-exposed (retention contract); everything
// shown here is already persisted — nothing is recomputed per request.
import { getDb } from "../../../../../db/client.ts";
import { listVisibleProjects } from "../../../../../db/repositories/project.repository.ts";
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const projects = auth.auth.role === "admin" ? [] : listVisibleProjects(auth.auth.userId);
  const ids = projects.map((p) => p.id);
  if (ids.length === 0) return ok({ projects: [], portfolio: null }, 200, { count: 0 });

  const db = getDb();
  const placeholders = ids.map(() => "?").join(", ");

  const sims = db
    .query(
      `SELECT project_id, simulation_id, label, iterations, discount_rate, sim_created_at, created_by FROM (
         SELECT r.project_id, s.id AS simulation_id, r.label, s.iterations, s.discount_rate,
                s.created_at AS sim_created_at, r.created_by,
                ROW_NUMBER() OVER (PARTITION BY r.project_id ORDER BY s.created_at DESC, s.id DESC) AS rn
         FROM simulation s
         JOIN run r ON r.id = s.run_id
         WHERE r.project_id IN (${placeholders})
       ) WHERE rn = 1`,
    )
    .all(...ids) as Array<{
    project_id: string; simulation_id: string; label: string | null; iterations: number;
    discount_rate: number; sim_created_at: string; created_by: string;
  }>;

  const npvBySim = new Map(
    (
      db
        .query(
          `SELECT simulation_id, p05, p50, p95, mean, std FROM simulation_result
           WHERE metric = 'npv' AND simulation_id IN (${sims.map(() => "?").join(", ") || "''"})`,
        )
        .all(...sims.map((s) => s.simulation_id)) as Array<{
        simulation_id: string; p05: number; p50: number; p95: number; mean: number; std: number;
      }>
    ).map((r) => [r.simulation_id, r]),
  );

  const ragByProject = new Map(
    (
      db
        .query(
          `SELECT project_id, grade, assessed_at FROM (
             SELECT project_id, grade, assessed_at,
                    ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY assessed_at DESC, id DESC) AS rn
             FROM rag_assessment
             WHERE dimension = 'overall' AND project_id IN (${placeholders})
           ) WHERE rn = 1`,
        )
        .all(...ids) as Array<{ project_id: string; grade: string; assessed_at: string }>
    ).map((r) => [r.project_id, r]),
  );

  const rows = projects.map((p) => {
    const sim = sims.find((s) => s.project_id === p.id) ?? null;
    const npv = sim ? npvBySim.get(sim.simulation_id) ?? null : null;
    const rag = ragByProject.get(p.id) ?? null;
    return {
      project_id: p.id,
      project_no: p.project_no,
      rag_overall: rag?.grade ?? null,
      simulation_id: sim?.simulation_id ?? null,
      run_label: sim?.label ?? null,
      iterations: sim?.iterations ?? null,
      discount_rate: sim?.discount_rate ?? null,
      simulated_at: sim?.sim_created_at ?? null,
      simulated_by: sim?.created_by ?? null,
      npv: npv
        ? { p05: npv.p05, p50: npv.p50, p95: npv.p95, mean: npv.mean, std: npv.std }
        : null,
    };
  });

  const withNpv = rows.filter((r) => r.npv !== null);
  const portfolio =
    withNpv.length > 0
      ? {
          projects_with_simulation: withNpv.length,
          projects_total: rows.length,
          npv_mean_sum_krw_m: withNpv.reduce((acc, r) => acc + (r.npv?.mean ?? 0), 0),
          npv_p05_sum_krw_m: withNpv.reduce((acc, r) => acc + (r.npv?.p05 ?? 0), 0),
          npv_p95_sum_krw_m: withNpv.reduce((acc, r) => acc + (r.npv?.p95 ?? 0), 0),
        }
      : null;

  return ok({ projects: rows, portfolio }, 200, { count: rows.length });
}
