// Business Case → Simulation bridge (S5). Turns the model's persisted lines
// into year-by-year net cash flows, creates a run whose sim.* inputs carry
// those flows (sim.discount_rate + sim.cf1..N), and immediately runs the
// Monte Carlo — so the user never hand-types sim.cf inputs from a Business
// Case. Contingent liabilities of the project are picked up by
// runSimulationForRun automatically.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { createRun } from "../../../../../../../../../db/lib/versioning.ts";
import { runSimulationForRun, SimulationInputError } from "../../../../../../../../../db/lib/simulation.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; modelId: string }> },
) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Simulations are run by analysts.");
  const { id, modelId } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();

  const db = getDb();
  const model = db
    .query("SELECT id, kind, name, horizon_years FROM business_case_model WHERE id = ? AND project_id = ?")
    .get(modelId, project.id) as { id: string; kind: string; name: string; horizon_years: number } | null;
  if (!model) return notFound();

  const body = (await request.json().catch(() => null)) as {
    discount_rate?: number; iterations?: number; seed?: number; label?: string;
  } | null;
  const discountRate = body?.discount_rate ?? 0.1;
  if (discountRate <= -1) return badRequest("invalid_request", "discount_rate must be > -1.");

  const lines = db
    .query("SELECT category, annual_amount_krw_m, start_year, growth_rate FROM business_case_line WHERE model_id = ?")
    .all(modelId) as Array<{ category: string; annual_amount_krw_m: number; start_year: number; growth_rate: number }>;
  if (lines.length === 0) {
    return badRequest("empty_model", "Add at least one line to the Business Case before simulating.");
  }

  // Yearly net cash flow: revenue − labor − opex (recurring, compounding)
  // minus capex booked once in its start_year — same arithmetic as the GET
  // projection, kept unrounded for the engine.
  const flows: number[] = [];
  for (let y = 1; y <= model.horizon_years; y++) {
    const amountAt = (l: { annual_amount_krw_m: number; start_year: number; growth_rate: number }) =>
      y >= l.start_year ? l.annual_amount_krw_m * Math.pow(1 + l.growth_rate, y - l.start_year) : 0;
    const capexAt = (l: { annual_amount_krw_m: number; start_year: number }) =>
      y === l.start_year ? l.annual_amount_krw_m : 0;
    const revenue = lines.filter((l) => l.category === "revenue").reduce((a, l) => a + amountAt(l), 0);
    const labor = lines.filter((l) => l.category === "labor").reduce((a, l) => a + amountAt(l), 0);
    const opex = lines.filter((l) => l.category === "opex").reduce((a, l) => a + amountAt(l), 0);
    const capex = lines.filter((l) => l.category === "capex").reduce((a, l) => a + capexAt(l), 0);
    flows.push(revenue - labor - opex - capex);
  }

  const overrides: Record<string, number> = { "sim.discount_rate": discountRate };
  flows.forEach((cf, i) => {
    overrides[`sim.cf${i + 1}`] = Math.round(cf * 10000) / 10000;
  });

  const now = new Date().toISOString();
  const label = body?.label?.trim() || `BC-${model.name} (${flows.length}년)`;
  let created: { run_id: string };
  try {
    created = createRun(db, {
      projectId: project.id,
      label,
      createdBy: ctx.userId,
      overrides,
      now,
    });
  } catch (err) {
    return badRequest("run_rejected", err instanceof Error ? err.message : "Run creation failed.");
  }

  try {
    const result = await runSimulationForRun(db, {
      runId: created.run_id,
      seed: body?.seed,
      iterations: body?.iterations,
    });
    appendAudit(db, {
      actor: ctx.userId,
      action: "business_case_simulate",
      target: `${project.project_no}:${modelId} -> ${created.run_id}`,
      now,
    });
    return ok({ run_id: created.run_id, simulation: result, cash_flows: flows, discount_rate: discountRate }, 201);
  } catch (err) {
    if (err instanceof SimulationInputError) {
      return badRequest("simulation_rejected", err.message);
    }
    return badRequest("simulation_failed", err instanceof Error ? err.message : "Simulation failed.");
  }
}
