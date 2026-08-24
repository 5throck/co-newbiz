// @version 1.0.0
/**
 * run_structure_simulation / get_structure_simulation_results — ADR-0066
 * Phase C. Thin REST wrappers (ADR-0011): composition, spawning, and
 * persistence all live at the REST layer (db/lib/structure-simulation.ts via
 * app/server/market.ts). Quantiles are engine-native units; driver deltas
 * come from the run's drv.* assumption keys.
 */

import { rest } from "../shared/rest-client.ts";

export async function runStructureSimulation(opts: {
  projectId: string;
  runId: string;
  seed?: number;
  iterations?: number;
  scenario?: "downside" | "base" | "upside" | "custom";
}) {
  return rest.post(`/api/projects/${encodeURIComponent(opts.projectId)}/structure-simulations`, {
    run_id: opts.runId,
    seed: opts.seed,
    iterations: opts.iterations,
    scenario: opts.scenario,
  });
}

export async function getStructureSimulationResults(projectId: string, runId?: string) {
  const suffix = runId ? `?run_id=${encodeURIComponent(runId)}` : "";
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/structure-simulations${suffix}`);
}
