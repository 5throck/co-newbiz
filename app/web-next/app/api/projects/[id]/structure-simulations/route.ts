// Port of app/server/market.ts GET/POST /api/projects/:id/structure-simulations
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { runStructureSimulation, type StructureSimSummary } from "../../../../../../../db/lib/structure-simulation.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Structure simulation requires the analyst role.");
  const body = (await request.json().catch(() => null)) as { run_id?: string; seed?: number; iterations?: number; scenario?: string } | null;
  if (!body?.run_id) return badRequest("invalid_request", "run_id is required.");
  const scenario = body.scenario ?? "custom";
  try {
    const summary: StructureSimSummary = await runStructureSimulation(
      {
        runId: body.run_id,
        projectId: project.id,
        scenario: scenario as StructureSimSummary["scenario"],
        seed: body.seed,
        iterations: body.iterations,
      },
      getDb(),
    );
    appendAudit(getDb(), {
      actor: ctx.userId,
      action: "structure_simulation_run",
      target: `${project.id}:${body.run_id}:${summary.results.length}`,
      now: new Date().toISOString(),
    });
    return ok(summary, 201, { unassessed_nodes: summary.unassessed_nodes, defaulted_drivers: summary.defaulted_drivers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Structure simulation failed.";
    if (message.startsWith("structure-simulation:")) return badRequest("invalid_request", message.replace(/^structure-simulation:\s*/, ""));
    return fail(500, "engine_failed", message);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const url = new URL(request.url);
  const runId = url.searchParams.get("run_id");
  const rows = runId
    ? getDb()
        .query(
          "SELECT srr.run_id, srr.scenario, srr.industry_id, srr.metric, srr.p05, srr.p50, srr.p95, srr.created_at, srr.region_code, srr.segment_code FROM structure_simulation_result srr WHERE srr.run_id = ? AND EXISTS (SELECT 1 FROM run r WHERE r.id = srr.run_id AND r.project_id = ?) ORDER BY srr.created_at DESC LIMIT 200",
        )
        .all(runId, project.id)
    : getDb()
        .query(
          "SELECT srr.run_id, srr.scenario, srr.industry_id, srr.metric, srr.p05, srr.p50, srr.p95, srr.created_at, srr.region_code, srr.segment_code FROM structure_simulation_result srr JOIN run r ON r.id = srr.run_id WHERE r.project_id = ? ORDER BY srr.created_at DESC LIMIT 200",
        )
        .all(project.id);
  return ok(rows, 200, { count: rows.length });
}
