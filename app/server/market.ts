// @version 1.0.0
/**
 * Market / value-chain routes — ADR-0066 design Phase A.
 *
 * Chain topology view + per-node 5-year financial series (fact_industry) +
 * the user-provided financial-import fallback (DART collector is the primary
 * ingestion path; this endpoint keeps progress alive when it is unavailable).
 */

import { Hono } from "hono";
import { getDb } from "../../db/client.ts";
import { getProjectIfVisible } from "../../db/repositories/project.repository.ts";
import { resolveChainTopology } from "../../db/lib/value-chain-topology.ts";
import { runStructureSimulation, type StructureSimSummary } from "../../db/lib/structure-simulation.ts";
import { appendAudit } from "../../db/lib/access-control.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { badRequest, fail, forbidden, notFound, ok } from "./envelope.ts";
import { requireAuth, type AppEnv } from "./middleware.ts";

export const marketRoutes = new Hono<AppEnv>();
marketRoutes.use("*", requireAuth);

/** GET /api/projects/:id/value-chain/topology — layered chain graph. */
marketRoutes.get("/api/projects/:id/value-chain/topology", (c) => {
  const project = getProjectIfVisible(c.get("auth").userId, c.req.param("id"), { excludeMnpi: false });
  if (!project) return notFound(c);
  try {
    const topology = resolveChainTopology(getDb(), project.id);
    return ok(c, topology, 200, { layer_count: topology.layers.length });
  } catch (err) {
    return badRequest(c, "topology_cycle", err instanceof Error ? err.message : "Chain topology failed.");
  }
});

/**
 * GET /api/projects/:id/industries/:industryId/financials?years=5 —
 * per-year metric aggregates for one chain node from fact_industry.
 */
marketRoutes.get("/api/projects/:id/industries/:industryId/financials", (c) => {
  const project = getProjectIfVisible(c.get("auth").userId, c.req.param("id"), { excludeMnpi: false });
  if (!project) return notFound(c);
  const industryId = c.req.param("industryId");
  const years = Math.min(Math.max(Number(c.req.query("years") ?? 5), 1), 10);
  const currentYear = new Date().getUTCFullYear();
  const rows = getDb()
    .query(
      `SELECT p.fiscal_year AS fiscal_year, f.metric_key AS metric_key, MAX(f.value) AS value, MAX(f.revision_no) AS revision_no
       FROM fact_industry f JOIN md_period p ON p.id = f.period_id
       WHERE f.industry_id = ? AND p.fiscal_year >= ?
       GROUP BY p.fiscal_year, f.metric_key ORDER BY p.fiscal_year DESC, f.metric_key`,
    )
    .all(industryId, currentYear - years + 1);
  return ok(c, rows, 200, { industry_id: industryId, years });
});

/**
 * POST /api/projects/:id/financial-imports — the user-provided fallback for
 * chain-node financials when DART collection is unavailable. Body:
 * {industry_id, source?, rows:[{fiscal_year, metric_key, value}]}. Each row
 * lands in fact_industry (period auto-created as a calendar year if absent).
 */
marketRoutes.post("/api/projects/:id/financial-imports", async (c) => {
  const ctx = c.get("auth");
  const project = getProjectIfVisible(ctx.userId, c.req.param("id"), { excludeMnpi: false });
  if (!project) return notFound(c);
  if (ctx.role === "viewer") return forbidden(c, "role_required", "Financial imports require the analyst role.");
  const body = await c.req.json().catch(() => null) as {
    industry_id?: string;
    source?: string;
    rows?: Array<{ fiscal_year?: number; metric_key?: string; value?: number }>;
  } | null;
  if (!body?.industry_id || !Array.isArray(body.rows) || body.rows.length === 0) {
    return badRequest(c, "invalid_request", "industry_id and a non-empty rows array are required.");
  }
  const db = getDb();
  const industryExists = db.query("SELECT id FROM md_industry WHERE id = ?").get(body.industry_id);
  if (!industryExists) return notFound(c, "Unknown industry.");

  // Optional named source: reuse an existing md_source code, else create one.
  let sourceId: string | null = null;
  if (body.source?.trim()) {
    const code = body.source.trim();
    const existing = db.query("SELECT id FROM md_source WHERE code = ?").get(code) as { id: string } | undefined;
    if (existing) sourceId = existing.id;
    else {
      sourceId = ulid();
      db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [sourceId, code, "C", new Date().toISOString()]);
    }
  }

  const inserted: Array<{ period_id: string; metric_key: string }> = [];
  db.transaction(() => {
    for (const r of body.rows!) {
      if (typeof r.fiscal_year !== "number" || !r.metric_key?.trim() || typeof r.value !== "number") continue;
      const year = Math.trunc(r.fiscal_year);
      let period = db.query("SELECT id FROM md_period WHERE period_type='year' AND fiscal_year=?").get(year) as { id: string } | undefined;
      if (!period) {
        period = { id: ulid() };
        db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
          [period.id, "year", `${year}-01-01`, `${year}-12-31`, year, new Date().toISOString()]);
      }
      db.run(
        "INSERT INTO fact_industry (id, industry_id, period_id, metric_key, value, revision_no, source_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), body.industry_id!, period.id, r.metric_key.trim(), r.value, 1, sourceId, new Date().toISOString()],
      );
      inserted.push({ period_id: period.id, metric_key: r.metric_key });
    }
  })();
  appendAudit(db, { actor: ctx.userId, action: "financial_import", target: `${project.id}:${body.industry_id}:${inserted.length}`, now: new Date().toISOString() });
  return ok(c, { imported: inserted.length }, 201, { note: "Rows appended with revision_no=1 — re-importing the same period/metric adds a newer revision." });
});

/**
 * POST /api/projects/:id/structure-simulations — ADR-0066 Phase C. Composes
 * the scenario from the run's drv.* assumptions + chain_node_sensitivity +
 * value_chain_link, spawns python/structure_sim.py (args array, never shell),
 * persists structure_simulation_result rows for assessed nodes. Analyst+;
 * audited; engine failures 500.
 */
marketRoutes.post("/api/projects/:id/structure-simulations", async (c) => {
  const ctx = c.get("auth");
  const project = getProjectIfVisible(ctx.userId, c.req.param("id"), { excludeMnpi: false });
  if (!project) return notFound(c);
  if (ctx.role === "viewer") return forbidden(c, "role_required", "Structure simulation requires the analyst role.");
  const body = await c.req.json().catch(() => null) as
    | { run_id?: string; seed?: number; iterations?: number; scenario?: string }
    | null;
  if (!body?.run_id) return badRequest(c, "invalid_request", "run_id is required.");
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
    return ok(c, summary, 201, {
      unassessed_nodes: summary.unassessed_nodes,
      defaulted_drivers: summary.defaulted_drivers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Structure simulation failed.";
    // Validation/ownership/re-run guards throw with the module prefix — those
    // are caller mistakes (400). Anything else is an engine failure (500).
    if (message.startsWith("structure-simulation:")) return badRequest(c, "invalid_request", message.replace(/^structure-simulation:\s*/, ""));
    return fail(c, 500, "engine_failed", message);
  }
});

/** GET /api/projects/:id/structure-simulations?run_id= — persisted quantile rows (newest first, capped 200). */
marketRoutes.get("/api/projects/:id/structure-simulations", (c) => {
  const project = getProjectIfVisible(c.get("auth").userId, c.req.param("id"), { excludeMnpi: false });
  if (!project) return notFound(c);
  const runId = c.req.query("run_id");
  const rows = runId
    ? getDb()
        .query(
          "SELECT srr.run_id, srr.scenario, srr.industry_id, srr.metric, srr.p05, srr.p50, srr.p95, srr.created_at FROM structure_simulation_result srr WHERE srr.run_id = ? AND EXISTS (SELECT 1 FROM run r WHERE r.id = srr.run_id AND r.project_id = ?) ORDER BY srr.created_at DESC LIMIT 200",
        )
        .all(runId, project.id)
    : getDb()
        .query(
          "SELECT srr.run_id, srr.scenario, srr.industry_id, srr.metric, srr.p05, srr.p50, srr.p95, srr.created_at FROM structure_simulation_result srr JOIN run r ON r.id = srr.run_id WHERE r.project_id = ? ORDER BY srr.created_at DESC LIMIT 200",
        )
        .all(project.id);
  return ok(c, rows, 200, { count: rows.length });
});
