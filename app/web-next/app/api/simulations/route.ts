// Port of app/server/analysis.ts POST /api/simulations
import { getDb } from "../../../../../db/client.ts";
import { appendAudit } from "../../../../../db/lib/access-control.ts";
import { runSimulationForRun, SimulationInputError } from "../../../../../db/lib/simulation.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../lib/envelope.ts";
import { visibleProject } from "../../../lib/project-visibility.ts";

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const body = (await request.json().catch(() => null)) as { run_id?: string; seed?: number; iterations?: number } | null;
  if (!body?.run_id?.trim()) {
    return badRequest("invalid_request", "run_id is required.");
  }
  const runId = body.run_id.trim();
  const run = getDb().query("SELECT project_id FROM run WHERE id = ?").get(runId) as { project_id: string } | null;
  if (!run || !visibleProject(ctx, run.project_id)) return notFound();
  if (ctx.role === "viewer") {
    return forbidden("role_required", "Simulation runs require the analyst role.");
  }
  try {
    const result = await runSimulationForRun(getDb(), { runId, seed: body.seed, iterations: body.iterations });
    appendAudit(getDb(), { actor: ctx.userId, action: "simulation_run", target: `${run.project_id}:${result.simulation_id}`, now: new Date().toISOString() });
    return ok(result, 201);
  } catch (err) {
    if (err instanceof SimulationInputError) {
      return badRequest("simulation_rejected", err.message);
    }
    return fail(500, "simulation_failed", err instanceof Error ? err.message : "Simulation engine failed.");
  }
}
