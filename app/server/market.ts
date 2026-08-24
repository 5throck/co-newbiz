// @version 1.1.0
/**
 * Market / value-chain routes — ADR-0066 Phases A+C, ADR-0067 round 4.
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

// ── ADR-0067 round 4 surfaces: screening longlist + partner DD findings ──

/** GET /api/projects/:id/screening-longlist — the candidate register. */
marketRoutes.get("/api/projects/:id/screening-longlist", (c) => {
  const project = getProjectIfVisible(c.get("auth").userId, c.req.param("id"), { excludeMnpi: false });
  if (!project) return notFound(c);
  const rows = getDb().query("SELECT id, candidate_name, knock_out_passed, notes, created_at FROM screening_longlist WHERE project_id = ? ORDER BY created_at DESC").all(project.id);
  return ok(c, rows);
});

/** POST /api/projects/:id/screening-longlist — register a candidate with its knock-out verdict. Analyst+; audited. */
marketRoutes.post("/api/projects/:id/screening-longlist", async (c) => {
  const ctx = c.get("auth");
  const project = getProjectIfVisible(ctx.userId, c.req.param("id"), { excludeMnpi: false });
  if (!project) return notFound(c);
  if (ctx.role === "viewer") return forbidden(c, "role_required", "Longlist writes require the analyst role.");
  const body = await c.req.json().catch(() => null) as { candidate_name?: string; knock_out_passed?: boolean; notes?: string } | null;
  if (!body?.candidate_name?.trim() || typeof body.knock_out_passed !== "boolean") {
    return badRequest(c, "invalid_request", "candidate_name and knock_out_passed are required.");
  }
  const db = getDb();
  const id = ulid();
  db.run("INSERT INTO screening_longlist (id, project_id, candidate_name, knock_out_passed, notes, created_at) VALUES (?,?,?,?,?,?)",
    [id, project.id, body.candidate_name.trim(), body.knock_out_passed ? 1 : 0, body.notes?.trim() || null, new Date().toISOString()]);
  appendAudit(db, { actor: ctx.userId, action: "screening_longlist_write", target: `${project.id}:${id}`, now: new Date().toISOString() });
  return ok(c, { id }, 201);
});

/** GET /api/projects/:id/partner-dd-findings — partner DD findings. */
marketRoutes.get("/api/projects/:id/partner-dd-findings", (c) => {
  const project = getProjectIfVisible(c.get("auth").userId, c.req.param("id"), { excludeMnpi: false });
  if (!project) return notFound(c);
  const rows = getDb().query(
    `SELECT f.id, f.partner_id, p.name AS partner_name, f.workstream, f.severity, f.description, f.created_at
     FROM partner_dd_finding f JOIN partner_candidate p ON p.id = f.partner_id
     WHERE f.project_id = ? ORDER BY f.created_at DESC`,
  ).all(project.id);
  return ok(c, rows);
});

/** POST /api/projects/:id/partner-dd-findings — record a partner DD finding. Analyst+; audited. */
marketRoutes.post("/api/projects/:id/partner-dd-findings", async (c) => {
  const ctx = c.get("auth");
  const project = getProjectIfVisible(ctx.userId, c.req.param("id"), { excludeMnpi: false });
  if (!project) return notFound(c);
  if (ctx.role === "viewer") return forbidden(c, "role_required", "Partner DD finding writes require the analyst role.");
  const body = await c.req.json().catch(() => null) as
    | { partner_id?: string; workstream?: string; severity?: string; description?: string }
    | null;
  if (!body?.partner_id || !body?.workstream || !body?.severity?.trim() || !body?.description?.trim()) {
    return badRequest(c, "invalid_request", "partner_id, workstream, severity and description are required.");
  }
  if (ctx.role === "viewer") return forbidden(c, "role_required", "Analyst role required.");
  const WORKSTREAMS = ["financial_distress", "ip_chain", "general"];
  const SEVERITIES = ["red", "amber", "green"];
  if (!WORKSTREAMS.includes(body.workstream)) return badRequest(c, "invalid_workstream", `workstream must be one of ${WORKSTREAMS.join(", ")}.`);
  if (!SEVERITIES.includes(body.severity)) return badRequest(c, "invalid_severity", `severity must be one of ${SEVERITIES.join(", ")}.`);
  const partnerExists = getDb().query("SELECT id FROM partner_candidate WHERE id = ? AND project_id = ?").get(body.partner_id, project.id);
  if (!partnerExists) return notFound(c, "Unknown partner on this project.");
  const db = getDb();
  const id = ulid();
  db.run("INSERT INTO partner_dd_finding (id, project_id, partner_id, workstream, severity, description, created_at) VALUES (?,?,?,?,?,?,?)",
    [id, project.id, body.partner_id, body.workstream, body.severity, body.description.trim(), new Date().toISOString()]);
  appendAudit(db, { actor: ctx.userId, action: "partner_dd_finding_write", target: `${project.id}:${id}`, now: new Date().toISOString() });
  return ok(c, { id }, 201);
});

// ── ADR-0068 round 5 surface: chain_node_sensitivity ────────────────────

/** GET /api/projects/:id/chain-sensitivities — driver sensitivities per node. */
marketRoutes.get("/api/projects/:id/chain-sensitivities", (c) => {
  const project = getProjectIfVisible(c.get("auth").userId, c.req.param("id"), { excludeMnpi: false });
  if (!project) return notFound(c);
  const industryId = c.req.query("industry_id");
  const rows = industryId
    ? getDb().query("SELECT s.id, s.industry_id, d.code AS driver_code, s.sensitivity, s.lag_months, s.assessed_by, s.assessed_at FROM chain_node_sensitivity s JOIN industry_driver d ON d.id = s.driver_id WHERE s.project_id = ? AND s.industry_id = ? ORDER BY s.assessed_at DESC").all(project.id, industryId)
    : getDb().query("SELECT s.id, s.industry_id, d.code AS driver_code, s.sensitivity, s.lag_months, s.assessed_by, s.assessed_at FROM chain_node_sensitivity s JOIN industry_driver d ON d.id = s.driver_id WHERE s.project_id = ? ORDER BY s.assessed_at DESC").all(project.id);
  return ok(c, rows, 200, { count: rows.length });
});

/**
 * POST /api/projects/:id/chain-sensitivities — upsert a sensitivity.
 * The UNIQUE(project, industry, driver) constraint makes this a natural
 * upsert: re-assertion replaces the previous sensitivity for the same node
 * + driver pair (the dimension_input supersede pattern applied to sensitivities).
 */
marketRoutes.post("/api/projects/:id/chain-sensitivities", async (c) => {
  const ctx = c.get("auth");
  const project = getProjectIfVisible(ctx.userId, c.req.param("id"), { excludeMnpi: false });
  if (!project) return notFound(c);
  if (ctx.role === "viewer") return forbidden(c, "role_required", "Sensitivity writes require the analyst role.");
  const body = await c.req.json().catch(() => null) as
    | { industry_id?: string; driver_code?: string; sensitivity?: number; lag_months?: number }
    | null;
  if (!body?.industry_id || !body?.driver_code?.trim() || typeof body.sensitivity !== "number") {
    return badRequest(c, "invalid_request", "industry_id, driver_code and sensitivity are required.");
  }
  const db = getDb();
  const driver = db.query("SELECT id FROM industry_driver WHERE code = ?").get(body.driver_code.trim()) as { id: string } | undefined;
  if (!driver) return badRequest(c, "unknown_driver", `Unknown driver code '${body.driver_code}'.`);
  const existing = db.query(
    "SELECT id FROM chain_node_sensitivity WHERE project_id = ? AND industry_id = ? AND driver_id = ?",
  ).get(project.id, body.industry_id, driver.id) as { id: string } | undefined;
  if (existing) {
    db.run("UPDATE chain_node_sensitivity SET sensitivity = ?, lag_months = ?, assessed_by = ?, assessed_at = ? WHERE id = ?",
      [body.sensitivity, body.lag_months ?? 0, ctx.userId, new Date().toISOString(), existing.id]);
    appendAudit(db, { actor: ctx.userId, action: "chain_sensitivity_update", target: `${project.id}:${existing.id}`, now: new Date().toISOString() });
    return ok(c, { id: existing.id, updated: true }, 200);
  }
  const id = ulid();
  db.run("INSERT INTO chain_node_sensitivity (id, project_id, industry_id, driver_id, sensitivity, lag_months, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?,?)",
    [id, project.id, body.industry_id, driver.id, body.sensitivity, body.lag_months ?? 0, ctx.userId, new Date().toISOString()]);
  appendAudit(db, { actor: ctx.userId, action: "chain_sensitivity_create", target: `${project.id}:${id}`, now: new Date().toISOString() });
  return ok(c, { id }, 201);
});
