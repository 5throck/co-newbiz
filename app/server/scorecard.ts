// @version 1.0.0
/**
 * Venture/JV scorecard routes — ADR-0059 E.4, the final link of the
 * portfolio view over migration 0024's venture_scorecard table (PR-3a).
 *
 * Two reads, one per repository entry point:
 *   - GET /api/portfolio-scorecard?review_cycle=YYYY-Qn — the membership-
 *     filtered portfolio rollup (getPortfolioRollup is a PURE query by
 *     design; THIS route owns visibility for its caller);
 *   - GET /api/projects/:id/scorecard?review_cycle= — one project's rows
 *     (getVentureScorecard re-checks membership + insider status itself).
 *
 * Scope honesty (the route's one non-trivial rule): a caller sees only
 * their visible projects, so their rollup may be a SUBSET of what the
 * cycle holds group-wide. The response must say so — meta carries
 * scope="membership-filtered", the count of projects with rows for the
 * resolved cycle REGARDLESS of visibility (one unfiltered COUNT query; it
 * leaks a count, never identities), and the derived
 * scope_incomplete/projects_excluded flags. A subset rollup that passed
 * itself off as the whole portfolio would be a silent lie, which is worse
 * than the count disclosure (approved design, ADR-0059 E.4 review).
 *
 * MNPI posture: NO excludeMnpi here — portfolio review is a member duty
 * that includes MNPI projects (security-model §6: members see the banner,
 * not a hole in the list). The visibility layer itself logs every MNPI
 * read, and this route adds its own data_access row for the scorecard
 * read, so the access trail covers both the project lookup and the rows.
 */

import { Hono } from "hono";
import { getDb } from "../../db/client.ts";
import { getProjectIfVisible, listVisibleProjects } from "../../db/repositories/project.repository.ts";
import { getPortfolioRollup, getVentureScorecard } from "../../db/repositories/venture-scorecard.repository.ts";
import { logDataAccess } from "../../db/lib/access-control.ts";
import { badRequest, notFound, ok } from "./envelope.ts";
import { requireAuth, type AppEnv } from "./middleware.ts";

export const scorecardRoutes = new Hono<AppEnv>();
scorecardRoutes.use("*", requireAuth);

/** The shared JV-monitor + portfolio cadence axis (migration 0024 GLOB CHECK shape). */
const REVIEW_CYCLE_RE = /^\d{4}-Q[1-4]$/;

/**
 * GET /api/portfolio-scorecard?review_cycle=YYYY-Qn — the caller's
 * membership-filtered rollup for the given cycle, or the latest cycle
 * within their visible scope. See the module doc for the scope-honesty
 * meta contract.
 */
scorecardRoutes.get("/api/portfolio-scorecard", (c) => {
  const ctx = c.get("auth");
  const raw = (c.req.query("review_cycle") ?? "").trim();
  if (raw !== "" && !REVIEW_CYCLE_RE.test(raw)) {
    return badRequest(c, "invalid_review_cycle", `review_cycle '${raw}' must match YYYY-Q[1-4] (e.g. '2026-Q3') — the shared JV-monitor + portfolio cadence axis.`);
  }
  const cycle = raw === "" ? undefined : raw;

  const visible = listVisibleProjects(ctx.userId, {});
  const rollup = getPortfolioRollup({ reviewCycle: cycle, projectIds: visible.map((p) => p.id) });
  const resolved = rollup.review_cycle;

  // The unfiltered half of scope honesty: distinct projects with rows for
  // the resolved cycle, visibility ignored. Counts only — never identities.
  const db = getDb();
  const projectsWithRowsTotal = resolved
    ? (
        db
          .query("SELECT COUNT(DISTINCT project_id) AS n FROM venture_scorecard WHERE review_cycle = ?")
          .get(resolved) as { n: number }
      ).n
    : 0;
  // The visible half comes from the rollup's own rows (already scoped).
  const visibleWithRows = new Set([...rollup.financial, ...rollup.strategic].map((r) => r.project_id)).size;
  const projectsExcluded = Math.max(0, projectsWithRowsTotal - visibleWithRows);

  logDataAccess(db, {
    userId: ctx.userId,
    tableKey: "venture_scorecard",
    recordRef: `portfolio:${resolved ?? "*"}`,
    action: "read",
    at: new Date().toISOString(),
  });

  return ok(c, rollup, 200, {
    scope: "membership-filtered",
    projects_visible: visible.length,
    projects_with_rows_total: projectsWithRowsTotal,
    scope_incomplete: projectsExcluded > 0,
    projects_excluded: projectsExcluded,
    review_cycle: resolved,
    review_cycles_available: rollup.provenance.review_cycles_available,
  });
});

/**
 * GET /api/projects/:id/scorecard?review_cycle= — one project's rows for
 * the given cycle or its latest. getProjectIfVisible first: a non-member
 * gets 404, never 403 (FR-SEC-01 — existence itself is protected);
 * getVentureScorecard then re-checks active membership + insider status
 * for MNPI projects (FR-SEC-08/06) and writes the read's data_access row.
 */
scorecardRoutes.get("/api/projects/:id/scorecard", (c) => {
  const ctx = c.get("auth");
  const projectId = c.req.param("id");
  const raw = (c.req.query("review_cycle") ?? "").trim();
  if (raw !== "" && !REVIEW_CYCLE_RE.test(raw)) {
    return badRequest(c, "invalid_review_cycle", `review_cycle '${raw}' must match YYYY-Q[1-4] (e.g. '2026-Q3') — the shared JV-monitor + portfolio cadence axis.`);
  }
  const cycle = raw === "" ? undefined : raw;

  if (!getProjectIfVisible(ctx.userId, projectId, {})) return notFound(c);

  const rows = getVentureScorecard({ projectId, reviewCycle: cycle, actor: ctx.userId });
  return ok(c, rows, 200, {
    project_id: projectId,
    review_cycle: rows[0]?.review_cycle ?? cycle ?? null,
    count: rows.length,
  });
});
