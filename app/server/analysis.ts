// @version 1.0.0
/**
 * Analysis data routes — docs/api-spec.md §4/§7 (Wave 5.7B).
 *
 * Plain membership-filtered reads over the fact/observation and assumption
 * tables migrated in 0003: the series catalog, per-period latest-revision
 * observations (the idx_obs_latest read path), the data_change_log scan,
 * and the assumption registry. Engine-dependent surfaces (runs, diffs,
 * proxy chains, simulations) stay on the CLI until an async job surface
 * exists — see index.ts's module doc.
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
import { ulid } from "../../db/lib/ulid.ts";
import { badRequest, forbidden, notFound, ok } from "./envelope.ts";
import { requireAuth, type AppEnv, type AuthContext } from "./middleware.ts";

export const analysisRoutes = new Hono<AppEnv>();
analysisRoutes.use("*", requireAuth);

const ASSUMPTION_KINDS = new Set(["live", "user", "derived", "assumed"]);

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
 * revision row; ?period_id= narrows to one period.
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
    .all(seriesId, periodId, periodId);
  return ok(c, rows, 200, { series_id: seriesId, all_revisions: allRevisions, count: rows.length });
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
 * otherwise). Audited like every other write.
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
  if (!body.kind || !ASSUMPTION_KINDS.has(body.kind)) {
    return badRequest(c, "invalid_request", `kind must be one of ${[...ASSUMPTION_KINDS].join("|")}.`);
  }
  if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
    return badRequest(c, "invalid_request", "value must be a number.");
  }
  if (!body.as_of?.trim()) {
    return badRequest(c, "invalid_request", "as_of is required (ISO-8601 date).");
  }
  const rationale = body.rationale?.trim() ?? "";
  if (body.kind === "assumed" && !rationale) {
    return badRequest(
      c,
      "rationale_required",
      "kind='assumed' requires a non-empty rationale (FR-DATA-07) — the DB CHECK backs this, but it is refused here first.",
    );
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();
  try {
    db.run(
      `INSERT INTO assumption (id, run_id, assumption_key, kind, value, rationale, anchor_ref, as_of, ttl_days)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id,
        body.run_id.trim(),
        body.assumption_key.trim(),
        body.kind,
        body.value,
        rationale || null,
        body.anchor_ref?.trim() || null,
        body.as_of.trim(),
        Number.isInteger(body.ttl_days) ? body.ttl_days : null,
      ],
    );
  } catch (err) {
    return badRequest(c, "assumption_rejected", err instanceof Error ? err.message : "Assumption write failed.");
  }
  appendAudit(db, {
    actor: ctx.userId,
    action: "assumption_set",
    target: `${body.run_id.trim()}:${body.assumption_key.trim()}:${body.kind}`,
    now,
  });
  return ok(c, { id }, 201);
});
