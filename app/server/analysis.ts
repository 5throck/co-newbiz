// @version 1.4.0
/**
 * Analysis data routes — docs/api-spec.md §4/§7 (Waves 5.7B + engine-1/2).
 *
 * Plain membership-filtered reads over the fact/observation and assumption
 * tables migrated in 0003: the series catalog, per-period latest-revision
 * observations (the idx_obs_latest read path), the data_change_log scan,
 * and the assumption registry. The engine-1 wave adds run-based versioning
 * (ADR-0005) over the same migration's run/run_input tables: run
 * list/create/detail and the variable-level diff bridge, all synchronous
 * because createRun is a bounded snapshot write, not an engine invocation —
 * POST records a versioned INPUT snapshot, never a valuation result. The
 * engine-2 wave adds the simulations surface (ADR-0026): POST /api/simulations
 * composes the scenario from a run's sim.* inputs plus the project's
 * contingent_liability rows, spawns python/monte_carlo.py (args array,
 * shell:false, 120s kill timer — see db/lib/simulation.ts), and persists
 * simulation + simulation_result synchronously. Still deferred to an async
 * job surface: proxy chains, reports — see index.ts's module doc.
 *
 * Assumption writes enforce the FR-DATA-07 boundary twice: app code rejects
 * kind='assumed' without a non-empty rationale (400) before the insert, and
 * the DB CHECK behind it still maps a constraint violation to 400, never a
 * 500. When a run_id is supplied the run's project must be visible to the
 * caller — 404, not 403, same as every project-scoped read (FR-SEC-01).
 */

import { Hono } from "hono";
import { getDb } from "../../db/client.ts";
import { getProjectIfVisible } from "../../db/repositories/project.repository.ts";
import { appendAudit } from "../../db/lib/access-control.ts";
import { recordAssumption, AssumptionValidationError } from "../../db/lib/assumption.ts";
import { createRun, diffRuns, type CreateRunResult } from "../../db/lib/versioning.ts";
import { runSimulationForRun, SimulationInputError } from "../../db/lib/simulation.ts";
import { badRequest, fail, forbidden, notFound, ok, provenance } from "./envelope.ts";
import { requireAuth, type AppEnv, type AuthContext } from "./middleware.ts";

export const analysisRoutes = new Hono<AppEnv>();
analysisRoutes.use("*", requireAuth);

function visibleProject(ctx: AuthContext, projectId: string) {
  return getProjectIfVisible(ctx.userId, projectId, { excludeMnpi: false });
}

/** GET /api/series — distinct series catalog derived from the fact table. */
analysisRoutes.get("/api/series", (c) => {
  const q = c.req.query("q")?.trim();
  const rows = getDb()
    .query(
      `SELECT series_id, unit_id, source_id, COUNT(*) AS observation_count,
              MIN(period_id) AS min_period_id, MAX(period_id) AS max_period_id
       FROM fact_market_observation
       ${q ? "WHERE series_id LIKE '%' || ? || '%'" : ""}
       GROUP BY series_id, unit_id, source_id
       ORDER BY series_id`,
    )
    .all(...(q ? [q] : []));
  return ok(c, rows, 200, { count: rows.length });
});

/**
 * GET /api/series/:id/observations — default: latest revision per period
 * (revision-preserving reads, FR-DATA-05); ?all_revisions=1 returns every
 * revision row; ?period_id= narrows to one period. FR-SYS-03: when every
 * returned row traces to one source, that source is the response-level
 * provenance in meta; rows carrying mixed sources keep provenance per row
 * (each row already carries source_id) — a single meta source would be
 * fabricated for the list, so it is omitted instead.
 */
analysisRoutes.get("/api/series/:id/observations", (c) => {
  const seriesId = c.req.param("id");
  const allRevisions = ["1", "true"].includes(c.req.query("all_revisions") ?? "");
  const periodId = c.req.query("period_id") || null;
  const rows = getDb()
    .query(
      `SELECT period_id, revision_no, value, unit_id, source_id, fetched_at
       FROM fact_market_observation f
       WHERE f.series_id = ? AND (? IS NULL OR f.period_id = ?)
       ${
        allRevisions
          ? ""
          : "AND f.revision_no = (SELECT MAX(f2.revision_no) FROM fact_market_observation f2 WHERE f2.series_id = f.series_id AND f2.period_id = f.period_id)"
      }
       ORDER BY f.period_id DESC, f.revision_no DESC`,
    )
    .all(seriesId, periodId, periodId) as { source_id: string }[];
  const sources = new Set(rows.map((r) => r.source_id));
  return ok(c, rows, 200, {
    series_id: seriesId,
    all_revisions: allRevisions,
    count: rows.length,
    ...(sources.size === 1 ? provenance({ source: rows[0].source_id }) : {}),
  });
});

/** GET /api/data-changes — data_change_log scan, newest detection first. */
analysisRoutes.get("/api/data-changes", (c) => {
  const seriesId = c.req.query("series_id") || null;
  const requested = Number(c.req.query("limit") ?? 100);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 500) : 100;
  const rows = getDb()
    .query(
      `SELECT id, series_id, detected_at, change_type, old_value, new_value
       FROM data_change_log
       WHERE (? IS NULL OR series_id = ?)
       ORDER BY detected_at DESC, id DESC LIMIT ?`,
    )
    .all(seriesId, seriesId, limit);
  return ok(c, rows, 200, { limit });
});

/**
 * GET /api/assumptions — registry read filtered by ?run_id= and/or ?key=.
 * With run_id the run's project must be visible (404 for a non-member);
 * without it the registry returns recent entries like /api/interpretations
 * does — the assumption catalog is workspace reference data, not deal data.
 */
analysisRoutes.get("/api/assumptions", (c) => {
  const ctx = c.get("auth");
  const runId = c.req.query("run_id") || null;
  const key = c.req.query("key") || null;
  if (runId) {
    const run = getDb().query("SELECT project_id FROM run WHERE id = ?").get(runId) as { project_id: string } | null;
    if (!run || !visibleProject(ctx, run.project_id)) return notFound(c);
  }
  const rows = getDb()
    .query(
      `SELECT id, run_id, assumption_key, kind, value, rationale, anchor_ref, as_of, ttl_days
       FROM assumption
       WHERE (? IS NULL OR run_id = ?) AND (? IS NULL OR assumption_key = ?)
       ORDER BY as_of DESC, id DESC LIMIT 200`,
    )
    .all(runId, runId, key, key);
  return ok(c, rows, 200, { count: rows.length });
});

/**
 * POST /api/assumptions — analyst+; kind='assumed' requires a non-empty
 * rationale (FR-DATA-07). The run must exist and be project-visible (404
 * otherwise). Field validation and the audited insert live in
 * db/lib/assumption.ts — the same write path the `assume` CLI case uses,
 * so the two surfaces cannot drift on the rules.
 */
analysisRoutes.post("/api/assumptions", async (c) => {
  const ctx = c.get("auth");
  const body = await c.req.json().catch(() => null) as
    | {
      run_id?: string;
      assumption_key?: string;
      kind?: string;
      value?: number;
      as_of?: string;
      rationale?: string;
      anchor_ref?: string;
      ttl_days?: number;
    }
    | null;
  if (!body?.run_id?.trim() || !body?.assumption_key?.trim()) {
    return badRequest(c, "invalid_request", "run_id and assumption_key are required.");
  }
  const run = getDb().query("SELECT project_id FROM run WHERE id = ?").get(body.run_id.trim()) as
    | { project_id: string }
    | null;
  if (!run || !visibleProject(ctx, run.project_id)) return notFound(c);
  if (ctx.role === "viewer") {
    return forbidden(c, "role_required", "Assumption writes require the analyst role.");
  }
  try {
    const row = recordAssumption(getDb(), {
      runId: body.run_id.trim(),
      assumptionKey: body.assumption_key.trim(),
      kind: body.kind ?? "",
      value: body.value,
      asOf: body.as_of ?? "",
      rationale: body.rationale,
      anchorRef: body.anchor_ref,
      ttlDays: Number.isInteger(body.ttl_days) ? body.ttl_days : null,
      actor: ctx.userId,
      now: new Date().toISOString(),
    });
    return ok(c, { id: row.id }, 201);
  } catch (err) {
    if (err instanceof AssumptionValidationError) {
      return badRequest(c, err.code, err.message);
    }
    return badRequest(c, "assumption_rejected", err instanceof Error ? err.message : "Assumption write failed.");
  }
});

/**
 * GET /api/projects/:id/runs — run list for a visible project, newest
 * first, with each run's input-snapshot size. id DESC is the deterministic
 * tiebreak when two runs share a created_at millisecond.
 */
analysisRoutes.get("/api/projects/:id/runs", (c) => {
  const ctx = c.get("auth");
  const projectId = c.req.param("id");
  if (!visibleProject(ctx, projectId)) return notFound(c);
  const rows = getDb()
    .query(
      `SELECT r.id, r.label, r.input_hash, r.created_by, r.created_at, r.superseded_by,
              (SELECT COUNT(*) FROM run_input ri WHERE ri.run_id = r.id) AS input_count
       FROM run r
       WHERE r.project_id = ?
       ORDER BY r.created_at DESC, r.id DESC`,
    )
    .all(projectId);
  return ok(c, rows, 200, { count: rows.length });
});

/**
 * POST /api/projects/:id/runs — create a versioned input snapshot
 * (ADR-0005): copy the source run's inputs (from_run_id, else the
 * project's latest run, else empty), apply `set` overrides, hash, persist
 * atomically. This is NOT a valuation — no output is computed (the model
 * engine does not exist yet). Analyst+; audited. A from_run_id from
 * another project is 400 — a version chain lives within one project.
 */
analysisRoutes.post("/api/projects/:id/runs", async (c) => {
  const ctx = c.get("auth");
  const projectId = c.req.param("id");
  if (!visibleProject(ctx, projectId)) return notFound(c);
  if (ctx.role === "viewer") {
    return forbidden(c, "role_required", "Run creation requires the analyst role.");
  }
  const body = (await c.req.json().catch(() => null)) as
    | { label?: string; from_run_id?: string; set?: Record<string, number> }
    | null;
  if (!body?.label?.trim()) {
    return badRequest(c, "invalid_request", "label is required.");
  }
  if (body.set !== undefined && (typeof body.set !== "object" || Array.isArray(body.set))) {
    return badRequest(c, "invalid_request", "set must be an object of assumption_key -> number.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  let result: CreateRunResult;
  try {
    result = createRun(db, {
      projectId,
      label: body.label.trim(),
      createdBy: ctx.userId,
      fromRunId: body.from_run_id,
      overrides: body.set,
      now,
    });
  } catch (err) {
    return badRequest(c, "run_rejected", err instanceof Error ? err.message : "Run creation failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "run_create", target: `${projectId}:${result.run_id}`, now });
  return ok(c, result, 201);
});

/**
 * GET /api/runs/:id — run row plus its immutable run_input snapshot.
 * Membership resolves through run.project_id; a non-member gets 404,
 * same as every project-scoped read.
 */
analysisRoutes.get("/api/runs/:id", (c) => {
  const ctx = c.get("auth");
  const runId = c.req.param("id");
  const run = getDb()
    .query("SELECT id, project_id, label, input_hash, created_by, created_at, superseded_by FROM run WHERE id = ?")
    .get(runId) as { id: string; project_id: string; label: string | null; input_hash: string; created_by: string; created_at: string; superseded_by: string | null } | null;
  if (!run || !visibleProject(ctx, run.project_id)) return notFound(c);
  const inputs = getDb()
    .query("SELECT assumption_key, value FROM run_input WHERE run_id = ? ORDER BY assumption_key")
    .all(runId) as { assumption_key: string; value: number }[];
  return ok(c, { run, inputs }, 200, { input_count: inputs.length });
});

/**
 * GET /api/runs/:id/diff/:otherId — variable-level bridge between two
 * runs: changed/added/removed per assumption_key plus both input hashes.
 * Both runs must be visible and belong to the same project (400
 * otherwise). NPV-level bridge decomposition is deferred until a
 * valuation engine exists — this endpoint never fabricates it.
 */
analysisRoutes.get("/api/runs/:id/diff/:otherId", (c) => {
  const ctx = c.get("auth");
  const db = getDb();
  const runs = [c.req.param("id"), c.req.param("otherId")].map(
    (id) => db.query("SELECT id, project_id FROM run WHERE id = ?").get(id) as { id: string; project_id: string } | null,
  );
  if (!runs[0] || !visibleProject(ctx, runs[0].project_id)) return notFound(c);
  if (!runs[1] || !visibleProject(ctx, runs[1].project_id)) return notFound(c);
  if (runs[0].project_id !== runs[1].project_id) {
    return badRequest(
      c,
      "invalid_request",
      "Cannot diff runs from different projects — a version chain lives within one project (ADR-0005).",
    );
  }
  return ok(c, diffRuns(db, runs[0].id, runs[1].id));
});

/**
 * POST /api/simulations — run the seeded Monte Carlo engine (ADR-0026) over
 * a run's input snapshot: sim.* keys + the project's contingent_liability
 * rows compose the scenario, python/monte_carlo.py is spawned with an args
 * array (never shell — no quoting surface), and the quantile summary is
 * persisted to simulation/simulation_result. Omitted seed defaults to a
 * value derived from the run's input_hash, so identical inputs stay
 * reproducible even without an explicit seed (design §12 item 13).
 * Analyst+; audited. Caller-fixable input problems are 400
 * (simulation_rejected); engine failures (spawn/timeout/parse) are 500.
 */
analysisRoutes.post("/api/simulations", async (c) => {
  const ctx = c.get("auth");
  const body = (await c.req.json().catch(() => null)) as
    | { run_id?: string; seed?: number; iterations?: number }
    | null;
  if (!body?.run_id?.trim()) {
    return badRequest(c, "invalid_request", "run_id is required.");
  }
  const runId = body.run_id.trim();
  const run = getDb().query("SELECT project_id FROM run WHERE id = ?").get(runId) as { project_id: string } | null;
  if (!run || !visibleProject(ctx, run.project_id)) return notFound(c);
  if (ctx.role === "viewer") {
    return forbidden(c, "role_required", "Simulation runs require the analyst role.");
  }
  try {
    const result = await runSimulationForRun(getDb(), {
      runId,
      seed: body.seed,
      iterations: body.iterations,
    });
    appendAudit(getDb(), {
      actor: ctx.userId,
      action: "simulation_run",
      target: `${run.project_id}:${result.simulation_id}`,
      now: new Date().toISOString(),
    });
    return ok(c, result, 201);
  } catch (err) {
    if (err instanceof SimulationInputError) {
      return badRequest(c, "simulation_rejected", err.message);
    }
    return fail(c, 500, "simulation_failed", err instanceof Error ? err.message : "Simulation engine failed.");
  }
});

/**
 * GET /api/simulations/:id/results — the quantile summary from
 * simulation_result ONLY. simulation_draw is never read here: raw draws are
 * subject to retention_policy archival, and the permanent record is the
 * quantile summary (migration 0005 header — "raw draws not exposed after
 * archival"). Membership resolves simulation -> run -> project; a non-member
 * gets the same 404 as for a nonexistent simulation.
 */
analysisRoutes.get("/api/simulations/:id/results", (c) => {
  const ctx = c.get("auth");
  const simulationId = c.req.param("id");
  const simulation = getDb()
    .query(
      `SELECT s.id, s.run_id, s.seed, s.iterations, s.discount_rate, s.created_at, r.project_id
       FROM simulation s JOIN run r ON r.id = s.run_id
       WHERE s.id = ?`,
    )
    .get(simulationId) as
    | { id: string; run_id: string; seed: number; iterations: number; discount_rate: number; created_at: string; project_id: string }
    | null;
  if (!simulation || !visibleProject(ctx, simulation.project_id)) return notFound(c);
  const results = getDb()
    .query("SELECT metric, p05, p50, p95, mean, std FROM simulation_result WHERE simulation_id = ? ORDER BY metric")
    .all(simulationId) as { metric: string; p05: number; p50: number; p95: number; mean: number; std: number }[];
  const { project_id: _projectId, ...row } = simulation;
  return ok(c, { simulation: row, results }, 200, { seed: simulation.seed, iterations: simulation.iterations });
});
